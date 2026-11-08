"""Opt-in acceptance against the disposable PHP Core, never a shared tenant."""
import json
import os
import subprocess
import time
import unittest
import uuid
from pathlib import Path
import httpx
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from domains.taxi.core_projection import read_core_booking, observe_booking
from domains.taxi.create_api import create_order
from domains.taxi.intents import TaxiIntentCatalog
from domains.taxi.invocations import IbronevikOutboxHandler
from fsm_core.command_service import CommandService, parse_command_envelope
from fsm_core.core_client import CoreClient, CredentialCipher, UserCredentials
from fsm_core.core_auth import IbronevikPrincipalProvider
from fsm_core.engine import FsmEngine
from fsm_core.outbox import OutboxDispatcher, OutboxHandlerRegistry
from fsm_core.snapshots import SnapshotService
from fsm_core.workers import FsmInstanceWorker
from fsm_worker import build_registry

CORE=os.getenv('FSM_REAL_CORE_URL')
DB=os.getenv('FSM_SYNC_TEST_MYSQL_URL')

@unittest.skipUnless(CORE and DB,'Disposable PHP Core and MySQL URLs required')
class RealPhpCoreAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not CORE.startswith('http://127.0.0.1:') or '/local/' not in CORE or '127.0.0.1:13318/taxi_fsm' not in DB:
            raise RuntimeError('This fixture is restricted to the disposable local stand')
        os.environ['FSM_EXTERNAL_SYNC_ENABLED']='1'
        os.environ['FSM_CREDENTIAL_KEYS']=Fernet.generate_key().decode()
        cls.core=CoreClient(CORE,timeout=25)
        cls.engine=create_engine(DB,pool_pre_ping=True)
        cls.Session=sessionmaker(cls.engine,expire_on_commit=False)
        cls.registry=build_registry(external_sync=True)
        cls.commands=CommandService(SnapshotService(cls.registry,cls.Session),{'taxi':TaxiIntentCatalog()})
        cls.worker=FsmInstanceWorker(FsmEngine(cls.registry))
        handlers=OutboxHandlerRegistry()
        handlers.register('ibronevik',IbronevikOutboxHandler(cls.core,CredentialCipher.from_env()))
        cls.dispatcher=OutboxDispatcher(handlers)
        cls.identities={}
        provider=IbronevikPrincipalProvider(cls.core)
        for index,name in enumerate(['client','driver','driver2']):
            login=f'fsm-{name}-{uuid.uuid4().hex}@example.invalid'
            password=f'Local-only-{uuid.uuid4().hex}'
            def unauth(path,fields):
                response=cls.core.client.post(CORE+path,files={k:(None,str(v)) for k,v in fields.items()}).json()
                if str(response.get('code'))!='200' or response.get('status')!='success':
                    raise AssertionError('Fixture registration/authentication failed (response withheld)')
                return response
            role=1 if name=='client' else 2
            registration=unauth('/register',{'u_role':role,'u_phone':'2126'+str(time.time_ns())[-7:]+str(index),'u_email':login,'u_name':'FSM local fixture','data':json.dumps({'password':password})})
            auth=unauth('/auth',{'login':login,'password':password,'type':'e-mail','au':'f'})
            tokens=unauth('/token',{'auth_hash':auth['auth_hash']})['data']
            pair=UserCredentials(tokens['token'],tokens['u_hash'])
            principal=provider.authenticate(pair)
            item={'principal':principal,'token':pair.token,'u_hash':pair.u_hash,'login':login,'password':password,'id':principal.user_id}
            if role==2:
                uid=principal.user_id
                sql=f"INSERT INTO car(seats,license_plate,id_car_class) VALUES(4,'FSM-{uid}',1); SELECT LAST_INSERT_ID();"
                car=int(cls.sql(sql))
                cls.sql(f'UPDATE users SET id_verification_status=2 WHERE id_user={uid}; INSERT INTO car_users(id_car,id_user,used) VALUES({car},{uid},1); INSERT INTO users_order_location(id_user,id_order_location) VALUES({uid},1),({uid},2),({uid},3); INSERT INTO users_service(id_user,id_service) VALUES({uid},1),({uid},5);')
                item['car']=car
            cls.identities[name]=item
        # Optional browser acceptance reuses synthetic local identities only.
        destination=Path(__file__).resolve().parents[1]/'.local-acceptance.json'
        destination.write_text(json.dumps({name:{k:v for k,v in item.items() if k!='principal'} for name,item in cls.identities.items()}))
        destination.chmod(0o600)

    @classmethod
    def sql(cls,statement):
        result=subprocess.run([os.getenv('DOCKER_BIN','docker'),'exec','-i',os.getenv('FSM_CORE_DB_CONTAINER','taxi-closure-r13-db-1'),'mariadb','-utaxi_local','-plocal-contract-only','--default-character-set=utf8mb4','-N','taxi_contract'],input=statement,text=True,capture_output=True,check=True)
        return result.stdout.strip()

    @classmethod
    def tearDownClass(cls):
        cls.core.close();cls.engine.dispose()

    def command(self,oid,name,intent,payload=None):
        principal=self.identities[name]['principal']
        with self.Session() as session:
            result=self.commands.accept(session,principal=principal,service='taxi',entity_type='order',entity_id=oid,envelope=parse_command_envelope({'intent':intent,'payload':payload or {},'commandId':uuid.uuid4().hex}))
            session.commit()
        self.settle(result.response['instanceId'],principal)

    def settle(self,instance,principal):
        result=self.worker.run_once(self.Session)
        self.assertEqual(result.failed,0,'FSM phase A rejected the fixture')
        result=self.dispatcher.run_once(self.Session)
        self.assertEqual(result.failed,0,'Core invocation failed (response withheld)')
        with self.Session() as session:
            status=self.commands.get_command_status(session,instance_id=instance,principal=principal)
        self.assertEqual(status['status'],'COMPLETED',status.get('errorCode'))

    def create(self,mode):
        data={'b_start_address':'Avenue Hassan II, Agadir','b_start_latitude':30.4206,'b_start_longitude':-9.598,
              'b_destination_address':'Place Al Amal, Agadir','b_destination_latitude':30.4242,'b_destination_longitude':-9.596,
              'b_start_datetime':'now','b_car_class':1,'b_payment_way':1,'b_passengers_count':1,'b_cars_count':1,
              'b_location_class':1,'b_currency':'GHS','b_max_waiting':7200,'b_services':[5] if mode=='VOTE' else [1],
              'b_options':{'offer_mode':'OFFER','customer_price':150} if mode=='OFFER' else {}}
        principal=self.identities['client']['principal']
        with self.Session() as session:
            result=create_order(session,self.commands,principal,{'mode':mode,'data':data},uuid.uuid4().hex)
            session.commit()
        self.settle(result.response['instanceId'],principal)
        oid=result.response['entityId']
        with self.Session() as session:
            core_id=session.execute(text('SELECT core_order_id FROM core_order_mapping WHERE local_order_id=:id'),{'id':oid}).scalar_one()
        return oid,int(core_id)

    def observe(self,core_id,name='client'):
        principal=self.identities[name]['principal']
        booking=read_core_booking(self.core,principal.credentials,core_id)
        with self.Session() as session:
            observe_booking(session,booking,principal=principal);session.commit()
        return booking

    def respond(self,core_id,name='driver',candidate=True):
        item=self.identities[name]
        self.core.post(f'/drive/get/{core_id}',item['principal'].credentials,{'action':'set_performer','performer':0 if candidate else 1,'data':json.dumps({'c_id':item['car'],'c_payment_way':1,'c_options':{'performers_price':180,'driver_offer_eta':'5 minutes'}})})

    def test_all_modes_real_create_select_pin_arrive_start_finish(self):
        for mode in ['DIRECT','VOTE','OFFER']:
            with self.subTest(mode=mode):
                oid,core_id=self.create(mode)
                if mode=='VOTE': self.command(oid,'client','vote_requested')
                self.respond(core_id,candidate=mode!='DIRECT')
                booking=self.observe(core_id)
                if mode!='DIRECT': self.command(oid,'client','candidate_selected' if mode=='VOTE' else 'offer_selected',{'driverUserId':self.identities['driver']['id']})
                self.command(oid,'driver','driver_arrived')
                booking=self.observe(core_id)
                code=booking.get('b_driver_code')
                self.command(oid,'driver','ride_started',{'boardingCode':code} if mode=='VOTE' else {})
                self.command(oid,'driver','ride_finished')
                after=self.observe(core_id)
                driver=next(d for d in after['drivers'] if int(d['u_id'])==self.identities['driver']['id'])
                self.assertEqual(str(driver['c_state']),'6')
                print('PASS real PHP lifecycle',mode,flush=True)

    def test_real_driver_cancel_and_passenger_cancel(self):
        oid,core_id=self.create('DIRECT')
        self.respond(core_id,candidate=False);self.observe(core_id)
        self.command(oid,'driver','driver_cancel_requested',{'reason':'FSM local acceptance'})
        after=self.observe(core_id)
        # In the legacy API a driver cancels their participation; the passenger
        # may retain the order for another driver. Assert the actual contract.
        driver=next(d for d in after['drivers'] if int(d['u_id'])==self.identities['driver']['id'])
        self.assertEqual(str(driver['c_state']),'2')
        oid,core_id=self.create('DIRECT')
        self.command(oid,'client','cancel_requested',{'reason':'FSM local acceptance'})
        self.assertEqual(str(self.observe(core_id)['b_state']),'3')
