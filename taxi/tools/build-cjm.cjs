// Standalone fixture entry: local store, no App bootstrap or remote configuration initializer.
const path=require('path'),webpack=require('webpack'),HtmlWebpackPlugin=require('html-webpack-plugin');
const mode=process.env.QA_BUILD_MODE||'development';process.env.NODE_ENV=mode;process.env.BABEL_ENV=mode;
const config=require('../config/webpack.config')(mode);
config.entry=path.resolve(process.env.QA_ENTRY||'src/qa/cjm-entry.tsx');
config.output.path=path.resolve(process.env.QA_OUTPUT_DIR||'.preview/qa');config.output.publicPath=process.env.QA_ROUTE||'/qa/';
config.plugins=config.plugins.filter(plugin=>!['HtmlWebpackPlugin','WebpackManifestPlugin'].includes(plugin.constructor.name));
config.plugins.push(new webpack.NormalModuleReplacementPlugin(/config(?:\.ts)?$/,resource=>{
  if(path.resolve(resource.context,resource.request).replace(/\.ts$/,'')===path.resolve('src/config'))resource.request=path.resolve('src/qa/configStub.ts');
}));
config.plugins.push(new HtmlWebpackPlugin({inject:true,template:path.resolve('src/design/investor/template.html')}));
config.plugins.push(new (class {apply(compiler){compiler.hooks.emit.tap('QA CSP',compilation=>{const asset=compilation.assets['index.html'];const html=asset.source().toString().replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="connect-src '+(process.env.QA_CONNECT_POLICY==='map'?"\'self\' https://tiles.openfreemap.org":process.env.QA_CONNECT_POLICY==='self'?"\'self\'":"\'none\'")+'; form-action \'none\'">');compilation.assets['index.html']={source:()=>html,size:()=>Buffer.byteLength(html)}})}})());
webpack(config,(error,stats)=>{if(error){console.error(error);process.exit(1)}console.log(stats.toString({all:false,errors:true,timings:true}));process.exit(stats.hasErrors()?1:0)});
