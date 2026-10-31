import {visibleMapPoint} from './mapCenter'
import {selectTestMapArea,TEST_MAP_AREA_EVENT} from './TestMapArea'
it('locator and callback share the center of the unobstructed map',()=>{
 expect(visibleMapPoint({left:0,top:64,width:390,height:780},{top:464,right:390},false)).toEqual([195,200])
 expect(visibleMapPoint({left:0,top:64,width:1440,height:836},{top:64,right:480},true)).toEqual([960,418])
 expect(visibleMapPoint({left:0,top:0,width:390,height:780},null,false)).toEqual([195,390])
})
it('camera test validates IDs and emits no service/geolocation event',()=>{
 const listener=jest.fn();window.addEventListener(TEST_MAP_AREA_EVENT,listener)
 expect(selectTestMapArea('not-a-city')).toBe(false);expect(listener).not.toHaveBeenCalled()
 expect(selectTestMapArea('agadir')).toBe(true);expect(listener).toHaveBeenCalledTimes(1)
 expect((listener.mock.calls[0][0] as CustomEvent).detail).toBe('agadir')
 window.removeEventListener(TEST_MAP_AREA_EVENT,listener)
})
