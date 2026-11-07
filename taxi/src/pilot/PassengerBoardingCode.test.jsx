import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import PassengerBoardingCode from './PassengerBoardingCode'
import {EBookingDriverState as S} from '../types/types'
jest.mock('../localization',()=>({t:()=> 'Код посадки',TRANSLATION:{CLIENT_BOARDING_CODE:'code'}}))
test('shows the server PIN, never the vehicle identifier, and hides it after boarding',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 const driver={c_id:'1682',c_state:S.Arrived}
 await act(async()=>root.render(<PassengerBoardingCode order={{b_driver_code:'4'}} driver={driver} className="code"/>))
 expect(host.querySelector('[data-testid="passenger-boarding-code"]').textContent).toBe('4')
 expect(host.textContent).not.toContain('1682');expect(host.querySelector('input')).toBe(null)
 await act(async()=>root.render(<PassengerBoardingCode order={{}} driver={driver} className="code"/>))
 expect(host.textContent).toBe('')
 await act(async()=>root.render(<PassengerBoardingCode order={{b_driver_code:'4'}} driver={{...driver,c_state:S.Started}} className="code"/>))
 expect(host.textContent).toBe('')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
