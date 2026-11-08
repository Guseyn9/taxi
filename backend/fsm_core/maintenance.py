"""Bound pending work without ever unlocking an ambiguous Core write silently."""
from sqlalchemy import text
from .command_idempotency import update_command_status


def maintain_invocations(factory):
    from .outbox import OutboxEvent, OutboxCompletion
    from .invocations import finalize_invocation
    with factory() as session:
        rows = session.execute(text("""SELECT o.id,o.service,o.aggregate_type,o.aggregate_id,o.completion_json,o.attempts,o.write_attempted
            FROM fsm_entity_locks l JOIN core_outbox o ON o.id=l.outbox_event_id
            WHERE l.expires_at<CURRENT_TIMESTAMP AND o.status IN ('PENDING','RETRY')
            ORDER BY o.id LIMIT 100 FOR UPDATE SKIP LOCKED""")).fetchall()
        for row in rows:
            completion=OutboxCompletion.from_json(row[4])
            if completion is None or completion.invocation is None:
                continue
            error='CORE_OUTCOME_UNKNOWN' if row[6] else 'CORE_WAIT_TIMEOUT'
            event=OutboxEvent(int(row[0]),str(row[1]),str(row[2]),int(row[3]),'',{},'ibronevik',int(row[5]),0,'',completion)
            session.execute(text("UPDATE core_outbox SET status='FAILED',credentials_encrypted=NULL,last_error=:error,next_attempt_at=NULL WHERE id=:id"), {'id':row[0],'error':error})
            finalize_invocation(session,event,{},sent=False,error=error)
        stale=session.execute(text("""SELECT c.instance_id FROM fsm_command_credentials c
            JOIN server_fsm_instances i ON i.id=c.instance_id
            WHERE c.created_at<TIMESTAMPADD(SECOND,-3600,CURRENT_TIMESTAMP)
            AND i.instance_status='PENDING' LIMIT 100 FOR UPDATE SKIP LOCKED""")).fetchall()
        for row in stale:
            update_command_status(session,int(row[0]),'FAILED',error_code='AUTHORIZATION_FAILED',error_message='Stored session expired before processing')
            session.execute(text("UPDATE server_fsm_instances SET instance_status='FAILED',last_error='Stored session expired before processing' WHERE id=:id"), {'id':row[0]})
            session.execute(text('DELETE FROM fsm_command_credentials WHERE instance_id=:id'), {'id':row[0]})
        session.execute(text("DELETE c FROM fsm_command_credentials c JOIN fsm_command_idempotency i ON i.instance_id=c.instance_id WHERE i.status IN ('COMPLETED','FAILED')"))
        session.execute(text("UPDATE core_outbox SET credentials_encrypted=NULL WHERE status IN ('SENT','FAILED') AND credentials_encrypted IS NOT NULL"))
        session.commit()
