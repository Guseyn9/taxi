import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {BoardingCodeDialog} from './BoardingGate'
jest.mock('../components/modals/Overlay',()=>({__esModule:true,default:({children})=><div>{children}</div>}))
jest.mock('../localization',()=>({t:value=>value,TRANSLATION:{CLIENT_BOARDING_CODE:'Code',WRONG_BOARDING_CODE:'Wrong code',ERROR:'Error',LOADING:'Loading',DRIVER_VOTING_CONFIRM_CODE:'Confirm'}}))
test('000 never sends a boarding command for expected 111; valid code sends once and waits for success',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 let finish;const confirm=jest.fn(()=>new Promise(resolve=>{finish=resolve}));const close=jest.fn()
 await act(async()=>root.render(<BoardingCodeDialog expected="111" onConfirm={confirm} onClose={close}/>))
 const input=host.querySelector('input'),form=host.querySelector('form')
 const enter=async value=>act(async()=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}))})
 const submit=()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))
 await enter('000');await act(async()=>submit());expect(confirm).not.toHaveBeenCalled();expect(host.textContent).toContain('Wrong code')
 await enter('111');await act(async()=>{submit();submit()});expect(confirm).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledWith('111');expect(close).not.toHaveBeenCalled()
 await act(async()=>finish());expect(close).toHaveBeenCalledTimes(1)
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
test('without an expected code the server checks the PIN and rejection leaves the dialog open',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);const confirm=jest.fn().mockRejectedValue(new Error('wrong driver code'))
 await act(async()=>root.render(<BoardingCodeDialog expected={undefined} onConfirm={confirm} onClose={()=>{}}/>))
 const input=host.querySelector('input');await act(async()=>{input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 expect(confirm).toHaveBeenCalledWith('111');expect(host.textContent).toContain('Wrong code')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
test.each([
 ['a*01','D*Ol','a*01'],
 ['*','*','*'],
 ['a'.repeat(32),'a'.repeat(32)+'b',null],
])('boarding dialog follows the server alphabet without truncating: %s',async(expected,entered,accepted)=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 const confirm=jest.fn().mockResolvedValue(undefined),close=jest.fn()
 try{
  await act(async()=>root.render(<BoardingCodeDialog expected={expected} onConfirm={confirm} onClose={close}/>))
  const input=host.querySelector('input')
  expect(input.getAttribute('inputmode')).toBe('text')
  expect(input.getAttribute('autocapitalize')).toBe('none')
  await act(async()=>{input.value=entered;input.dispatchEvent(new Event('input',{bubbles:true}))})
  await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
  if(accepted===null){expect(confirm).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(host.textContent).toContain('Wrong code')}
  else {expect(confirm).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledWith(accepted);expect(close).toHaveBeenCalledTimes(1)}
 }finally{await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT}
})
