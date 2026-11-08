"""Explicit operator repair from a fresh Core read; never replay a Core write."""
import argparse
import os
from sqlalchemy import text
from fsm_core.core_client import CoreClient, UserCredentials
from fsm_core.database import build_session_factory_from_env
from fsm_core.security import Principal
from fsm_core.realtime import enqueue_realtime_event
from domains.taxi.core_projection import read_core_booking, booking_projection
from domains.taxi.repositories import OrderRepository


def apply_resolution(session, mismatch_id, booking, *, operator):
    row=session.execute(text("SELECT entity_id,resolved_at FROM fsm_sync_mismatches WHERE id=:id FOR UPDATE"),{'id':mismatch_id}).fetchone()
    if not row or row[1] is not None:
        raise ValueError('Mismatch is missing or already resolved')
    oid=int(row[0])
    order=OrderRepository(session).get(oid,for_update=True)
    core_id,owner,driver,target,metadata=booking_projection(booking)
    mapping=session.execute(text('SELECT core_order_id,client_local_user_id FROM core_order_mapping WHERE local_order_id=:id'),{'id':oid}).fetchone()
    if not mapping or mapping[0] != core_id or owner != mapping[1]:
        raise ValueError('Core identity/ownership does not match the original local mapping')
    if not operator.has_role('admin') and operator.user_id != owner:
        raise ValueError('Operator cannot read this passenger order')
    if session.execute(text("SELECT outbox_event_id FROM fsm_entity_locks WHERE service='taxi' AND entity_type='order' AND entity_id=:id"),{'id':oid}).fetchone():
        raise ValueError('An active Core invocation still owns the order')
    # This narrowly scoped maintenance correction is deliberately not a public
    # intent or a normal transition. Preserve its evidence in the action log.
    session.execute(text('UPDATE orders SET status=:target WHERE id=:id AND status=:expected'),{'id':oid,'target':target,'expected':order.status})
    OrderRepository(session).patch_metadata(oid,metadata)
    session.execute(text('UPDATE core_order_mapping SET b_state=:state,performer_local_user_id=:driver WHERE local_order_id=:id'),{'id':oid,'state':int(booking['b_state']),'driver':driver})
    session.execute(text("INSERT INTO fsm_action_logs(service,entity_type,entity_id,action_name,from_state,to_state,user_id) VALUES('taxi','order',:id,'core_operator_reconcile',:old,:new,:uid)"),{'id':oid,'old':order.status,'new':target,'uid':operator.user_id})
    session.execute(text("UPDATE fsm_sync_mismatches SET resolved_at=CURRENT_TIMESTAMP,resolution='Operator verified a fresh Core snapshot; original command status preserved' WHERE id=:id"),{'id':mismatch_id})
    enqueue_realtime_event(session,service='taxi',entity_type='order',entity_id=oid,event_type='core.reconciled',payload={'fromState':order.status,'toState':target})
    return target


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--id',type=int,required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    factory=build_session_factory_from_env()
    with factory() as session:
        row=session.execute(text('SELECT m.core_order_id,j.entity_id,j.reason FROM fsm_sync_mismatches j JOIN core_order_mapping m ON m.local_order_id=j.entity_id WHERE j.id=:id AND j.resolved_at IS NULL'),{'id':args.id}).fetchone()
    if row is None or row[0] is None:
        raise RuntimeError('No mapped Core id; unknown creation requires a separately reviewed mapping')
    client=CoreClient.from_env()
    credentials=UserCredentials(os.environ['FSM_RECONCILE_TOKEN'],os.environ['FSM_RECONCILE_U_HASH'])
    try:
        uid,role=client.authorize(credentials)
        booking=read_core_booking(client,credentials,row[0])
        target=booking_projection(booking)[3]
        print({'mismatchId':args.id,'entityId':row[1],'reason':row[2],'observedState':target,'apply':args.apply})
        if args.apply:
            with factory() as session:
                apply_resolution(session,args.id,booking,operator=Principal(uid,(role,)))
                session.commit()
    finally:
        client.close()

if __name__=='__main__': main()
