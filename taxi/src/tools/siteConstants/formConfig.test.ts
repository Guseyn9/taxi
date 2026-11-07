import { PassengerOrderConfig } from './formConfig'
it('merges a partial visibility config without removing the remaining defaults or values',()=>{
 const config=new PassengerOrderConfig(),before=JSON.parse(JSON.stringify(config))
 config.apply(JSON.stringify({visibility:{cost:false}}))
 expect(config.visibility).toEqual({...before.visibility,cost:false});expect(config.values).toEqual(before.values)
 config.apply(JSON.stringify({values:{weight:[{id:'25'}]}}))
 expect(config.visibility).toEqual({...before.visibility,cost:false});expect(config.values.weight).toEqual([{id:'25'}])
})
it.each(['null','[]','42','{"visibility":{"cost":null,"fromWay":"false"},"values":{"weight":[null]}}','{'])('ignores malformed or incomplete config values without losing defaults: %s',(text:string)=>{
 const config=new PassengerOrderConfig(),before=JSON.parse(JSON.stringify(config));config.apply(text);expect(JSON.parse(JSON.stringify(config))).toEqual(before)
})
