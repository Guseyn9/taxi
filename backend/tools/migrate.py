"""Apply the versioned schema once. Stop API/FSM/outbox processes first."""
from pathlib import Path
import hashlib
from sqlalchemy import text
from fsm_core.database import build_session_factory_from_env
ROOT = Path(__file__).resolve().parents[1]
FILES = ['fsm_core/sql/install_fsm_platform.sql', 'fsm_core/sql/003_fsm_platform.sql',
         'stand/001_taxi_tables.sql', 'fsm_core/sql/005_outbox_realtime.sql',
         'fsm_core/sql/006_command_api.sql', 'fsm_core/sql/007_add_status_to_command_idempotency.sql',
         'fsm_core/sql/008_outbox_command_completion.sql', 'domains/taxi/sql/taxi_order_fsm_seed.sql',
         'fsm_core/sql/009_transition_invocations.sql', 'fsm_core/sql/010_taxi_core_first.sql', 'fsm_core/sql/011_taxi_creation.sql', 'fsm_core/sql/012_reconciliation.sql', 'fsm_core/sql/013_core_delivery_attempt.sql', 'fsm_core/sql/014_core_mapping_unique.sql']

def statements(source):
    delimiter, buffer, quote = ';', '', None
    for line in source.splitlines():
        if line.strip().upper().startswith('DELIMITER '):
            delimiter = line.strip().split()[1]
            continue
        if line.lstrip().startswith('--') or not line.strip():
            continue
        for char in line + '\n':
            buffer += char
            if char in {"'", '"', '`'}:
                if quote is None:
                    quote = char
                elif quote == char:
                    quote = None
            if quote is None and buffer.endswith(delimiter):
                if buffer[:-len(delimiter)].strip():
                    yield buffer[:-len(delimiter)]
                buffer = ''
    if buffer.strip():
        raise RuntimeError('Unterminated migration SQL')

def migrate():
    factory = build_session_factory_from_env()
    with factory() as session:
        session.execute(text('CREATE TABLE IF NOT EXISTS fsm_schema_migrations(name VARCHAR(255) PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)'))
        session.commit()
        connection = session.connection().connection
        cursor = connection.cursor()
        try:
            cursor.execute("SELECT GET_LOCK('fsm-schema-migration',30)")
            if cursor.fetchone()[0] != 1:
                raise RuntimeError('Another FSM migration is running')
            cursor.execute("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='fsm_schema_migrations' AND COLUMN_NAME='sha256'")
            if not cursor.fetchone()[0]:
                cursor.execute('ALTER TABLE fsm_schema_migrations ADD COLUMN sha256 CHAR(64) NULL')
            for name in FILES:
                digest=hashlib.sha256((ROOT/name).read_bytes()).hexdigest()
                cursor.execute('SELECT sha256 FROM fsm_schema_migrations WHERE name=%s', (name,))
                prior=cursor.fetchone()
                if prior:
                    if prior[0] and prior[0] != digest:
                        raise RuntimeError('Applied migration changed: '+name)
                    if not prior[0]:
                        cursor.execute('UPDATE fsm_schema_migrations SET sha256=%s WHERE name=%s',(digest,name))
                        connection.commit()
                    continue
                for sql in statements((ROOT / name).read_text()):
                    cursor.execute(sql)
                    if cursor.with_rows:
                        cursor.fetchall()
                cursor.execute('INSERT INTO fsm_schema_migrations(name,sha256) VALUES(%s,%s)', (name,digest))
                connection.commit()
                print('Applied', name)
        finally:
            cursor.execute("SELECT RELEASE_LOCK('fsm-schema-migration')")
            cursor.fetchone()
            cursor.close()
if __name__ == '__main__':
    migrate()
