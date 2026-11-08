"""Import/reconcile only bookings read from Core with a verified user session.

The browser's booking id and the FSM row id are separate namespaces. No caller
may populate authoritative owner, performer or candidates from a JSON payload.
"""
import json
from collections import deque
from sqlalchemy import text
from fsm import call_fsm_action
from fsm_core.errors import AuthorizationError, EntitySyncInProgress
from fsm_core.serialization import json_dumps, json_loads_object
from fsm_core.realtime import record_transition_event
from fsm_core.repositories import TransitionRepository
from .fsm_spec import ORDER_TRANSITIONS
from .invocations import extract_booking
from .models import OrderMode
from .repositories import OrderRepository


def entries(value):
    return list(value.values()) if isinstance(value, dict) else value if isinstance(value, list) else []


def booking_projection(booking):
    core_id, owner = int(booking['b_id']), int(booking['u_id'])
    drivers = [d for d in entries(booking.get('drivers')) if isinstance(d, dict) and str(d.get('u_id', '')).isdigit()]
    driver_records={}
    for record in drivers:
        options=record.get('c_options') or {}
        if isinstance(options,str): options=json.loads(options)
        if not isinstance(options,dict): options={}
        driver_records[str(record['u_id'])]={k:v for k,v in record.items() if k in {'u_id','c_id','c_state','c_arrived','c_started','c_completed','c_price','c_payment_way'}}
        driver_records[str(record['u_id'])]['c_options']={k:v for k,v in options.items() if k in {'performers_price','driver_offer_eta','driver_offer_comment'}}
    performer = next((d for d in drivers if str(d.get('c_state')) in {'3','4','5','6'}), None)
    options = booking.get('b_options') or {}
    if isinstance(options, str):
        options = json.loads(options)
    if not isinstance(options, dict):
        options = {}
    services = booking.get('b_services') or []
    if isinstance(services, str):
        services = services.split(',')
    mode = 'VOTE' if str(booking.get('b_voting')).lower() in {'true','1'} or '5' in {str(v) for v in services} else 'OFFER' if options.get('offer_mode') == 'OFFER' else 'DIRECT'
    state = str(booking.get('b_state'))
    if state == '3':
        target = 'order_cancelled'
    elif state == '4':
        target = 'order_completed'
    elif performer:
        target = {'3':'order_vote_driver_assigned' if mode=='VOTE' else 'order_driver_assigned', '4':'order_driver_arrived', '5':'order_in_ride', '6':'order_completed'}[str(performer['c_state'])]
    else:
        target = 'order_vote_waiting_candidates' if mode=='VOTE' and str(booking.get('b_confirm_state'))=='1' else 'order_offer_waiting' if mode=='OFFER' else 'order_created'
    def candidate(d):
        options=driver_records[str(d['u_id'])]['c_options']
        return {'user_id':int(d['u_id']),'car_id':d.get('c_id'),'state':d.get('c_state'),'price':options.get('performers_price',d.get('c_price')),'eta':options.get('driver_offer_eta')}
    candidates = [candidate(d) for d in drivers if str(d.get('c_state')) == '1']
    selected = candidate(performer) if performer else None
    metadata = {'mode':mode, 'client_user_id':owner, 'driver_user_id':selected['user_id'] if selected else None,
        'selected_candidate':selected, 'selected_offer':selected if mode=='OFFER' else None,
        'candidates':candidates, 'offers':candidates if mode=='OFFER' else [],
        'cancelled_driver_user_ids':[int(d['u_id']) for d in drivers if str(d.get('c_state'))=='2'],
        'driver_records':driver_records,
        'price':booking.get('b_price_estimate'), 'booking':{k:v for k,v in booking.items() if k in PUBLIC_BOOKING_FIELDS}}
    return core_id, owner, selected['user_id'] if selected else None, target, metadata


PUBLIC_BOOKING_FIELDS = frozenset('b_id b_state u_id b_start_address b_destination_address b_start_latitude b_start_longitude b_destination_latitude b_destination_longitude b_price_estimate b_currency b_start_datetime b_custom_comment b_cars_count b_services b_car_class b_payment_way'.split())


