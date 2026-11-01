'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
const env={...process.env,NODE_OPTIONS:'--openssl-legacy-provider',GENERATE_SOURCEMAP:'false',CI:'true',WEBPACK_MINIFY_PARALLEL:'2'};
const run=(file,args=[])=>execFileSync(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit'});
run('tools/sync-drive-design.cjs');run('pre-build.js');
run('node_modules/tailwindcss/lib/cli.js',['-i','src/design/shadcn.source.css','-o','src/design/shadcn.generated.css','--minify']);
const mapDist=path.join(path.dirname(require.resolve('maplibre-gl/package.json')),'dist');
for(const name of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])fs.copyFileSync(path.join(mapDist,name),path.join('public/maps',name));
run('scripts/build.js');
execFileSync(process.execPath,['tools/build-cjm.cjs'],{cwd:root,env:{...env,QA_BUILD_MODE:'production',QA_OUTPUT_DIR:'build/qa'},stdio:'inherit'});
fs.copyFileSync('docs/qa/Taxi_QA_3_scenarios.pdf','build/review/qa-report-20261030.pdf');
fs.copyFileSync('docs/qa/audit-20261031-final/REPORT.pdf','build/review/qa-report.pdf');
fs.cpSync('docs/qa/audit-20261031-final','build/review/final-20261031',{recursive:true});
fs.cpSync('docs/qa/palette-1-20261031','build/review/palette-1-20261031',{recursive:true});
fs.cpSync('docs/qa/moroccan-red-20261101','build/review/moroccan-red-20261101',{recursive:true});

execFileSync(process.execPath,['tools/build-investor.cjs'],{cwd:root,env:{...env,INVESTOR_BUILD_MODE:'production',INVESTOR_OUTPUT_DIR:'build/investor'},stdio:'inherit'});

// Curated screenshots and report only; no account data or raw logs.
fs.cpSync('docs/qa/review-20261031','build/review/20261031',{recursive:true});
