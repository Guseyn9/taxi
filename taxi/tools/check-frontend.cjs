// Local/CI checks only. Never starts a trip, emulator, login or live backend load.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const env={...process.env,CI:'true'};
require('./check-entrypoints.cjs').assertEntryPoints(root);
const steps=[['Unit and regression tests','scripts/test.js','--watchAll=false','--runInBand'],['Lint errors','node_modules/eslint/bin/eslint.js','src','--ext','.js,.jsx,.ts,.tsx','--quiet'],['TypeScript','node_modules/typescript/bin/tsc','--noEmit'],['Production build','scripts/build.js']];
if(process.env.TAXI_BASELINE_DIR)steps.push(['Backend command boundary','tools/verify-design-boundary.cjs']);
for(const [label,...args] of steps){console.log(label);const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:'inherit'});if(result.error){console.error(result.error.message);process.exit(1)}if(result.status!==0)process.exit(result.status||1)}
if(!process.env.TAXI_BASELINE_DIR)console.log('Boundary comparison skipped: provide TAXI_BASELINE_DIR pointing to the clean baseline app.');
