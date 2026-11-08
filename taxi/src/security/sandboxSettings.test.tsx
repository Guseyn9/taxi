import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { isSafeSandboxBlock, parseSafeSandboxSettings, SANDBOX_MAX_BYTES } from './sandboxSettings'
import Block from '../components/Block'
jest.mock('../components/Button', () => () => null)
jest.mock('../components/Card/Card', () => () => null)
jest.mock('../components/BigTruckServices', () => () => null)
jest.mock('../tools/utils', () => ({mapBlockObject:(value:any)=>value}))

it.each([
 {type:'Checkbox',component:'iframe',srcDoc:'<script>window.parent.SENTINEL=1</script>'},
 {type:'Checkbox',slotProps:{root:{component:'iframe',srcDoc:'x'}}},
 {type:'Button',wrapperProps:{dangerouslySetInnerHTML:{__html:'<script>x</script>'}}},
 {type:'Button',asChild:true,children:{type:'iframe'}},
 {type:'Checkbox',inputProps:{onChange:'x'}},
])('rejects component/DOM-prop aliases before any component renders: %p', (block: any) => {
  expect(parseSafeSandboxSettings(JSON.stringify({blocks:[block]}))).toBeNull()
  expect(isSafeSandboxBlock(block)).toBe(false)
  const markup = renderToStaticMarkup(<Block form={{} as any} values={{}} {...block}/>)
  expect(markup).not.toMatch(/iframe|srcdoc|<script/i)
})
it('preserves supported text and checkbox previews while bounding all input representations', () => {
  expect(parseSafeSandboxSettings(JSON.stringify({blocks:[{html:'<b>Hello</b>'},{type:'Checkbox',checked:true}]}))).not.toBeNull()
  expect(isSafeSandboxBlock({type:undefined,fieldName:undefined,fieldValue:undefined,html:'Hello'})).toBe(true)
  expect(parseSafeSandboxSettings(' '.repeat(SANDBOX_MAX_BYTES+1))).toBeNull()
  expect(parseSafeSandboxSettings(JSON.stringify({blocks:Array.from({length:1001},()=>({html:'x'}))}))).toBeNull()
  expect(parseSafeSandboxSettings('{"blocks":[{"__proto__":{}}]}')).toBeNull()
})
