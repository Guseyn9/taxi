"""Reserve a local order and enqueue Core creation in the same transaction."""
import asyncio
import hashlib
import json
from fastapi import APIRouter, Request
from sqlalchemy import text
from fsm_core.command_service import CommandValidationError, parse_command_envelope
from fsm_core.command_api import _http_error, _status_response
from fsm_core.errors import AuthenticationError, AuthenticationUnavailable, AuthorizationError, EntitySyncInProgress, CommandNotFoundError
from fsm_core.core_client import CoreRefused, CoreUnavailable
from .core_projection import read_core_booking, observe_booking, entries, booking_projection
from .models import OrderMode
from .repositories import OrderRepository

CREATE_FIELDS = frozenset('b_start_address b_start_latitude b_start_longitude b_destination_address b_destination_latitude b_destination_longitude b_start_datetime b_custom_comment b_flight_number b_terminal b_passengers_count b_luggage_count b_placard b_car_class b_payment_way b_payment_card b_cars_count b_max_waiting b_options b_contact b_comments b_services b_location_class b_currency'.split())


def create_order(session, command_service, principal, body, key):
    if not principal.has_role('client', 'passenger'):
        raise AuthorizationError('Only a passenger may create an order')
    if principal.credentials is None:
        raise AuthenticationError('A user session is required')
    if not isinstance(body, dict) or not isinstance(body.get('data'), dict):
        raise CommandValidationError('data must be an order object')
    mode = OrderMode(body.get('mode', 'VOTE'))
    data = body['data']
    if set(data) - CREATE_FIELDS:
        raise CommandValidationError('Unsupported order fields')
    if len(json.dumps(data)) > 64000:
        raise CommandValidationError('Order exceeds size limit')
    # Validate nested options too; credentials never belong in domain JSON.
    parse_command_envelope({'commandId':key,'intent':'order_registered','payload':data})
    envelope = parse_command_envelope({'schemaVersion': '1.0', 'commandId': key, 'intent': 'order_registered'})
    if len(key) > 128:
        raise CommandValidationError('Idempotency key exceeds 128 characters')
    digest = hashlib.sha256(json.dumps({'data': data, 'mode': mode.value}, sort_keys=True).encode()).hexdigest()
    params = dict(uid=principal.user_id, key=key, digest=digest)
    session.execute(text('INSERT IGNORE INTO fsm_order_create_keys(user_id,idempotency_key,request_digest) VALUES(:uid,:key,:digest)'), params)
    row = session.execute(text('SELECT local_order_id,request_digest FROM fsm_order_create_keys WHERE user_id=:uid AND idempotency_key=:key FOR UPDATE'), params).fetchone()
    if row[1] != digest:
        raise CommandValidationError('Idempotency key was used for another order')
    order_id = row[0]
    if order_id is None:
        order_id = OrderRepository(session).create(mode=mode, metadata_json={'client_user_id': principal.user_id, 'create_data': data, 'candidates': [], 'offers': []})
        session.execute(text('INSERT INTO core_order_mapping(local_order_id,client_local_user_id) VALUES(:id,:uid)'), dict(id=order_id, uid=principal.user_id))
        session.execute(text('UPDATE fsm_order_create_keys SET local_order_id=:id WHERE user_id=:uid AND idempotency_key=:key'), dict(params, id=order_id))
    return command_service.accept(session, principal=principal, service='taxi', entity_type='order', entity_id=order_id, envelope=envelope)


