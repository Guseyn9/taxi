import {zoneCopy} from './copy'
it('provides stable strings for the editor and confirmation',()=>{
 for(const iso of ['ru','en','fr','ar']){const copy=zoneCopy(iso);expect(copy.confirm.length).toBeGreaterThan(0);expect(copy.unknown.length).toBeGreaterThan(0)}
})
