const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function prepare(){const root=path.resolve(__dirname,'..');const input=fs.readFileSync(path.join(root,'public/mock/agadir.json'));const manifest={schema:1,version:crypto.createHash('sha256').update(input).digest('hex')};fs.writeFileSync(path.join(root,'public/mock/road-graph-version.json'),JSON.stringify(manifest));return manifest;}
if(require.main===module)console.log(prepare());module.exports={prepare};
