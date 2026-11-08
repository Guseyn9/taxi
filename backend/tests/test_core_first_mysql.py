"""MySQL8/procedure/worker/outbox integration with an HTTP mock of Core."""
import json
import os
import unittest
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor
from cryptography.fernet import Fernet
import httpx
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker
from domains.taxi.intents import TaxiIntentCatalog
from domains.taxi.invocations import IbronevikOutboxHandler
from domains.taxi.create_api import create_order
from fsm_core.command_service import CommandService, parse_command_envelope
from fsm_core.core_client import CoreClient, CredentialCipher, UserCredentials
from fsm_core.security import Principal
from fsm_core.snapshots import SnapshotService
from fsm_core.engine import FsmEngine
from fsm_core.workers import FsmInstanceWorker
from fsm_core.outbox import OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.errors import EntitySyncInProgress
from fsm_worker import build_registry

URL = os.getenv('FSM_SYNC_TEST_MYSQL_URL')

@unittest.skipUnless(URL, 'FSM_SYNC_TEST_MYSQL_URL is required')
class CoreFirstMySQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        target=make_url(URL)
        if target.host not in {'127.0.0.1','localhost','mysql'} or not target.database.endswith('_test'):
            raise RuntimeError('Destructive fixtures require a local database ending in _test')
        cls.engine = create_engine(URL, pool_pre_ping=True, isolation_level='READ COMMITTED')
        cls.Session = sessionmaker(cls.engine, expire_on_commit=False)
        os.environ['FSM_CREDENTIAL_KEYS'] = Fernet.generate_key().decode()
        os.environ['FSM_EXTERNAL_SYNC_ENABLED'] = '1'

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()

    def setUp(self):
        with self.engine.begin() as c:
            for table in ['fsm_entity_locks','fsm_sync_mismatches','fsm_command_credentials','fsm_order_create_keys','fsm_command_idempotency','realtime_events','core_outbox','server_fsm_instances','fsm_action_logs','core_order_mapping','taxi_trips','orders']:
                c.execute(text('DELETE FROM ' + table))
        self.registry = build_registry(external_sync=True)
        self.snapshots = SnapshotService(self.registry, self.Session)
        self.commands = CommandService(self.snapshots, {'taxi': TaxiIntentCatalog()})
        self.worker = FsmInstanceWorker(FsmEngine(self.registry))
        credentials = UserCredentials('secret-user-token', 'secret-user-hash')
        self.driver = Principal(205, ('driver',), credentials=credentials)
        self.client = Principal(100, ('client',), credentials=credentials)
        self.writes, self.fail, self.timeout = [], False, False
        self.auth_unavailable = False
        self.read_state, self.driver_state, self.auth_id = '1', '3', 205
        self.http = CoreClient('https://core.example.test/api', transport=httpx.MockTransport(self.remote))
        handlers = OutboxHandlerRegistry()
        handlers.register('ibronevik', IbronevikOutboxHandler(self.http, CredentialCipher.from_env()))
        self.dispatcher = OutboxDispatcher(handlers, retry_base_seconds=1)
        self.addCleanup(self.http.close)

    def remote(self, request):
        body = request.content.decode()
        self.assertIn('name="token"', body)
        self.assertIn('secret-user-token', body)
        if request.url.path.endswith('/user/authorized'):
            if self.auth_unavailable:
                return httpx.Response(503,json={'status':'error'})
            return httpx.Response(200, json={'code':'200','status':'success','auth_user':{'u_id':self.auth_id,'u_role':2 if self.auth_id==205 else 1}})
        if 'name="data"' in body:
            self.writes.append('create')
            return httpx.Response(200, json={'code':'200','status':'success','data':{'b_id':901}})
        if 'name="action"' in body:
            self.writes.append(body)
            if self.timeout:
                raise httpx.ReadTimeout('untrusted secret-user-token error', request=request)
            if self.fail:
                return httpx.Response(200, json={'code':'404','status':'error','message':'business rejection secret-user-token'})
            if self.auth_id == 205 and 'set_cancel_state' in body:
                self.driver_state = '2'
            return httpx.Response(200, json={'code':'200','status':'success'})
        return httpx.Response(200, json={'code':'200','status':'success','data':{'booking':{'901':{'b_id':901,'b_state':self.read_state,'b_confirm_state':1,'drivers':[{'u_id':205,'c_state':self.driver_state}]}}}})

    def order(self, state='order_driver_assigned', metadata=None):
        values={'mode':'DIRECT','client_user_id':100,'driver_user_id':205,'candidates':[{'user_id':205}], 'offers':[{'user_id':205}]}
        values.update(metadata or {})
        with self.engine.begin() as c:
            result=c.execute(text('INSERT INTO orders(status,metadata_json) VALUES(:state,:meta)'), {'state':state,'meta':json.dumps(values)})
            oid=result.lastrowid
            c.execute(text('INSERT INTO core_order_mapping(local_order_id,core_order_id,client_local_user_id,performer_local_user_id) VALUES(:id,901,100,205)'), {'id':oid})
            return oid

    def accept(self, oid, intent='driver_cancel_requested', principal=None, payload=None, key=None):
        with self.Session() as s:
            result=self.commands.accept(s, principal=principal or self.driver, service='taxi', entity_type='order',entity_id=oid,
                envelope=parse_command_envelope({'intent':intent,'commandId':key or uuid.uuid4().hex,'payload':payload or {}}))
            s.rollback() if result.duplicate else s.commit()
            return result.response

    def scalar(self, sql):
        with self.Session() as s:
            return s.execute(text(sql)).scalar()

    def status(self, instance):
        with self.Session() as s:
            return self.commands.get_command_status(s,instance_id=instance,principal=self.client if self.auth_id == 100 else self.driver)

    def phase_a(self, oid, **kwargs):
        accepted=self.accept(oid, **kwargs)
        result=self.worker.run_once(self.Session)
        self.assertEqual(result.failed,0,result.items)
        return accepted['instanceId']

    def test_core_success_is_only_point_that_changes_state(self):
        oid=self.order(); instance=self.phase_a(oid)
        self.assertEqual(self.scalar('SELECT status FROM orders'),'order_driver_assigned')
        self.assertEqual(self.status(instance)['status'],'PROCESSING')
        snapshot=self.snapshots.build(principal=self.driver,service='taxi',entity_type='order',entity_id=oid)
        self.assertEqual(snapshot['sync']['status'],'pending')
        self.assertEqual(snapshot['availableActions'],[])
        with self.assertRaises(EntitySyncInProgress): self.accept(oid)
        self.assertEqual(self.dispatcher.run_once(self.Session).failed,0)
        self.assertEqual(self.scalar('SELECT status FROM orders'),'order_created')
        self.assertEqual(self.status(instance)['status'],'COMPLETED')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM fsm_entity_locks'),0)
        self.assertIsNone(self.scalar('SELECT credentials_encrypted FROM core_outbox'))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM fsm_command_credentials'),0)
        self.assertEqual(len(self.writes),1)

    def test_http_200_business_failure_preserves_state(self):
        oid=self.order(); instance=self.phase_a(oid); self.fail=True
        self.assertEqual(self.dispatcher.run_once(self.Session).failed,1)
        self.assertEqual(self.scalar('SELECT status FROM orders'),'order_driver_assigned')
        self.assertEqual(self.status(instance)['status'],'FAILED')
        self.assertEqual(self.scalar('SELECT attempts FROM core_outbox'),1)
        for table, column in [('core_outbox','payload'),('core_outbox','response_json'),('core_outbox','last_error'),('server_fsm_instances','metadata_json'),('fsm_command_idempotency','response_json')]:
            self.assertNotIn('secret-user',str(self.scalar(f'SELECT {column} FROM {table}')))

    def test_ambiguous_write_readback_succeeds_without_repeating_write(self):
        oid=self.order(); instance=self.phase_a(oid); self.timeout=True
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'PROCESSING')
        self.timeout=False; self.driver_state='2'
        with self.engine.begin() as c: c.execute(text('UPDATE core_outbox SET next_attempt_at=NOW()'))
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'COMPLETED')
        self.assertEqual(len(self.writes),1)

    def test_ambiguous_write_without_proof_is_quarantined(self):
        oid=self.order(); instance=self.phase_a(oid); self.timeout=True
        self.dispatcher.run_once(self.Session)
        self.timeout=False
        with self.engine.begin() as c: c.execute(text('UPDATE core_outbox SET next_attempt_at=NOW()'))
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['errorCode'],'CORE_OUTCOME_UNKNOWN')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM fsm_sync_mismatches'),1)
        with self.assertRaises(EntitySyncInProgress): self.accept(oid)
        self.assertEqual(len(self.writes),1)

    def test_worker_rechecks_assigned_driver(self):
        oid=self.order(); instance=self.accept(oid)['instanceId']
        with self.engine.begin() as c:
            c.execute(text('UPDATE core_order_mapping SET performer_local_user_id=206'))
            c.execute(text("UPDATE orders SET metadata_json=JSON_SET(metadata_json,'$.driver_user_id',206)"))
        result=self.worker.run_once(self.Session)
        self.assertEqual(result.failed,1)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM core_outbox'),0)
        self.assertEqual(self.status(instance)['errorCode'],'AUTHORIZATION_FAILED')

    def test_core_success_with_changed_expected_state_records_divergence(self):
        oid=self.order(); instance=self.phase_a(oid)
        with self.engine.begin() as c: c.execute(text("UPDATE orders SET status='order_in_ride'"))
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['errorCode'],'CORE_FSM_DIVERGENCE')
        self.assertEqual(self.scalar('SELECT status FROM orders'),'order_in_ride')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM fsm_sync_mismatches'),1)

    def test_selected_driver_and_trip_persist_only_after_confirmation(self):
        oid=self.order('order_vote_waiting_candidates'); self.auth_id=100
        instance=self.phase_a(oid,intent='candidate_selected',principal=self.client,payload={'driverUserId':205})
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM taxi_trips'),0)
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'COMPLETED')
        self.assertEqual(self.scalar('SELECT driver_user_id FROM taxi_trips'),205)
        self.assertEqual(self.scalar("SELECT JSON_EXTRACT(metadata_json,'$.selected_candidate.user_id') FROM orders"),'205')

    def test_create_reserves_once_and_records_core_id_after_delivery(self):
        self.auth_id=100; key=uuid.uuid4().hex
        with self.Session() as s:
            result=create_order(s,self.commands,self.client,{'mode':'OFFER','data':{'b_start_address':'Agadir'}},key);s.commit()
        with self.Session() as s:
            duplicate=create_order(s,self.commands,self.client,{'mode':'OFFER','data':{'b_start_address':'Agadir'}},key);s.rollback()
        self.assertTrue(duplicate.duplicate)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM orders'),1)
        self.assertIsNone(self.scalar('SELECT core_order_id FROM core_order_mapping'))
        self.assertEqual(self.worker.run_once(self.Session).failed,0)
        self.assertEqual(self.dispatcher.run_once(self.Session).failed,0)
        self.assertEqual(self.scalar('SELECT core_order_id FROM core_order_mapping'),901)
        self.assertEqual(self.status(result.response['instanceId'])['status'],'COMPLETED')

    def test_auth_outage_retries_without_falsely_marking_a_write_attempt(self):
        oid=self.order(); instance=self.phase_a(oid); self.auth_unavailable=True
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.scalar('SELECT write_attempted FROM core_outbox'),0)
        self.assertEqual(len(self.writes),0)
        self.auth_unavailable=False
        with self.engine.begin() as c: c.execute(text('UPDATE core_outbox SET next_attempt_at=NOW()'))
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'COMPLETED')
        self.assertEqual(len(self.writes),1)

    def test_restart_after_core_write_recovers_by_read_without_repeating(self):
        oid=self.order(); instance=self.phase_a(oid)
        event=self.dispatcher.claim_next(self.Session)
        self.dispatcher.mark_write_attempted(self.Session,event)
        self.dispatcher.handlers.get('ibronevik')(event)
        # Simulate process death after the HTTP acknowledgement, before SENT.
        with self.engine.begin() as c: c.execute(text('UPDATE core_outbox SET locked_at=TIMESTAMPADD(SECOND,-600,NOW())'))
        OutboxDispatcher(self.dispatcher.handlers,worker_id='replacement').run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'COMPLETED')
        self.assertEqual(len(self.writes),1)

    def test_expired_wait_without_any_core_attempt_fails_without_a_write(self):
        oid=self.order(); instance=self.phase_a(oid)
        with self.engine.begin() as c: c.execute(text('UPDATE fsm_entity_locks SET expires_at=TIMESTAMPADD(SECOND,-1,NOW())'))
        self.dispatcher.run_once(self.Session)
        self.assertEqual(self.status(instance)['status'],'FAILED')
        self.assertEqual(self.scalar('SELECT status FROM orders'),'order_driver_assigned')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM fsm_entity_locks'),0)
        self.assertEqual(len(self.writes),0)

    def test_concurrent_duplicate_accepts_commit_one_instance(self):
        oid=self.order(); key=uuid.uuid4().hex; barrier=threading.Barrier(2)
        def submit(_):
            barrier.wait(timeout=5)
            return self.accept(oid,key=key)
        with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(submit,range(2)))
        self.assertEqual({r['instanceId'] for r in results},{results[0]['instanceId']})
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM server_fsm_instances'),1)
        self.assertEqual(sum(r['duplicate'] for r in results),1)

    def test_same_key_with_changed_payload_is_rejected(self):
        from fsm_core.command_service import CommandValidationError
        oid=self.order(); key=uuid.uuid4().hex
        self.accept(oid,key=key,payload={'reason':'one'})
        with self.assertRaises(CommandValidationError): self.accept(oid,key=key,payload={'reason':'two'})
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM server_fsm_instances'),1)

    def test_race_loser_with_changed_payload_is_rejected(self):
        from unittest.mock import patch
        from fsm_core.command_service import CommandValidationError
        from fsm_core.command_idempotency import get_command_idempotency
        oid=self.order(); key=uuid.uuid4().hex
        self.accept(oid,key=key,payload={'reason':'one'})
        # Simulate the first lookup just before another request committed,
        # followed by the losing INSERT IGNORE and a fresh winner lookup.
        with patch('fsm_core.command_service.get_command_idempotency', side_effect=[None, None]) as lookup, patch('fsm_core.command_service.get_command_idempotency_unfiltered', return_value=None):
            def observe(session, **kwargs):
                lookup.side_effect = get_command_idempotency
                return None
            lookup.side_effect = observe
            with self.assertRaises(CommandValidationError):
                self.accept(oid,key=key,payload={'reason':'two'})
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM server_fsm_instances'),1)

    def test_missing_core_binding_fails_startup(self):
        from fsm_core.registry import RegistryValidationError
        with self.Session() as s:
            s.execute(text('DELETE FROM fsm_transition_invocations LIMIT 1'))
            with self.assertRaises(RegistryValidationError): self.registry.validate_database(s)
            s.rollback()

    def test_every_planned_user_operation_waits_for_core(self):
        cases=[
            ('vote_requested','order_created','order_vote_waiting_candidates',100,{}),
            ('offer_requested','order_created','order_offer_waiting',100,{}),
            ('direct_assignment_requested','order_created','order_driver_assigned',100,{'driverUserId':205}),
            ('candidate_selected','order_vote_waiting_candidates','order_vote_driver_assigned',100,{'driverUserId':205}),
            ('offer_selected','order_offer_waiting','order_driver_assigned',100,{'driverUserId':205}),
            ('candidate_released','order_vote_driver_assigned','order_vote_waiting_candidates',100,{}),
            ('driver_arrived','order_driver_assigned','order_driver_arrived',205,{}),
            ('ride_started','order_driver_arrived','order_in_ride',205,{}),
            ('ride_finished','order_in_ride','order_completed',205,{}),
            ('cancel_requested','order_driver_assigned','order_cancelled',100,{}),
        ]
        for intent,before,after,uid,payload in cases:
            with self.subTest(intent=intent):
                self.setUp(); self.auth_id=uid
                oid=self.order(before,{'selected_candidate':{'user_id':205}})
                instance=self.phase_a(oid,intent=intent,principal=self.client if uid==100 else self.driver,payload=payload)
                self.assertEqual(self.scalar('SELECT status FROM orders'),before)
                self.assertEqual(self.status(instance)['status'],'PROCESSING')
                result=self.dispatcher.run_once(self.Session)
                self.assertEqual(result.failed,0,result.items)
                self.assertEqual(self.status(instance)['status'],'COMPLETED')
                self.assertEqual(self.scalar('SELECT status FROM orders'),after)

    def test_pin_stays_in_encrypted_storage_and_is_erased_on_completion(self):
        oid=self.order('order_driver_arrived',{'mode':'VOTE'})
        result=self.accept(oid,intent='ride_started',payload={'boardingCode':'642917'})
        self.assertNotIn('642917',self.scalar('SELECT trigger_payload FROM server_fsm_instances'))
        encrypted=self.scalar('SELECT credentials_encrypted FROM fsm_command_credentials')
        _,private=CredentialCipher.from_env().decrypt_bundle(encrypted)
        self.assertEqual(private['boardingCode'],'642917')
        self.assertEqual(self.worker.run_once(self.Session).failed,0)
        for column in ['payload','completion_json']:
            self.assertNotIn('642917',self.scalar('SELECT '+column+' FROM core_outbox'))
        self.assertEqual(self.dispatcher.run_once(self.Session).failed,0)
        self.assertEqual(self.status(result['instanceId'])['status'],'COMPLETED')
        self.assertIsNone(self.scalar('SELECT credentials_encrypted FROM core_outbox'))

    def test_driver_cancel_duplicate_can_be_read_after_the_driver_is_released(self):
        oid=self.order(); key=uuid.uuid4().hex
        self.accept(oid,key=key)
        self.worker.run_once(self.Session); self.dispatcher.run_once(self.Session)
        duplicate=self.accept(oid,key=key)
        self.assertTrue(duplicate['duplicate'])
        self.assertEqual(duplicate['status'],'COMPLETED')
        self.assertEqual(len(self.writes),1)

    def test_lost_receipt_can_be_recovered_by_key_but_not_by_another_user(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from fsm_core.command_api import create_command_router
        from fsm_core.core_auth import IbronevikPrincipalProvider
        oid=self.order(); key=uuid.uuid4().hex; result=self.accept(oid,key=key)
        app=FastAPI();app.state.session_factory=self.Session;app.state.command_service=self.commands
        app.state.principal_provider=IbronevikPrincipalProvider(self.http,cache_seconds=0)
        app.include_router(create_command_router())
        with TestClient(app) as client:
            headers={'X-Auth-Token':'secret-user-token','X-Auth-U-Hash':'secret-user-hash'}
            receipt=client.get('/api/commands/by-key/taxi/'+key,headers=headers)
            self.assertEqual(receipt.status_code,200)
            self.assertEqual(receipt.json()['instanceId'],result['instanceId'])
            self.auth_id=100
            denied=client.get('/api/commands/by-key/taxi/'+key,headers=headers)
            self.assertEqual(denied.status_code,403)
