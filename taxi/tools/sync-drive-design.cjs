const fs=require('node:fs'),path=require('node:path');
module.exports=function(){const root=path.resolve(__dirname,'..');fs.copyFileSync(path.join(root,'src/design/drive-v2/tokens.css'),path.join(root,'public/design-v2/tokens.css'));};
if(require.main===module)module.exports();
