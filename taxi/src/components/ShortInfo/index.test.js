jest.mock('react-redux',()=>({connect:()=>component=>component}))
import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import {ShortInfo} from './index'
jest.mock('../../state/clientOrder',()=>({clientOrderSelectors:{}}))
jest.mock('../../tools/utils',()=>({getPhoneNumberError:()=>null,formatCurrency:value=>`${value} GHS`,getPayment:()=>({value:12.5})}))
jest.mock('../../localization',()=>({t:value=>value,TRANSLATION:{NOW:'Now',CAR_CLASSES:{50:'PETIT'}}}))
jest.mock('../Icon',()=>()=>null)
test('an active order summary uses confirmed order fare and seats, never the old offer draft',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host)
 await act(async()=>root.render(<ShortInfo time="now" seats={4} carClass={50} customerPrice={150} phone={123} orderSnapshot={{b_id:'18431',b_currency:'GHS',b_start_datetime:'2026-10-29T12:00:00',b_passengers_count:1,b_car_class:50}}/>))
 expect(host.textContent).toMatch(/GHS\s*12[.,]50|12[.,]50\s*GHS/);expect(host.textContent).not.toContain('150 GHS');expect(host.textContent).toContain('PETIT')
 expect([...host.querySelectorAll('.short-info__text')].map(el=>el.textContent)).toContain('1')
 await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT
})
