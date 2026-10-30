import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
jest.mock('react-redux',()=>({connect:()=> (Component:any)=>Component}))
jest.mock('../../state/user',()=>({userSelectors:{user:()=>null}}))
jest.mock('../../state/config',()=>({configSelectors:{language:()=>({iso:'ru'})}}))
jest.mock('../../state/modals',()=>({modalsActionCreators:{setLoginModal:()=>{}}}))
jest.mock('../../components/Layout',()=>({__esModule:true,default:({children}:any)=><div>{children}</div>}))
jest.mock('./gateway',()=>({readZoneCatalog:jest.fn(),saveZone:jest.fn()}))
jest.mock('./ZoneEditor',()=>({__esModule:true,default:({onSave,blocked,busy}:any)=><button type="button" disabled={blocked||busy} onClick={()=>onSave({id:'79',var:'agadir',json:{lat:30,lng:-9,radius:200}},'circle')}>test save</button>}))
import {ZoneAdminScreen} from './index'
import {readZoneCatalog,saveZone} from './gateway'
let host:HTMLDivElement,root:Root
const admin={u_id:'admin-test',u_role:3} as any
const read=readZoneCatalog as any,save=saveZone as any
beforeEach(()=>{jest.clearAllMocks();(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);read.mockResolvedValue([{id:'79',var:'agadir',ru:'Агадир'}]);save.mockResolvedValue(undefined)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
const render=(user:any)=>root.render(<ZoneAdminScreen user={user} iso="ru" login={jest.fn() as any}/> )
it('never reads or writes the catalog for a guest, passenger or driver',async()=>{
 for(const user of [null,{u_id:'client',u_role:1},{u_id:'driver',u_role:2}]){await act(async()=>render(user));expect(host.textContent).toContain('Доступно только администратору')}
 expect(read).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled()
})
it('an uncertain write is not replayed; catalog refresh is required first',async()=>{
 save.mockRejectedValue(new Error('timeout'))
 await act(async()=>render(admin))
 const select=Array.from(host.querySelectorAll('nav button'))[0] as HTMLButtonElement
 await act(async()=>select.click())
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='test save')!.click())
 expect(save).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Результат сохранения не подтверждён')
 const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='test save')!
 expect(button.disabled).toBe(true);await act(async()=>button.click());expect(save).toHaveBeenCalledTimes(1)
 await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Обновить список')!.click())
 expect(read).toHaveBeenCalledTimes(2);expect(host.textContent).not.toContain('Результат сохранения не подтверждён')
})
it('a late catalog response cannot populate another account screen',async()=>{
 let complete:any
 read.mockReturnValue(new Promise(resolve=>{complete=resolve}))
 await act(async()=>render(admin));await act(async()=>render({u_id:'client',u_role:1}))
 await act(async()=>complete([{id:'secret-zone',var:'stale',ru:'STALE ADMIN DATA'}]))
 expect(host.textContent).not.toContain('STALE ADMIN DATA');expect(host.textContent).toContain('Доступно только администратору')
})
