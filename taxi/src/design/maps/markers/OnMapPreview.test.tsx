import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import OnMapPreview from './OnMapPreview'
let mockClass='50'
const mockMap={getContainer:()=>document.body,getSize:()=>({x:1200,y:800}),getCenter:()=>({lat:33.58,lng:-7.62}),getZoom:()=>16,fitBounds:jest.fn(),setView:jest.fn(),invalidateSize:jest.fn(),on:jest.fn(),off:jest.fn()}
jest.mock('react-redux',()=>({useSelector:(selector:any)=>selector({clientOrder:{carClass:mockClass}})}))
jest.mock('../../../state/clientOrder',()=>({clientOrderSelectors:{carClass:(state:any)=>state.clientOrder.carClass}}))
jest.mock('../../../siteConstants',()=>({__esModule:true,default:{PALETTE:{primary:{main:'#1E58EB'}},CAR_CLASSES:{50:{id:'50',name:'PETTI'},51:{id:'51',name:'Grand'}}}}))
jest.mock('../../../localization',()=>({TRANSLATION:{CAR_CLASSES:{}},t:(value:any)=>value}))
jest.mock('react-leaflet',()=>({useMap:()=>mockMap,Marker:()=>null,Polyline:()=>null,Tooltip:()=>null}))
jest.mock('../../../components/SmoothRotatingMarker',()=>({__esModule:true,default:({iconUrl}:any)=>require('react').createElement('img',{'data-testid':'vehicle',src:iconUrl})}))
let host:HTMLDivElement,root:Root,previousActEnvironment:unknown
beforeEach(()=>{previousActEnvironment=(globalThis as any).IS_REACT_ACT_ENVIRONMENT;(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();mockClass='50';host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();(globalThis as any).IS_REACT_ACT_ENVIRONMENT=previousActEnvironment})
it('changes the moving artwork from Petit to Grand with the booking class without resetting route progress',()=>{
 act(()=>root.render(<OnMapPreview/>))
 act(()=>(host.querySelector('button') as HTMLButtonElement).click())
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/design-v2/vehicles/petit-agadir-top-v4.png')
 act(()=>jest.advanceTimersByTime(4500))
 act(()=>(host.querySelector('[aria-label="Пауза движения"]') as HTMLButtonElement).click())
 const progress=(host.querySelector('input') as HTMLInputElement).value
 expect(Number(progress)).toBeGreaterThan(0)
 mockClass='51'
 act(()=>root.render(<OnMapPreview/>))
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/design-v2/vehicles/grand-agadir-top-v4.png')
 expect((host.querySelector('input') as HTMLInputElement).value).toBe(progress)
 expect(host.querySelector('[aria-label="Продолжить движение"]')).not.toBeNull()
 mockClass='50'
 act(()=>root.render(<OnMapPreview/>))
 expect(host.querySelector('img')?.getAttribute('src')).toBe('/design-v2/vehicles/petit-agadir-top-v4.png')
})
