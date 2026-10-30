import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
jest.mock('../components/modals/Overlay',()=>({__esModule:true,default:({children})=><div>{children}</div>}))
jest.mock('../localization',()=>({t:value=>value,TRANSLATION:{CLIENT_BOARDING_CODE:'Code',WRONG_BOARDING_CODE:'Wrong code',ERROR:'Error',LOADING:'Loading',DRIVER_VOTING_CONFIRM_CODE:'Confirm'}}))
import {BoardingCodeDialog} from './BoardingGate'
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
test('without an expected code the gate does not silently trust any syntactically valid value',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);const confirm=jest.fn()
 await act(async()=>root.render(<BoardingCodeDialog expected={undefined} onConfirm={confirm} onClose={()=>{}}/>))
 const input=host.querySelector('input');await act(async()=>{input.value='111';input.dispatchEvent(new Event('input',{bubbles:true}))})
 await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})))
 expect(confirm).not.toHaveBeenCalled();expect(host.textContent).toContain('Wrong code')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