def observe_booking(session, booking, *, principal=None):
    core_id, owner, performer, target, metadata = booking_projection(booking)
    if principal and not principal.has_role('admin'):
        related = owner == principal.user_id or any(str(d.get('u_id')) == str(principal.user_id) for d in entries(booking.get('drivers')))
        if not related:
            raise AuthorizationError('Core booking does not belong to this user')
    mapping = session.execute(text('SELECT local_order_id FROM core_order_mapping WHERE core_order_id=:core FOR UPDATE'), {'core':core_id}).fetchone()
    if mapping is None:
        oid = OrderRepository(session).create(mode=OrderMode(metadata['mode']), metadata_json=metadata, status=target, description=booking.get('b_custom_comment'))
        session.execute(text('INSERT INTO core_order_mapping(local_order_id,core_order_id,client_local_user_id,performer_local_user_id,b_state) VALUES(:id,:core,:owner,:driver,:state)'), dict(id=oid,core=core_id,owner=owner,driver=performer,state=int(booking['b_state'])))
        return oid
    oid = int(mapping[0])
    order = OrderRepository(session).get(oid, for_update=True)
    pending = session.execute(text("SELECT outbox_event_id FROM fsm_entity_locks WHERE service='taxi' AND entity_type='order' AND entity_id=:id FOR UPDATE"), {'id':oid}).fetchone()
    if pending:
        return oid  # Never move the local projection around an in-flight write.
    # An immutable command's unknown outcome requires explicit operator recovery.
    unresolved = session.execute(text("SELECT id FROM fsm_sync_mismatches WHERE service='taxi' AND entity_type='order' AND entity_id=:id AND resolved_at IS NULL"), {'id':oid}).fetchone()
    if unresolved:
        return oid
    if order.status != target:
        path = transition_path(order.status, target)
        if path is None:
            session.execute(text("INSERT INTO fsm_sync_mismatches(service,entity_type,entity_id,reason,observed_json) SELECT 'taxi','order',:id,'CORE_STATE_NOT_REACHABLE',:observed WHERE NOT EXISTS(SELECT 1 FROM fsm_sync_mismatches WHERE service='taxi' AND entity_type='order' AND entity_id=:id AND resolved_at IS NULL)"), {'id':oid,'observed':json_dumps({'state':target, 'bState':booking['b_state']})})
            return oid
        OrderRepository(session).patch_metadata(oid, metadata)
        for step in path:
            # This is a read-only observation of a change already made in Core.
            # Do not enqueue a second Core write or impersonate its initiator.
            call_fsm_action(session, service='taxi', entity_type='order', entity_id=oid, action_name=step.action, expected_state=step.from_state, user_id=0)
            transition = TransitionRepository().get(session, service='taxi', entity_type='order', from_state=step.from_state, action_name=step.action)
            record_transition_event(session, service='taxi',entity_type='order',entity_id=oid,transition=transition)
    else:
        OrderRepository(session).patch_metadata(oid, metadata)
    session.execute(text('UPDATE core_order_mapping SET client_local_user_id=:owner,performer_local_user_id=:driver,b_state=:state WHERE local_order_id=:id'), dict(owner=owner,driver=performer,state=int(booking['b_state']),id=oid))
    return oid


def transition_path(source, target):
    queue, seen = deque([(source, [])]), {source}
    while queue:
        state, path = queue.popleft()
        if state == target:
            return path
        for step in ORDER_TRANSITIONS:
            if step.from_state == state and step.to_state not in seen:
                seen.add(step.to_state)
                queue.append((step.to_state, path+[step]))
    return None


def read_core_booking(client, credentials, core_id):
    result = client.post(f'/drive/get/{int(core_id)}', credentials, {'fields':'00000000u1'})
    booking = extract_booking(result, core_id)
    if booking is None:
        raise ValueError('Core did not return the requested booking')
    return booking
