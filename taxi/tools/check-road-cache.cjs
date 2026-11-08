'use strict'
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'..'),base=process.env.ROAD_CACHE_CHECK_DIR?path.resolve(process.env.ROAD_CACHE_CHECK_DIR):os.tmpdir()
fs.mkdirSync(base,{recursive:true})
const work=fs.mkdtempSync(path.join(base,'taxi-road-cache-'))
for(const [file,extra] of [
  ['tools/build-cjm.cjs',{QA_BUILD_MODE:'development',QA_ENTRY:'src/qa/road-cache-entry.ts',QA_OUTPUT_DIR:path.join(work,'bundle'),QA_ROUTE:'/',QA_CONNECT_POLICY:'self'}],
  ['tools/test-road-cache-browser.cjs',{ROAD_CACHE_BUNDLE:path.join(work,'bundle'),ROAD_CACHE_OUTPUT:path.join(work,'browser.json')}],
]) {
  const result=spawnSync(process.execPath,[path.join(root,file)],{cwd:root,env:{...process.env,...extra},stdio:'inherit'})
  if(result.error)throw result.error
  if(result.status!==0)process.exit(result.status||1)
}
console.log('Road cache: actual browser HTTP, coalescing, negative-cache recovery, validation and bounded timeouts passed.')
