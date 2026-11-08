import {visibleMapLayout} from './visibleMapLayout'
const map={top:64,left:0,right:390,bottom:844,width:390,height:780}
const hidden={top:0,left:0,right:0,bottom:0,width:0,height:0}
const sheet={top:520,left:0,right:390,bottom:844,width:390,height:324}
test('a hidden/fullscreen panel never moves attribution into the map',()=>{
 expect(visibleMapLayout(map,hidden,hidden,false,true)).toEqual({visibleHeight:780,coveredBottom:0,coveredLeft:0})
 expect(visibleMapLayout(map,hidden,hidden,false,false)).toEqual({visibleHeight:780,coveredBottom:0,coveredLeft:0})
})
test('portrait keeps attribution at the visible map edge; landscape uses the entire map height',()=>{
 expect(visibleMapLayout(map,sheet,sheet,false,false)).toEqual({visibleHeight:456,coveredBottom:0,coveredLeft:0})
 expect(visibleMapLayout(map,sheet,sheet,true,false).visibleHeight).toBe(780)
})
test('a shorter sheet expands the map again rather than retaining the old child height',()=>{
 const previouslyShrunk={...map,height:178,bottom:242}
 expect(visibleMapLayout(previouslyShrunk,sheet,sheet,false,false,map).visibleHeight).toBe(456)
 const lowerSheet={...sheet,top:640,height:204}
 expect(visibleMapLayout(previouslyShrunk,lowerSheet,lowerSheet,false,false,map).visibleHeight).toBe(576)
 expect(visibleMapLayout(previouslyShrunk,hidden,hidden,false,true,map).visibleHeight).toBe(780)
})
