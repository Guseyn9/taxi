'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
require('./lib/report-artifact.cjs').verifyReportPdf(root);
const env={...process.env,GENERATE_SOURCEMAP:'false',CI:'true',WEBPACK_MINIFY_PARALLEL:'2'};
const run=(file,args=[])=>execFileSync(process.execPath,[file,...args],{cwd:root,env,stdio:'inherit'});
run('tools/sync-drive-design.cjs');run('pre-build.js');
run('node_modules/tailwindcss/lib/cli.js',['-i','src/design/shadcn.source.css','-o','src/design/shadcn.generated.css','--minify']);
const mapDist=path.join(path.dirname(require.resolve('maplibre-gl/package.json')),'dist');
for(const name of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs'])fs.copyFileSync(path.join(mapDist,name),path.join('public/maps',name));
run('scripts/build.js');
execFileSync(process.execPath,['tools/build-cjm.cjs'],{cwd:root,env:{...env,QA_BUILD_MODE:'production',QA_OUTPUT_DIR:'build/qa'},stdio:'inherit'});
execFileSync(process.execPath,['tools/build-cjm.cjs'],{cwd:root,env:{...env,QA_BUILD_MODE:'production',QA_ENTRY:'src/qa/auth-entry.tsx',QA_OUTPUT_DIR:'build/qa/forms',QA_ROUTE:'/qa/forms/'},stdio:'inherit'});
execFileSync(process.execPath,['tools/build-cjm.cjs'],{cwd:root,env:{...env,QA_BUILD_MODE:'production',QA_ENTRY:'src/qa/graph-entry.tsx',QA_OUTPUT_DIR:'build/review/graph',QA_ROUTE:'/review/graph/',QA_CONNECT_POLICY:'self'},stdio:'inherit'});
execFileSync(process.execPath,['tools/build-cjm.cjs'],{cwd:root,env:{...env,QA_BUILD_MODE:'production',QA_ENTRY:'src/qa/zones-entry.tsx',QA_OUTPUT_DIR:'build/qa/zones',QA_ROUTE:'/qa/zones/',QA_CONNECT_POLICY:'map'},stdio:'inherit'});
fs.copyFileSync('docs/qa/Taxi_QA_3_scenarios.pdf','build/review/qa-report-20261030.pdf');
fs.copyFileSync('docs/qa/audit-20261031-final/REPORT.pdf','build/review/qa-report-20261031.pdf');
fs.cpSync('docs/qa/audit-20261031-final','build/review/final-20261031',{recursive:true});
fs.cpSync('docs/qa/palette-1-20261031','build/review/palette-1-20261031',{recursive:true});
fs.cpSync('docs/qa/moroccan-red-20261101','build/review/moroccan-red-20261101',{recursive:true});
fs.cpSync('docs/qa/booking-actions-20261101','build/review/booking-actions-20261101',{recursive:true});
fs.cpSync('docs/qa/valentin-20261102/public','build/review/valentin-20261102',{recursive:true});

// Latest curated report and verification matrix. No raw traces or account files.
fs.mkdirSync('build/review/frontend-completion-20261103',{recursive:true});
for(const name of ['registry-68-current.json','verification-summary.json','followup-verification.json','toolchain-verification.json','style-pipeline-verification.json','driver-map-verification.json','road-cache-verification.json','rating-verification.json','entrypoints-verification.json','pdf-verification.json','command-recovery.md','recovery-browser.json','e2e-clean-summary.json'])
  fs.copyFileSync(path.join('docs/qa/frontend-completion-20261103',name),path.join('build/review/frontend-completion-20261103',name));
fs.copyFileSync('docs/qa/frontend-completion-20261103/frontend-report.html','build/review/frontend-report.html');
fs.copyFileSync('docs/qa/frontend-completion-20261103/frontend-report.html','build/review/frontend-completion-20261103/index.html');
fs.copyFileSync('docs/qa/frontend-completion-20261103/frontend-report.pdf','build/review/frontend-report.pdf');
fs.copyFileSync('docs/qa/frontend-completion-20261103/frontend-report.pdf','build/review/qa-report.pdf');

execFileSync(process.execPath,['tools/build-investor.cjs'],{cwd:root,env:{...env,INVESTOR_BUILD_MODE:'production',INVESTOR_OUTPUT_DIR:'build/investor'},stdio:'inherit'});

// Curated screenshots and report only; no account data or raw logs.
fs.cpSync('docs/qa/review-20261031','build/review/20261031',{recursive:true});
