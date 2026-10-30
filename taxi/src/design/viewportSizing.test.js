import {visibleAppHeight} from './viewportSizing'
test('browser toolbar and keyboard resize the app to the available viewport',()=>{
 expect(visibleAppHeight(900,740)).toBe(740)
 expect(visibleAppHeight(900,410)).toBe(410)
 expect(visibleAppHeight(740,900)).toBe(740)
})
test('pinch zoom does not shrink and reflow the application shell',()=>{
 expect(visibleAppHeight(900,450,2)).toBe(900)
 expect(visibleAppHeight(900,undefined)).toBe(900)
 expect(visibleAppHeight(900,NaN)).toBe(900)
})
