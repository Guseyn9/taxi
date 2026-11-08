"""Local launcher; the Docker deployment obtains the same environment externally."""
import argparse
from pathlib import Path
from dotenv import load_dotenv

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('process',choices=['api','worker','outbox','reconcile','migrate'])
    parser.add_argument('--port',type=int,default=18089)
    args=parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    if args.process=='api':
        import uvicorn
        uvicorn.run('fsm_api:app',host='127.0.0.1',port=args.port,ws_max_size=16384)
    elif args.process=='worker':
        from fsm_worker import main as run
        run()
    elif args.process=='outbox':
        from outbox_worker import main as run
        run()
    elif args.process=='reconcile':
        import sys
        from reconcile_worker import main as run
        sys.argv=[sys.argv[0]]
        run()
    else:
        from tools.migrate import migrate
        migrate()

if __name__=='__main__': main()
