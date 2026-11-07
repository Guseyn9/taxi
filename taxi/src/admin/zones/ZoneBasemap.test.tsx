import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import ZoneBasemap from './ZoneBasemap'
let mockError:(event:any)=>void,mockLoad:()=>void
const mockRemove=jest.fn(),mockRaster=jest.fn(),mockHealthRelease=jest.fn(),mockVector:any={addTo:()=>mockVector,getMaplibreMap:()=>({on:(_:string,listener:any)=>{mockError=listener},off:jest.fn(),once:(_:string,listener:any)=>{mockLoad=listener}})}
const mockMap={hasLayer:()=>true,removeLayer:mockRemove}
jest.mock('react-leaflet',()=>({useMap:()=>mockMap}))
jest.mock('@maplibre/maplibre-gl-leaflet',()=>({maplibreGL:()=>mockVector}))
jest.mock('maplibre-gl',()=>({setWorkerUrl:()=>{},setWorkerCount:()=>{}}),{virtual:true})
jest.mock('maplibre-gl/dist/maplibre-gl.css',()=>({}),{virtual:true})
jest.mock('../../diagnostics/mapRendererHealth',()=>({observeMapRenderer:()=>mockHealthRelease}))
jest.mock('leaflet',()=>({__esModule:true,default:{control:{attribution:()=>({addTo(){return this},addAttribution:()=>{},removeAttribution:()=>{},remove:()=>{}})},tileLayer:()=>({addTo:()=>{mockRaster();return {}}})}}))
let host:HTMLDivElement,root:Root
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);jest.clearAllMocks()})
afterEach(()=>{act(()=>root.unmount());host.remove();jest.useRealTimers();delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT})
it('falls back after a map-source error even if load has already fired',()=>{
 act(()=>root.render(<ZoneBasemap iso="en"/>));act(()=>mockLoad())
 expect(host.querySelector('[data-status=ready]')).not.toBeNull()
 act(()=>mockError({sourceId:'basemap'}));act(()=>jest.advanceTimersByTime(0))
 expect(host.querySelector('[data-status=fallback]')).not.toBeNull();expect(mockRaster).toHaveBeenCalledTimes(1)
 act(()=>mockLoad());expect(host.querySelector('[data-status=fallback]')).not.toBeNull()
})
it('cancels pending fallback when the map is unmounted',()=>{
 act(()=>root.render(<ZoneBasemap/>));act(()=>mockError({sourceId:'basemap'}));act(()=>root.render(null));act(()=>jest.advanceTimersByTime(25000))
 expect(mockRaster).not.toHaveBeenCalled();expect(mockHealthRelease).toHaveBeenCalled()
})
