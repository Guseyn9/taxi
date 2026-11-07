import {normalizeMoney,moneyDraft} from './money'
it('preserves cents through backend numbers and comma/dot input',()=>{
 for(const amount of [22.5,'22.50','22,50',[22.5]])expect(normalizeMoney(amount)).toBe(22.5)
 expect(normalizeMoney('1\u202f234,56')).toBe(1234.56)
 expect(normalizeMoney(0)).toBe(0)
 expect(normalizeMoney(1.005)).toBe(1.01)
})
it('rejects invalid, negative, ambiguous and unsafe amounts',()=>{
 for(const amount of ['',null,undefined,'free',false,'12USD',-1,Infinity,NaN,[150,180],Number.MAX_SAFE_INTEGER])expect(normalizeMoney(amount)).toBeNull()
})
it('lets the user type a decimal separator without changing the amount into ten times the price',()=>{
 expect(moneyDraft('22,')).toBe('22,')
 expect(moneyDraft('22,50')).toBe('22,50')
 expect(moneyDraft('22.5')).toBe('22.5')
 expect(moneyDraft('')).toBe('')
 expect(moneyDraft('22.555')).toBeNull()
 expect(moneyDraft('22,5.0')).toBeNull()
})