def create_taxi_router():
    router = APIRouter(prefix='/api/taxi', tags=['taxi'])

    def core_client(request):
        return request.app.state.core_client

    def resolve_order(request, principal, core_id):
        with request.app.state.session_factory() as session:
            oid = session.execute(text('SELECT local_order_id FROM core_order_mapping WHERE core_order_id=:core'), {'core':core_id}).scalar()
        if oid is not None:
            return int(oid)
        booking = read_core_booking(core_client(request), principal.credentials, core_id)
        with request.app.state.session_factory() as session:
            oid = observe_booking(session, booking, principal=principal)
            session.commit()
            return oid

    @router.get('/drivers/{driver_id}')
    async def driver_snapshot(request: Request, driver_id: int):
        try:
            principal = await asyncio.to_thread(request.app.state.principal_provider.from_http, request)
            if not principal.has_role('driver') or principal.user_id != driver_id:
                raise AuthorizationError('Only the authenticated driver may read this feed')
            def run():
                from .query_api import _driver_order_card
                from .models import Order
                ready = []
                for path in ['/drive', '/drive/archive', '/drive/now']:
                    remote = core_client(request).post(path, principal.credentials, {'fields':'00000000u1', 'array_type':'list'})
                    bookings = entries(remote.get('data', {}).get('booking'))
                    with request.app.state.session_factory() as session:
                        for booking in bookings[:200]:
                            if path == '/drive/now' and not any(str(d.get('u_id')) == str(driver_id) for d in entries(booking.get('drivers'))):
                                core_id, _, _, state, metadata = booking_projection(booking)
                                order = Order(core_id,state,OrderMode(metadata['mode']),metadata_json=metadata,core_order_id=core_id,b_state=int(booking['b_state']))
                                ready.append(_driver_order_card(order, principal=principal))
                            else:
                                observe_booking(session, booking, principal=principal)
                        session.commit()
                result = request.app.state.snapshot_service.build(principal=principal,service='taxi',entity_type='driver',entity_id=driver_id)
                for name in ['readyOrders','activeOrders','historyOrders']:
                    for card in result['driver'][name]:
                        card['fsmOrderId'], card['orderId'] = card['orderId'], card['coreOrderId']
                if result['driver']['currentTrip']:
                    result['driver']['currentTrip']['orderId'] = result['driver']['currentTrip']['coreOrderId']
                ids = {str(c['orderId']) for c in result['driver']['readyOrders']}
                result['driver']['readyOrders'].extend(c for c in ready if str(c['orderId']) not in ids)
                return result
            return await asyncio.to_thread(run)
        except CoreRefused as exc:
            raise _http_error(AuthorizationError('Core did not authorize this driver feed')) from exc
        except CoreUnavailable as exc:
            raise _http_error(AuthenticationUnavailable('Core unavailable')) from exc
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, ValueError) as exc:
            raise _http_error(exc) from exc

    @router.post('/core-orders/{core_id}/commands')
    async def command(request: Request, core_id: int):
        try:
            principal = await asyncio.to_thread(request.app.state.principal_provider.from_http, request)
            envelope = parse_command_envelope(await request.json(), idempotency_header=request.headers.get('idempotency-key'))
            def run():
                oid = resolve_order(request, principal, core_id)
                with request.app.state.session_factory() as session:
                    result = request.app.state.command_service.accept(session, principal=principal, service='taxi',entity_type='order',entity_id=oid,envelope=envelope)
                    session.rollback() if result.duplicate else session.commit()
                    return result
            result = await asyncio.to_thread(run)
            return _status_response(result.response, status_code=200 if result.duplicate else 202)
        except CoreRefused as exc:
            raise _http_error(AuthenticationError('Core did not authorize this booking')) from exc
        except CoreUnavailable as exc:
            raise _http_error(AuthenticationUnavailable('Core unavailable')) from exc
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, EntitySyncInProgress, CommandValidationError, CommandNotFoundError, ValueError) as exc:
            raise _http_error(exc) from exc

    @router.get('/core-orders/{core_id}')
    async def snapshot(request: Request, core_id: int):
        try:
            principal = await asyncio.to_thread(request.app.state.principal_provider.from_http, request)
            def run():
                booking = read_core_booking(core_client(request), principal.credentials, core_id)
                with request.app.state.session_factory() as session:
                    oid = observe_booking(session, booking, principal=principal)
                    session.commit()
                result = request.app.state.snapshot_service.build(principal=principal,service='taxi',entity_type='order',entity_id=oid)
                result.update(fsmOrderId=oid, orderId=core_id)
                return result
            return await asyncio.to_thread(run)
        except CoreRefused as exc:
            raise _http_error(AuthorizationError('Core did not authorize this booking')) from exc
        except CoreUnavailable as exc:
            raise _http_error(AuthenticationUnavailable('Core unavailable')) from exc
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, EntitySyncInProgress, ValueError) as exc:
            raise _http_error(exc) from exc

    @router.post('/orders')
    async def create(request: Request):
        try:
            principal = await asyncio.to_thread(request.app.state.principal_provider.from_http, request)
            body = await request.json()
            key = request.headers.get('idempotency-key', '')
            if not key:
                raise CommandValidationError('Idempotency-Key is required')
            def run():
                with request.app.state.session_factory() as session:
                    result = create_order(session, request.app.state.command_service, principal, body, key)
                    session.rollback() if result.duplicate else session.commit()
                    return result
            result = await asyncio.to_thread(run)
            return _status_response(result.response, status_code=200 if result.duplicate else 202)
        except (AuthenticationError, AuthenticationUnavailable, AuthorizationError, EntitySyncInProgress, CommandValidationError, ValueError) as exc:
            raise _http_error(exc) from exc
    return router
