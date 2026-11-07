'use strict'
// Real Playwright reporters and browser; synthetic credentials, no backend.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const {spawnSync} = require('node:child_process')
const root = path.resolve(__dirname, '..')
const output = process.env.PRIVATE_REPORT_TEST_DIR
if (!output || !path.isAbsolute(output)) throw Error('Set PRIVATE_REPORT_TEST_DIR to a disposable absolute output directory')
fs.mkdirSync(output, {recursive:true})
const testApi = require.resolve('@playwright/test')
const password = 'fixture-private"/Тест+901'
const login = 'fixture-only@example.invalid'
const token = 'fixture-runtime-token-0123456789'
const config = {
  testDir:output, testMatch:'privacy.spec.cjs', outputDir:path.join(output,'artifacts'),
  workers:1, retries:0,
  use:{trace:'off', screenshot:'only-on-failure', video:'off'},
  reporter:[
    [path.join(root,'e2e/reporters/stripSetupErrorContext.ts')],
    ['html',{open:'never',outputFolder:path.join(output,'html')}],
    ['json',{outputFile:path.join(output,'results.json')}],
  ],
  projects:[{name:'setup',testMatch:'privacy.spec.cjs',grep:'authentication',use:{screenshot:'off',video:'off',trace:'off'}},
    {name:'journey',testMatch:'privacy.spec.cjs',grep:'diagnostics'}],
}
fs.writeFileSync(path.join(output,'privacy.config.cjs'),'module.exports='+JSON.stringify(config)+'; for (const project of module.exports.projects) project.grep = new RegExp(project.grep);')
fs.writeFileSync(path.join(output,'privacy.spec.cjs'), `
const {test,expect}=require(${JSON.stringify(testApi)});
const fs=require('node:fs');
const secret=process.env.E2E_DRIVER_PASSWORD, login=process.env.E2E_DRIVER_LOGIN;
test('authentication succeeds',async({page},info)=>{
 await page.setContent('<input name="login"><input name="password" type="password">');
 await test.step('nested authentication',async()=>{await page.locator('[name=login]').fill(login);await page.locator('[name=password]').fill(secret)});
 await info.attach('auth body',{body:Buffer.from(secret),contentType:'text/plain'});
 expect(await page.locator('[name=password]').inputValue()).toBe(secret);
});
test('authentication fails after fill',async({page},info)=>{
 test.fail();await page.setContent('<input name="password" type="password">');await page.locator('input').fill(secret);
 const p=info.outputPath('auth-context.md');fs.writeFileSync(p,secret);await info.attach('error-context',{path:p,contentType:'text/markdown'});
 throw Error('Authentication refused '+secret);
});
test('diagnostics preserve order context',async({page},info)=>{
 test.fail();await page.setContent('<h1>Order 42 pending</h1>');
 process.stdout.write(secret.slice(0,8));process.stdout.write(secret.slice(8)+' order 42 pending\\n');
 process.stderr.write(encodeURIComponent(secret)+' token='+process.env.E2E_FIXTURE_TOKEN+'\\n');
 info.annotations.push({type:'diagnostic',description:secret});
 await info.attach('safe-image',{body:await page.screenshot(),contentType:'image/png'});
 await test.step('order 42 '+secret,async()=>{
  await info.attach('text-body',{body:Buffer.from('order 42 pending '+JSON.stringify(secret)),contentType:'text/plain'});
  const p=info.outputPath('diagnostic.txt');fs.writeFileSync(p,'order 42 pending '+encodeURIComponent(secret));await info.attach('text-path',{path:p,contentType:'text/plain'});
  const zip=info.outputPath('private-trace.zip');fs.writeFileSync(zip,secret);await info.attach('trace',{path:zip,contentType:'application/zip'});
  throw Error('order 42 pending '+secret);
 });
});
`)
const run=spawnSync(process.execPath,[path.join(path.dirname(require.resolve('playwright/package.json')),'cli.js'),'test','--config',path.join(output,'privacy.config.cjs')],{
 cwd:root,env:{...process.env,CI:'true',E2E_DRIVER_LOGIN:login,E2E_DRIVER_PASSWORD:password,E2E_FIXTURE_TOKEN:token,PLAYWRIGHT_HTML_OPEN:'never'},encoding:'utf8',timeout:120000,
})
fs.writeFileSync(path.join(output,'console.log'),(run.stdout||'')+(run.stderr||''))
assert.equal(run.status,0,'privacy browser controls must complete as expected')
const summary=JSON.parse(fs.readFileSync(path.join(output,'results.json'),'utf8'))
assert.equal(summary.stats.expected,3)
assert.equal(summary.stats.unexpected,0)
const results=summary.suites.flatMap(s=>s.specs.flatMap(s=>s.tests.flatMap(t=>t.results)))
assert.equal(results.length,3)
assert(results.some(r=>r.attachments.some(a=>a.name==='safe-image')),'ordinary scenario screenshot retained')
const scan=spawnSync('python3',['-c',`
import json,sys,pathlib,re,base64,zipfile,io,urllib.parse
data=json.load(sys.stdin); root=pathlib.Path(data['root']); needles=set()
for s in data['secrets']:
 needles.update([s,json.dumps(s,ensure_ascii=False)[1:-1],urllib.parse.quote(s,safe='~()*!.'),urllib.parse.quote_plus(s,safe=''),base64.b64encode(s.encode()).decode()])
matches=[]; entries=0;auth_steps=0
files=list((root/'html').rglob('*'))+[root/'results.json',root/'console.log']
for p in files:
 if not p.is_file():continue
 b=p.read_bytes()
 if any(n.encode() in b for n in needles):matches.append(str(p.relative_to(root)))
 if p.suffix=='.html':
  for m in re.finditer(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)',b):
   with zipfile.ZipFile(io.BytesIO(base64.b64decode(m[1]))) as z:
    for name in z.namelist():
     entries+=1; chunk=z.read(name)
     if any(n.encode() in chunk for n in needles):matches.append(str(p.relative_to(root))+':zip:'+name)
     if name.endswith('.json'):
      d=json.loads(chunk)
      for t in d.get('tests',[]):
       if t.get('projectName')=='setup':
        for r in t.get('results',[]):auth_steps+=len(r.get('steps',[]))
print(json.dumps({'secretMatches':matches,'decodedZipEntries':entries,'authRecordedSteps':auth_steps}))
`],{input:JSON.stringify({root:output,secrets:[password,login,token]}),encoding:'utf8'})
assert.equal(scan.status,0,'report archive scan runs')
const evidence=JSON.parse(scan.stdout)
assert.deepEqual(evidence.secretMatches,[])
assert(evidence.decodedZipEntries>0,'embedded HTML archive actually inspected')
assert.equal(evidence.authRecordedSteps,0)
assert(fs.readFileSync(path.join(output,'console.log'),'utf8').includes('order 42 pending'))
const {checkReportArtifacts}=require('./check-private-report.cjs')
const gate=checkReportArtifacts([path.join(output,'html'),path.join(output,'results.json'),path.join(output,'console.log')],[password,login,token])
assert.deepEqual(gate.secretMatches,[])
// A later or stale file cannot bypass the same gate used before CI upload.
const injected=path.join(output,'html','unsafe-fixture.txt')
fs.writeFileSync(injected,encodeURIComponent(password))
assert(checkReportArtifacts([path.join(output,'html')],[password]).secretMatches.length>0)
fs.unlinkSync(injected)
const result={fixtureTests:3,expectedFailures:2,unexpectedFailures:0,ordinaryScreenshotRetained:true,orderDiagnosticsRetained:true,uploadGatePassed:true,rawOutputExcluded:true,...evidence}
fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result))
