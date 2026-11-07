'use strict'
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..')
const base=process.env.STYLE_CHECK_DIR?path.resolve(process.env.STYLE_CHECK_DIR):os.tmpdir()
fs.mkdirSync(base,{recursive:true})
// Always create a new child: webpack output cleaning cannot remove user files.
const work=fs.mkdtempSync(path.join(base,'taxi-style-check-'))
function run(file,env){const result=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,env:{...process.env,...env},stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status||1)}
for(const mode of ['development','production']){
 const bundle=path.join(work,mode)
 run('tools/build-cjm.cjs',{QA_BUILD_MODE:mode,QA_ENTRY:'src/qa/style-pipeline-entry.tsx',QA_OUTPUT_DIR:bundle,QA_ROUTE:'/',QA_CONNECT_POLICY:'none'})
 run('tools/test-style-pipeline-browser.cjs',{STYLE_QA_ROOT:bundle,STYLE_QA_OUTPUT:path.join(work,mode+'.json')})
}
console.log('Style pipeline passed: development + production, both icon palettes, public/relative assets and CSS/Sass modules.')
