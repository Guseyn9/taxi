import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import MapBoundary from './MapBoundary'
test('a rendering failure is isolated to the map and retry remounts it without touching the trip',async()=>{
 const host=document.createElement('div'),root=createRoot(host),log=jest.spyOn(console,'error').mockImplementation(()=>{});let fail=true
 const Map=()=>{if(fail)throw new Error('missing pane');return <div>Restored map</div>}
 global.IS_REACT_ACT_ENVIRONMENT=true
 try{await act(async()=>root.render(<MapBoundary resetKey="trip-map" iso="ru"><Map/></MapBoundary>));expect(host.textContent).toContain('Карта временно недоступна');fail=false;await act(async()=>host.querySelector('button').click());expect(host.textContent).toBe('Restored map')}
 finally{await act(async()=>root.unmount());log.mockRestore();delete global.IS_REACT_ACT_ENVIRONMENT}
})
