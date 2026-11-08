import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import DriverCommandRecoveryNotice from './index'
import {DriverCommandRecovery} from '../../platform/adapters/DriverCommandRecovery'
jest.mock('../../design/serviceText',()=>({serviceText:value=>value}))
const scope={userId:'1420',service:'local',sessionId:'one'}
let host,root
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;sessionStorage.clear();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
const render=element=>act(()=>root.render(element))
function setup(){
 const pending={actionType:'driver.order.start',orderId:'42',instanceId:91,acceptedAt:1000}
 sessionStorage.setItem('taxi.driver.pending-commands.v1',JSON.stringify({version:1,scope,commands:[pending]}))
 const wait=jest.fn().mockResolvedValue({status:'TIMEOUT',instanceId:91})
 const controller=new DriverCommandRecovery({supportsInstanceRecovery:true,wait,cancelAll:()=>{}},{scope:()=>scope,storage:sessionStorage})
 return {controller,wait}
}
test('unknown result offers a status check, keeps the order identified, and never offers an action replay',async()=>{
 const {controller,wait}=setup();render(<DriverCommandRecoveryNotice controller={controller} userId="1420" iso="ru"/>)
 await act(async()=>controller.activate())
 expect(host.textContent).toContain('Заказ №42')
 const retry=host.querySelector('button');expect(retry.textContent).toBe('Проверить результат')
 let finish;wait.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
 act(()=>retry.click());expect(host.querySelector('button')).toBeNull()
 await act(async()=>finish({status:'COMPLETED',instanceId:91}))
 expect(host.textContent).toContain('Действие выполнено')
 const close=host.querySelector('button');expect(close.textContent).toBe('Понятно');act(()=>close.click());expect(host.querySelector('[data-testid="command-recovery"]')).toBeNull()
})
test('another account does not see the previous driver’s pending action',async()=>{
 const {controller}=setup();await act(async()=>controller.activate())
 render(<DriverCommandRecoveryNotice controller={controller} userId="other-driver" iso="ru"/>)
 expect(host.querySelector('[data-testid="command-recovery"]')).toBeNull()
})
test('a confirmed execution failure stays visible as a failure, not a successful trip',async()=>{
 const {controller,wait}=setup();wait.mockResolvedValue({status:'FAILED',instanceId:91,failureKind:'EXECUTION'})
 render(<DriverCommandRecoveryNotice controller={controller} userId="1420" iso="ru"/>)
 await act(async()=>controller.activate())
 expect(host.textContent).toContain('Действие не выполнено')
 expect(host.textContent).not.toContain('Действие выполнено')
})
