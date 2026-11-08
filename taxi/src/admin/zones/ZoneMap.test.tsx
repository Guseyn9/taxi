import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import ZoneMap from './ZoneMap'
let mockClick:any
const mockMap={fitBounds:jest.fn(),getCenter:()=>({lat:30,lng:-9}),getZoom:()=>12,invalidateSize:jest.fn(),setView:jest.fn(),getContainer:()=>document.body}
jest.mock('./ZoneBasemap',()=>()=> <div data-testid="zone-map-style"/> )
jest.mock('react-leaflet',()=>({
 MapContainer:({children,center}:any)=><div data-map-center={JSON.stringify(center)}>{children}</div>,
 TileLayer:()=>null,Polyline:({positions}:any)=><div data-map-kind="line">{JSON.stringify(positions)}</div>,
 Polygon:({positions}:any)=><div data-map-kind="polygon">{JSON.stringify(positions)}</div>,
 Circle:({center,radius}:any)=><div data-map-kind="circle">{JSON.stringify({center,radius})}</div>,
 Marker:({title,eventHandlers,draggable}:any)=><button type="button" title={title} data-draggable={String(Boolean(draggable))} onClick={()=>eventHandlers.click?.()} onDoubleClick={()=>eventHandlers.dragend?.({target:{getLatLng:()=>({lat:30.5,lng:-9.5})}})}/>,
 useMap:()=>mockMap,useMapEvents:(events:any)=>{mockClick=events.click},
}))
let root:Root,host:HTMLDivElement,previousResizeObserver:typeof ResizeObserver
beforeEach(()=>{previousResizeObserver=global.ResizeObserver;global.ResizeObserver=class{observe(){}disconnect(){}unobserve(){}} as any;(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();global.ResizeObserver=previousResizeObserver;delete (global as any).IS_REACT_ACT_ENVIRONMENT})
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
it('keeps original vertex indices, exposes insertion and blocks map edits while read only',async()=>{
 const move=jest.fn(),insert=jest.fn(),select=jest.fn(),point=jest.fn()
 const props={kind:'polygon' as const,points:[[30,-9],[31,-9],[31,-8],[30,-9]] as [number,number][],center:null,radius:0,label:'Map',iso:'en',onPoint:point,onMoveVertex:move,onInsertVertex:insert,onSelectVertex:select}
 await act(async()=>root.render(<ZoneMap {...props}/>))
 const first=host.querySelector('button[title="Vertex 1"]') as HTMLButtonElement
 await act(async()=>first.click());expect(select).toHaveBeenCalledWith(0)
 await act(async()=>first.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(move).toHaveBeenCalledWith(0,[30.5,-9.5])
 await act(async()=>(host.querySelector('button[title="Insert point 1"]') as HTMLButtonElement).click());expect(insert).toHaveBeenCalledWith(0,[30.5,-9])
 move.mockClear();select.mockClear();await act(async()=>root.render(<ZoneMap {...props} disabled/>))
 expect(host.querySelector('button[title="Insert point 1"]')).toBeNull()
 await act(async()=>mockClick({latlng:{lat:30.42,lng:-9.6}}));expect(point).not.toHaveBeenCalled()
 await act(async()=>(host.querySelector('button[title="Vertex 1"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));expect(move).not.toHaveBeenCalled()
})
it('expands without replacing geometry and restores scrolling on Escape',async()=>{
 const oldOverflow=document.body.style.overflow,point=jest.fn()
 const props={kind:'polygon' as const,points:[[30,-9],[31,-9],[31,-8],[30,-9]] as [number,number][],center:null,radius:0,label:'Map',iso:'en',onPoint:point}
 await act(async()=>root.render(<ZoneMap {...props}/>))
 const button=host.querySelector('[role=button]') as HTMLAnchorElement
 await act(async()=>button.click())
 expect(host.querySelector('[role=dialog]')).not.toBeNull();expect(button.getAttribute('aria-pressed')).toBe('true');expect(document.body.style.overflow).toBe('hidden')
 expect(host.querySelector('[data-map-kind=polygon]')!.textContent).toBe(JSON.stringify(props.points));expect(point).not.toHaveBeenCalled()
 await act(async()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})))
 expect(host.querySelector('[role=dialog]')).toBeNull();expect(document.body.style.overflow).toBe(oldOverflow)
})
