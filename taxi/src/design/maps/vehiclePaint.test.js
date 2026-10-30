import {paintPixel} from './vehiclePaint'
test('city paint changes red body to configured blue while preserving livery and tyres',()=>{
 const blue=paintPixel(190,12,18,'#1e58eb');expect(blue[2]).toBeGreaterThan(blue[0]*2)
 expect(paintPixel(235,117,22,'#1e58eb')).toEqual([235,117,22])
 expect(paintPixel(24,24,27,'#1e58eb')).toEqual([24,24,27])
 expect(paintPixel(170,180,210,'#1e58eb')).toEqual([170,180,210])
})
test('configured white and black paints retain shading',()=>{
 const white=paintPixel(190,12,18,'#ffffff');expect(white[0]).toBe(white[1]);expect(white[1]).toBe(white[2])
 const black=paintPixel(190,12,18,'#171717');expect(black[0]).toBeLessThan(30)
 expect(paintPixel(100,4,4,'#ffffff')[0]).toBeLessThan(white[0])
})
