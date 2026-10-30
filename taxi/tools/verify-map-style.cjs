const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const {validateStyleMin,featureFilter}=require('@maplibre/maplibre-gl-style-spec');
function readModule(file){const text=fs.readFileSync(file,'utf8');const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;const exports={};vm.runInNewContext(js,{exports});return exports;}
const local=readModule('src/design/maps/rsale-style.ts');
const reference=readModule('/Users/max/Projects/RSALEFINAL/frontend/src/lib/maps/style.ts');
const styleErrors=Object.fromEntries(['en','fr','ru','ar'].map(locale=>[locale,validateStyleMin(local.createMapStyle(locale)).map(x=>x.message)]));
const layers=local.createMapStyle('en').layers;
const originalLayers=reference.createMapStyle('https://rsale.net','en').layers;
const adjustedIds=['road-casing','roads','street-labels'];
const normalize=items=>items.map(layer=>{const copy={...layer};if(adjustedIds.includes(copy.id)) delete copy.filter;return copy;});
const unchangedExceptFilters=JSON.stringify(normalize(layers))===JSON.stringify(normalize(originalLayers));
const ferryChecks=Object.fromEntries(adjustedIds.map(id=>{const layer=layers.find(x=>x.id===id);const matches=featureFilter(layer.filter,id).filter;return [id,{ferryHidden:!matches({zoom:14},{type:2,properties:{class:'ferry'},geometry:[]}),primaryVisible:matches({zoom:14},{type:2,properties:{class:'primary'},geometry:[]})}];}));
const result={styleErrors,rsaleLayersUnchangedExceptFerryFilters:unchangedExceptFilters,ferryChecks,ok:unchangedExceptFilters&&Object.values(ferryChecks).every(x=>x.ferryHidden&&x.primaryVisible)&&Object.values(styleErrors).every(x=>!x.length)};
fs.mkdirSync('design-review/maps',{recursive:true});fs.writeFileSync('design-review/maps/style-verification.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));process.exit(result.ok?0:1);
