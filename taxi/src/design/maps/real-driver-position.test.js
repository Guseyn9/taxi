const fs=require('fs'),path=require('path'),parser=require('@babel/parser'),babel=require('@babel/core')
// Execute the actual three map helpers without mounting Leaflet/WebGL in jsdom.
const source=fs.readFileSync(path.resolve(__dirname,'../../components/Map/index.tsx'),'utf8')
const ast=parser.parse(source,{sourceType:'module',plugins:['typescript','jsx']})
const names=['makeVisibleCandidateDriver','makeSafeSelectedEmulatedDriver','getChoiceVisualDriverPosition']
ast.program.body=ast.program.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name))
const code=babel.transformFromAstSync(ast,source,{filename:'helpers.ts',configFile:false,babelrc:false,presets:['@babel/preset-typescript']}).code
const helpers=new Function('isAnyBrowserEmulatorOrder','isEmulatedDriver','isChoiceOrder',`${code};return {${names.join(',')}}`)(order=>!!order.simulated,driver=>!!driver.simulated,()=>true)
test.each([[false,false],[true,false],[false,true]])('real orders/drivers retain their server coordinates and never advance on a clock: simulated order=%s driver=%s',(simulatedOrder,simulatedDriver)=>{
 const order={b_id:10,simulated:simulatedOrder,b_start_latitude:30.42,b_start_longitude:-9.59}
 const driver={u_id:1420,c_id:111,simulated:simulatedDriver,c_state:3,c_latitude:5.55,c_longitude:-.19}
 expect(helpers.makeVisibleCandidateDriver(driver,order,null)).toBe(driver)
 expect(helpers.makeSafeSelectedEmulatedDriver(driver,order,'1420')).toBe(driver)
 expect(helpers.getChoiceVisualDriverPosition(driver,{points:[[5.55,-.19],[30.42,-9.59]]},order,'1420',Date.now())).toBeNull()
})
