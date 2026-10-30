// Standalone screenshot scenario. Does not import the app/bootstrap/store or mutate orders.
const path=require('path'),webpack=require('webpack'),HtmlWebpackPlugin=require('html-webpack-plugin');
const mode=process.env.INVESTOR_BUILD_MODE||'development';process.env.NODE_ENV=mode;process.env.BABEL_ENV=mode;
const config=require('../config/webpack.config')(mode);
config.entry=path.resolve('src/design/investor/entry.tsx');
config.output.path=path.resolve(process.env.INVESTOR_OUTPUT_DIR||'.preview/investor');config.output.publicPath='/investor/';
config.plugins=config.plugins.filter(plugin=>!['HtmlWebpackPlugin','WebpackManifestPlugin'].includes(plugin.constructor.name));
config.plugins.push(new HtmlWebpackPlugin({inject:true,template:path.resolve('src/design/investor/template.html')}));
webpack(config,(error,stats)=>{if(error){console.error(error);process.exit(1)}console.log(stats.toString({all:false,errors:true,timings:true}));process.exit(stats.hasErrors()?1:0)});
