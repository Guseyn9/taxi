import {paintPixel,paintLiveryPixel,paintGrandPixel} from './vehiclePaint'
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

it('Grand side band changes without repainting tyres or windows',()=>{
 expect(paintLiveryPixel(235,117,22,'#E8E2D5','#2261A6')).toEqual([34,97,166])
 expect(paintLiveryPixel(24,24,27,'#E8E2D5','#2261A6')).toEqual([24,24,27])
 expect(paintLiveryPixel(170,180,210,'#E8E2D5','#2261A6')).toEqual([170,180,210])
})

it('class-specific body override preserves Grand yellow panels, black checkers and windows',()=>{
 expect(paintGrandPixel(235,235,235,'#1e58eb')).toEqual([28,81,217])
 expect(paintGrandPixel(244,204,0,'#1e58eb')).toEqual([244,204,0])
 expect(paintGrandPixel(20,20,20,'#1e58eb')).toEqual([20,20,20])
 expect(paintGrandPixel(150,170,190,'#1e58eb')).toEqual([150,170,190])
})
