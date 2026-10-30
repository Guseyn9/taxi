import React, {act} from 'react'
import {createRoot} from 'react-dom/client'
import SmoothRotatingMarker, {shortestAngleDelta,getPathKey} from './SmoothRotatingMarker'
const mockSetLatLng=jest.fn(),mockRender=jest.fn()
const mockElement=document.createElement('div')
mockElement.innerHTML='<span class="smooth-rotating-marker__wrap"><img class="smooth-rotating-marker__image"/></span>'
const mockMap={project:()=>({x:100.25,y:200.75}),getZoom:()=>16,on:jest.fn(),off:jest.fn()}
jest.mock('react-leaflet',()=>({useMap:()=>mockMap,Marker:require('react').forwardRef((props,ref)=>{mockRender();require('react').useImperativeHandle(ref,()=>({setLatLng:mockSetLatLng,getElement:()=>mockElement}));return null})}))
let root,frames,now,oldRaf,oldCancel,clock
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;root=createRoot(document.createElement('div'));frames=new Map();now=0;let id=0;oldRaf=global.requestAnimationFrame;oldCancel=global.cancelAnimationFrame;global.requestAnimationFrame=fn=>{frames.set(++id,fn);return id};global.cancelAnimationFrame=id=>frames.delete(id);clock=jest.spyOn(performance,'now').mockImplementation(()=>now);mockSetLatLng.mockClear();mockRender.mockClear()})
afterEach(async()=>{await act(async()=>root.unmount());clock.mockRestore();global.requestAnimationFrame=oldRaf;global.cancelAnimationFrame=oldCancel;delete global.IS_REACT_ACT_ENVIRONMENT})
async function render(position,path){await act(async()=>root.render(<SmoothRotatingMarker position={position} path={path} iconUrl="car.svg"/>))}
function step(ms){now+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now))}
test('north crossing uses the short turn even after multiple revolutions',()=>{expect(shortestAngleDelta(359,1)).toBe(2);expect(shortestAngleDelta(1,359)).toBe(-2);expect(shortestAngleDelta(1081,359)).toBe(-2)})
test('reroute with unchanged endpoints has a new identity',()=>{expect(getPathKey([[30,-9],[30.1,-9.1],[30.2,-9]])).not.toBe(getPathKey([[30,-9],[30.1,-9.2],[30.2,-9]]))})
test('frames move marker without React renders; retarget continues from displayed point and unmount cancels work',async()=>{
 await render([30,-9]);await render([30.001,-9]);const renders=mockRender.mock.calls.length
 step(50);step(50);const before=mockSetLatLng.mock.calls.slice(-1)[0][0][0]
 expect(before).toBeGreaterThan(30);expect(mockRender).toHaveBeenCalledTimes(renders)
 expect(mockElement.querySelector('span').style.transform).toBe('translate(0.25px, -0.25px)')
 await render([30.002,-9]);step(16);expect(mockSetLatLng.mock.calls.slice(-1)[0][0][0]).toBeGreaterThan(before)
 await act(async()=>root.unmount());expect(frames.size).toBe(0)
})
test('stationary submeter noise does not start animation',async()=>{await render([30,-9]);await render([30.000001,-9]);expect(frames.size).toBe(0)})
