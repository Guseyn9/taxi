"""Read-only Core -> FSM polling. Never invokes a Core mutation."""
import argparse
import logging
import os
import signal
import threading
from sqlalchemy import text
from fsm_core.core_client import CoreClient, UserCredentials
from fsm_core.database import build_session_factory_from_env
from domains.taxi.core_projection import observe_booking, read_core_booking

logger = logging.getLogger(__name__)


class ReadOnlyCoreClient:
    def __init__(self, client):
        self.client = client

    def post(self, path, credentials, fields=None):
        import re
        if not re.fullmatch(r'/drive/get/[1-9][0-9]*', path) or set(fields or {}) - {'fields','array_type'}:
            raise ValueError('Reconciliation account cannot issue a Core mutation')
        return self.client.post(path, credentials, fields)


def reconcile_once(factory, client, credentials, *, limit=100):
    with factory() as session:
        # Rotate through the full mapping, including terminal orders; independent
        # of clients staying connected or a particular FSM worker process.
        rows=session.execute(text('SELECT local_order_id,core_order_id FROM core_order_mapping WHERE core_order_id IS NOT NULL ORDER BY COALESCE(reconciled_at,\'1970-01-01\'),local_order_id LIMIT :limit'), {'limit':limit}).fetchall()
    result={'checked':0,'failed':0}
    for _, core_id in rows:
        try:
            booking=read_core_booking(client,credentials,core_id)
            with factory() as session:
                oid=observe_booking(session,booking)
                session.execute(text('UPDATE core_order_mapping SET reconciled_at=CURRENT_TIMESTAMP WHERE local_order_id=:id'), {'id':oid})
                session.commit()
            result['checked']+=1
        except Exception:
            # Do not log remote bodies or credentials, even through tracebacks.
            result['failed']+=1
            logger.warning('Core read/reconciliation unavailable for booking %s',core_id)
    return result


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--list-mismatches',action='store_true')
    args=parser.parse_args()
    logging.basicConfig(level=logging.INFO)
    factory=build_session_factory_from_env()
    if args.list_mismatches:
        with factory() as session:
            for row in session.execute(text('SELECT id,entity_id,outbox_event_id,reason,created_at FROM fsm_sync_mismatches WHERE resolved_at IS NULL ORDER BY id')):
                print(dict(row._mapping))
        return
    client=CoreClient.from_env()
    credentials=UserCredentials(os.environ['FSM_RECONCILE_TOKEN'],os.environ['FSM_RECONCILE_U_HASH'])
    client.authorize(credentials)
    readonly=ReadOnlyCoreClient(client)
    stop=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):
        signal.signal(sig,lambda *_: stop.set())
    try:
        while not stop.is_set():
            result=reconcile_once(factory,readonly,credentials)
            logger.info('Reconciliation checked=%d failed=%d',result['checked'],result['failed'])
            if args.once: break
            stop.wait(max(1,min(60,float(os.getenv('FSM_RECONCILE_POLL_SECONDS','15')))))
    finally:
        client.close()

if __name__=='__main__': main()
