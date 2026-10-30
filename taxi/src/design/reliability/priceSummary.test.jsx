import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
jest.mock('react-redux',()=>({connect:()=>component=>component}))
jest.mock('../../state/config',()=>({configSelectors:{}}))
jest.mock('../../state/clientOrder',()=>({clientOrderSelectors:{},clientOrderActionCreators:{}}))
jest.mock('../../siteConstants',()=>({__esModule:true,default:{CAR_CLASSES:{},ENABLE_CUSTOMER_PRICE:true,COURIER_CALL_RATE:10},CURRENCY:{NAME:'GHS',SIGN:'GH₵'}}))
jest.mock('../../tools/utils',()=>({getPayment:()=>({value:12.5})}))
jest.mock('../../localization',()=>({t:v=>v||'',TRANSLATION:{CLIENT_ESTIMATED_PRICE:'Fare',CUSTOMER_PRICE:'Offer'}}))
import PriceInput from '../../components/PriceInput'
test('a locked quote shows its actual value and order currency without unrelated zero-valued draft segments',async()=>{
 const host=document.createElement('div'),root=createRoot(host),setValue=jest.fn();global.IS_REACT_ACT_ENVIRONMENT=true
 try{await act(async()=>root.render(<PriceInput readOnlySummary forceCustomerPrice estimatedPriceOverride={22.5} currencyOverride="MAD" customerPrice={150} pickupPrice={0} setPickupPrice={setValue} setCustomerPrice={setValue}/>));expect(host.querySelectorAll('[data-testid="passenger-order-price-segment"]')).toHaveLength(1);expect(host.textContent).toContain('22.5');expect(host.textContent).toContain('MAD');expect(host.textContent).not.toContain('150');expect(setValue).not.toHaveBeenCalled();await act(async()=>root.render(<PriceInput forceCustomerPrice customerOfferEditable={false} pickupPrice={0} customerPrice={150} setPickupPrice={setValue} setCustomerPrice={setValue}/>));expect([...host.querySelectorAll('[data-testid="passenger-order-price-segment"]')].map(node=>node.dataset.priceKey)).toEqual(['estimated','pickup'])}
 finally{await act(async()=>root.unmount());delete global.IS_REACT_ACT_ENVIRONMENT}
})
