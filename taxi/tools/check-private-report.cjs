'use strict'
// Scan every exported byte, including the compressed ZIP inside Playwright HTML.
// Raw outputDir and .auth remain private and are never upload targets.
const fs = require('node:fs'), path = require('node:path'), {spawnSync} = require('node:child_process')
const {collectSecrets} = require('../e2e/reporters/reportPrivacy.cjs')
const root = path.resolve(__dirname, '..')
function checkReportArtifacts(paths, secrets) {
  const run = spawnSync('python3', ['-c', `
import json,sys,pathlib,re,base64,zipfile,io,urllib.parse
data=json.load(sys.stdin); needles=set(); matches=[]; entries=0; files=0
for s in data['secrets']:
 for v in [s,json.dumps(s,ensure_ascii=False)[1:-1],urllib.parse.quote(s,safe="~()*!.'"),urllib.parse.quote_plus(s,safe=''),base64.b64encode(s.encode()).decode()]:
  needles.add(v.encode());needles.add(re.sub(r'%[0-9A-F]{2}',lambda m:m[0].lower(),v).encode())
def inspect(label,b):
 global entries
 if any(n in b for n in needles): matches.append(label)
 for m in re.finditer(rb'data:application/zip;base64,([A-Za-z0-9+/=]+)',b):
  with zipfile.ZipFile(io.BytesIO(base64.b64decode(m[1]))) as z:
   for name in z.namelist():entries+=1;inspect(label+':zip:'+name,z.read(name))
for raw in data['paths']:
 root=pathlib.Path(raw)
 if not root.exists():raise RuntimeError('Required report output is missing')
 for p in ([root] if root.is_file() else root.rglob('*')):
  if p.is_file():files+=1;inspect(p.name,p.read_bytes())
print(json.dumps({'secretMatches':matches,'decodedZipEntries':entries,'files':files}))
`], {input:JSON.stringify({paths, secrets}), encoding:'utf8', timeout:30000, maxBuffer:1024*1024})
  if (run.status !== 0) throw Error('Report privacy scan could not complete')
  const result = JSON.parse(run.stdout)
  if (!result.files || !result.decodedZipEntries) throw Error('Report privacy scan did not inspect HTML archive')
  return result
}
if (require.main === module) {
  try {
    const result = checkReportArtifacts([path.join(root,'playwright-report'),path.join(root,'e2e-results/results.json')],collectSecrets(root))
    console.log(JSON.stringify(result))
    if (result.secretMatches.length) process.exitCode=1
  } catch { console.error('Report privacy check failed; artifacts must not be uploaded.');process.exitCode=1 }
}
module.exports={checkReportArtifacts}
