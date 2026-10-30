import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
let mockClick:any
jest.mock('react-leaflet',()=>({
 MapContainer:({children,center}:any)=><div data-map-center={JSON.stringify(center)}>{children}</div>,
 TileLayer:()=>null,Polyline:({positions}:any)=><div data-map-kind="line">{JSON.stringify(positions)}</div>,
 Polygon:({positions}:any)=><div data-map-kind="polygon">{JSON.stringify(positions)}</div>,
 Circle:({center,radius}:any)=><div data-map-kind="circle">{JSON.stringify({center,radius})}</div>,
 CircleMarker:()=>null,useMapEvents:(events:any)=>{mockClick=events.click},
}))
import ZoneMap from './ZoneMap'
let root:Root,host:HTMLDivElement
beforeEach(()=>{(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
it('renders a closed area, an open boundary and a circle without changing coordinates',async()=>{
 const props={onPoint:jest.fn(),label:'Map',center:null,radius:250}
 const ring:[number,number][]=[[30,-9],[31,-9],[31,-8],[30,-9]]
 await act(async()=>root.render(<ZoneMap {...props} kind="polygon" points={ring}/>))
 expect(host.querySelector('[data-map-kind=polygon]')).not.toBeNull()
 await act(async()=>root.render(<ZoneMap {...props} kind="polygon" points={ring.slice(0,-1)}/>))
 expect(host.querySelector('[data-map-kind=line]')).not.toBeNull()
 await act(async()=>root.render(<ZoneMap {...props} kind="circle" center={[30,-9]} points={[]}/>))
 expect(host.querySelector('[data-map-kind=circle]')!.textContent).toContain('250')
 await act(async()=>mockClick({latlng:{lat:30.42,lng:-9.6}}))
 expect(props.onPoint).toHaveBeenCalledWith([30.42,-9.6])
})
it('does not render invalid circles or pass malformed points to Leaflet',async()=>{
 const props={onPoint:()=>{},label:'Map',center:null,radius:NaN}
 await act(async()=>root.render(<ZoneMap {...props} kind="circle" points={[]}/>))
 expect(host.querySelector('[data-map-kind=circle]')).toBeNull()
 await act(async()=>root.render(<ZoneMap {...props} kind="polygon" points={[[NaN,0],[30,-9]]}/>))
 expect(host.querySelector('[data-map-kind=line]')!.textContent).toBe('[[30,-9]]')
})
