import {Coordinate} from './model'
import {closedBoundary,moveVertex,insertVertex,removeVertex,canRemoveVertex,parseZonePoints} from './geometry'
const square:Coordinate[]=[[30,-9],[31,-9],[31,-8],[30,-8],[30,-9]]
it('distinguishes editable open paths from invalid JSON and malformed points',()=>{
 expect(parseZonePoints('[]')).toEqual([]);expect(parseZonePoints('[[30,-9]]')).toEqual([[30,-9]])
 for(const text of ['[[30,-9], BROKEN','{}','[null]','[[91,0]]','[["30",-9]]'])expect(parseZonePoints(text)).toBeNull()
})
it('moves either closing endpoint together without mutating the source',()=>{
 for(const index of [0,4]){
  const moved=moveVertex(square,index,[30.1,-9.1])
  expect(moved[0]).toEqual([30.1,-9.1]);expect(moved[4]).toEqual(moved[0]);expect(closedBoundary(moved)).toBe(true)
 }
 expect(square[0]).toEqual([30,-9]);expect(square[4]).toEqual([30,-9])
})
it('moves an open endpoint without changing the other endpoint',()=>{
 const result=moveVertex(square.slice(0,-1),0,[30.1,-9.1])
 expect(result[3]).toEqual([30,-8]);expect(closedBoundary(result)).toBe(false)
})
it('inserts a vertex on the closing edge and preserves all existing vertices',()=>{
 const result=insertVertex(square,3,[30,-8.5])
 expect(result).toEqual([...square.slice(0,-1),[30,-8.5],square[0]]);expect(closedBoundary(result)).toBe(true)
})
it('deletes the first vertex and recloses the polygon on the next vertex',()=>{
 const result=removeVertex(square,0)
 expect(result).toEqual([[31,-9],[31,-8],[30,-8],[31,-9]])
 expect(canRemoveVertex(result,0)).toBe(false);expect(removeVertex(result,0)).toBe(result)
})
it('rejects invalid points and out-of-range handles without changing the draft',()=>{
 expect(moveVertex(square,0,[91,0])).toBe(square);expect(moveVertex(square,-1,[30,-9])).toBe(square)
 expect(insertVertex(square,4,[30,-9])).toBe(square);expect(removeVertex(square,4)).toBe(square)
})
