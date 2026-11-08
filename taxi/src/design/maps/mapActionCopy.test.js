import {mapActionCopy} from './mapActionCopy'
import {rideCopy} from '../copy'
let mockServiceLabels={}
jest.mock('../../localization',()=>({t:(key,options)=>mockServiceLabels[key]||options?.fallback||key}))
beforeEach(()=>{mockServiceLabels={}})
test.each(['ru','en','fr','ar'])('map actions and address fields share the original names in %s',iso=>{
 const fields=rideCopy(iso),actions=mapActionCopy(iso)
 expect(actions.pickup).toBe(fields.pickup);expect(actions.destination).toBe(fields.destination)
})
test('service from/to translations override both surfaces without a rebuild',()=>{
 mockServiceLabels={from:'Service From',to:'Service To',map_action_ui_pickup:'Old alternate copy'}
 expect(mapActionCopy('ru')).toMatchObject({pickup:'Service From',destination:'Service To'})
 expect(rideCopy('ru')).toMatchObject({pickup:'Service From',destination:'Service To'})
})
