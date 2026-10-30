jest.mock('react-redux',()=>({connect:()=>component=>component}))
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import moment from 'moment'
import {PickTimeModal} from '../PickTimeModal'
jest.mock('../../../state/clientOrder',()=>({clientOrderSelectors:{},clientOrderActionCreators:{}}))
jest.mock('../../../state/modals',()=>({modalsSelectors:{},modalsActionCreators:{}}))
jest.mock('../../../localization',()=>({t:key=>key,TRANSLATION:{START_TIME:'Pickup time',TODAY:'Today',NOW:'Now',TOMORROW:'Tomorrow',SAVE:'Save',CANCEL:'Cancel'}}))
jest.mock('../../../tools/utils',()=>({dateFormatTimeShort:'HH:mm'}))
jest.mock('../Overlay',()=>({children})=><div>{children}</div>)
test('editing tomorrow keeps tomorrow instead of adding another day, and cancel does not save',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const now=jest.spyOn(Date,'now').mockReturnValue(new Date('2026-10-29T12:00:00').valueOf())
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 const setTime=jest.fn(),close=jest.fn()
 await act(async()=>root.render(<PickTimeModal isOpen time={moment('2026-10-30T09:30:00')} setTime={setTime} setPickTimeModal={close}/>))
 const button=name=>[...host.querySelectorAll('button')].find(e=>e.textContent.startsWith(name))
 await act(async()=>button('Tomorrow').click())
 expect(host.querySelector('input[type=time]').value).toBe('09:30')
 await act(async()=>button('Cancel').click());expect(setTime).not.toHaveBeenCalled()
 await act(async()=>button('Tomorrow').click());
 host.querySelector('input[type=time]').value='10:45'
 await act(async()=>button('Save').click())
 expect(setTime).toHaveBeenCalledTimes(1);expect(setTime.mock.calls[0][0].format('YYYY-MM-DD HH:mm')).toBe('2026-10-30 10:45')
 await act(async()=>root.unmount());host.remove();now.mockRestore();delete global.IS_REACT_ACT_ENVIRONMENT
})
