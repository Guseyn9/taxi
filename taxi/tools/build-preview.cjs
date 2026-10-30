require('./sync-drive-design.cjs')();
require('./prepare-road-graph.cjs').prepare();
const fs=require('node:fs'), path=require('node:path');
const mapDist=path.dirname(require.resolve('maplibre-gl/package.json'))+'/dist';
fs.mkdirSync('public/maps',{recursive:true});
fs.copyFileSync(path.join(mapDist,'../LICENSE.txt'),'public/maps/LICENSE-maplibre.txt');
for(const file of ['maplibre-gl-worker.mjs','maplibre-gl-shared.mjs']) fs.copyFileSync(path.join(mapDist,file),path.join('public/maps',file));
require('node:child_process').execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/design/shadcn.source.css','-o','src/design/shadcn.generated.css','--minify'],{stdio:'inherit'});
process.env.NODE_ENV='development';
process.env.BABEL_ENV='development';
const webpack=require('webpack');
const config=require('../config/webpack.config')('development');
config.output.path=require('path').resolve('.preview');
webpack(config,(error,stats)=>{
  if(error){console.error(error);process.exit(1);}
  console.log(stats.toString({all:false,errors:true,timings:true}));
  process.exit(stats.hasErrors()?1:0);
});
