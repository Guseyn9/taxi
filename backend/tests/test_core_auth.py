import asyncio
import json
import unittest
from types import SimpleNamespace
from cryptography.fernet import Fernet
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from fsm_core.core_client import CoreClient, UserCredentials, CredentialCipher, CoreRefused, CoreUnavailable
from fsm_core.core_auth import IbronevikPrincipalProvider
from fsm_core.errors import AuthenticationError, AuthenticationUnavailable
from fsm_core.realtime_api import create_realtime_router
from fsm_core.realtime import InMemoryRealtimeHub
from fsm_core.command_service import parse_command_envelope, CommandValidationError

class CoreAuthenticationTests(unittest.TestCase):
    def setUp(self):
        self.pair = UserCredentials('private-token','private-hash')
        self.calls=[]
        self.response={'code':'200','status':'success','auth_user':{'u_id':'205','u_role':'2','u_active':'1','u_ban':'0'}}
        self.http_status=200
        def remote(request):
            self.calls.append(request)
            return httpx.Response(self.http_status,json=self.response)
        self.client=CoreClient('https://core.example.test/api',transport=httpx.MockTransport(remote))
        self.addCleanup(self.client.close)
        self.provider=IbronevikPrincipalProvider(self.client)

    def test_verified_identity_and_hashed_cache(self):
        for _ in range(2):
            p=self.provider.authenticate(self.pair)
            self.assertEqual((p.user_id,p.roles),(205,('driver',)))
            self.assertNotIn('private',repr(p))
        self.assertEqual(len(self.calls),1)
        request=self.calls[0]
        self.assertEqual(str(request.url),'https://core.example.test/api/user/authorized')
        self.assertIn('multipart/form-data',request.headers['content-type'])
        self.assertIn('name="u_hash"',request.content.decode())
        self.assertNotIn('private',repr(self.provider.cache))

    def test_pair_not_token_alone_keys_cache(self):
        self.provider.authenticate(self.pair)
        self.provider.authenticate(UserCredentials(self.pair.token,'another-hash'))
        self.assertEqual(len(self.calls),2)

    def test_http_200_auth_error_is_unauthorized(self):
        self.response={'code':'404','status':'error','message':'unauthorized private-token'}
        with self.assertRaises(AuthenticationError) as ctx: self.provider.authenticate(self.pair)
        self.assertNotIn('private',str(ctx.exception))

    def test_auth_outage_is_503_semantics(self):
        self.http_status=503
        with self.assertRaises(AuthenticationUnavailable): self.provider.authenticate(self.pair)

    def test_untrusted_role_and_missing_identity_are_rejected(self):
        for user in [None,{}, {'u_id':205,'u_role':999}, {'u_id':205,'u_role':2,'u_ban':1}, {'u_id':205,'u_role':2,'u_active':0}]:
            self.response={'code':200,'status':'success','auth_user':user}
            with self.subTest(user=user), self.assertRaises(AuthenticationError): self.provider.authenticate(self.pair)

    def test_explicit_data_user_shape(self):
        self.response={'code':'200','status':'success','data':{'user':{'205':{'u_id':205,'u_role':2}}}}
        self.assertEqual(self.provider.authenticate(self.pair).user_id,205)

    def test_cipher_rotation_tampering_and_missing_pair(self):
        old,new=Fernet.generate_key(),Fernet.generate_key()
        encrypted=CredentialCipher([old]).encrypt(self.pair)
        self.assertEqual(CredentialCipher([new,old]).decrypt(encrypted),self.pair)
        self.assertNotIn('private',encrypted)
        with self.assertRaises(AuthenticationError): CredentialCipher([new]).decrypt(encrypted)
        for token,uhash in [('', ''),(None,'hash'),(123,'hash'),('token',{})]:
            with self.assertRaises(AuthenticationError): UserCredentials(token,uhash)

    def test_no_credentials_in_public_command_payload(self):
        for payload in [{'token':'secret'},{'nested':[{'u_hash':'secret'}]}]:
            with self.assertRaises(CommandValidationError): parse_command_envelope({'intent':'ride_started','commandId':'one','payload':payload})

    def test_business_failure_even_with_http_200_and_safe_error(self):
        self.response={'code':'500','status':'error','message':'private-token SQL stack'}
        with self.assertRaises(CoreRefused) as ctx: self.client.post('/drive/get/901',self.pair,{'action':'set_cancel_state'})
        self.assertEqual(str(ctx.exception),'CORE_REJECTED')

    def test_no_redirects_or_insecure_remote_roots(self):
        for url in ['http://example.com','https://user:pass@example.com','https://example.com?token=secret']:
            with self.assertRaises(ValueError): CoreClient(url)
        self.http_status=302
        with self.assertRaises(CoreRefused): self.client.post('/drive',self.pair)
        self.assertEqual(len(self.calls),1)

    def app(self):
        app=FastAPI()
        app.state.principal_provider=self.provider
        app.state.snapshot_service=SimpleNamespace(build=lambda **kw: {'orderId':901,'state':'order_driver_assigned'})
        app.state.realtime_hub=InMemoryRealtimeHub()
        app.include_router(create_realtime_router())
        return app

    def test_websocket_requires_auth_before_snapshot(self):
        with TestClient(self.app()) as client:
            with client.websocket_connect('/api/realtime/ws/taxi/order/901') as ws:
                ws.send_json({'type':'auth','token':self.pair.token,'u_hash':self.pair.u_hash})
                self.assertEqual(ws.receive_json()['type'],'snapshot')

    def test_websocket_rejects_query_credentials_and_wrong_first_message(self):
        with TestClient(self.app()) as client:
            with self.assertRaises(WebSocketDisconnect) as ctx:
                with client.websocket_connect('/api/realtime/ws/taxi/order/901?token=private-token'): pass
            self.assertEqual(ctx.exception.code,4401)
            with client.websocket_connect('/api/realtime/ws/taxi/order/901') as ws:
                ws.send_json({'type':'subscribe','userId':205,'role':'admin'})
                with self.assertRaises(WebSocketDisconnect) as ctx: ws.receive_json()
                self.assertEqual(ctx.exception.code,4401)

    def test_websocket_times_out_before_sending_snapshot(self):
        with TestClient(self.app()) as client:
            with client.websocket_connect('/api/realtime/ws/taxi/order/901') as ws:
                with self.assertRaises(WebSocketDisconnect) as ctx: ws.receive_json()
                self.assertEqual(ctx.exception.code,4401)

class ProductionAuthenticationModeTests(unittest.TestCase):
    def test_domain_responses_and_errors_are_not_cached(self):
        from fsm_api import app
        client = TestClient(app)  # No lifespan/DB required for these routes.
        for path in ['/api/taxi/features', '/api/unknown-route']:
            response = client.get(path)
            self.assertEqual(response.headers.get('cache-control'), 'no-store')

    def test_scope_principal_mode_is_restricted_to_explicit_tests(self):
        import os
        from unittest.mock import patch
        from fsm_api import build_principal_provider
        with patch.dict(os.environ, {'FSM_AUTH_MODE':'scope','FSM_ENV':'production'}):
            with self.assertRaises(RuntimeError): build_principal_provider()
        with patch.dict(os.environ, {'FSM_AUTH_MODE':'scope','FSM_ENV':'test'}):
            self.assertEqual(type(build_principal_provider()).__name__,'ScopePrincipalProvider')

if __name__=='__main__': unittest.main()
