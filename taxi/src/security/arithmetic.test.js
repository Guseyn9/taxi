import { evaluateArithmetic, displayArithmetic, priceNumber } from './arithmetic'
import { calculateFinalPrice, calculateFinalPriceFormula } from '../tools/order'

const order=(formula, options={},submitPrice)=>({b_options:{pricingModel:{formula,options},submitPrice}})
test('preserves arithmetic precedence, fractions, numeric strings, Math functions and legacy whole-price result',()=>{
 expect(evaluateArithmetic('base + distance * rate - discount', {base:'10',distance:1.25,rate:2,discount:0})).toBe(12.5)
 expect(evaluateArithmetic('Math.max(10, Math.ceil(distance * 2.5)) + 2 ** 3', {distance:5})).toBe(21)
 expect(evaluateArithmetic('1e3 + 2e-1')).toBe(1000.2)
 expect(calculateFinalPrice(order('distance * rate + submit_price',{distance:1.25,rate:2},10))).toBe('12')
 expect(calculateFinalPrice(order('submit_rice',{},7))).toBe('7')
 expect(displayArithmetic('1e3 + distance + distance_rate',{distance:2,distance_rate:3})).toBe('1e3 + 2 + 3')
 expect(calculateFinalPrice(null)).toBe('err');expect(calculateFinalPrice(order('-'))).toBe('-')
 expect(calculateFinalPriceFormula(order('distance + duration',{distance:2,duration:0}))).toBe('2 + 0')
})
test.each(['globalThis.__pricingPwned=1','(function(){return 42})()','Math.constructor("return 1")()','[].constructor.constructor("return 1")()','fetch("https://example.com")','1;2','1/*comment*/+2','constructor + 1','1 / 0','2 ** 99999','1e999','('.repeat(100)+'1'+')'.repeat(100)])('rejects executable or unbounded formula %s',formula=>{
 ;(globalThis).__pricingPwned=0
 expect(calculateFinalPrice(order(formula))).toBe('err')
 expect((globalThis).__pricingPwned).toBe(0)
 delete (globalThis).__pricingPwned
})
test.each(['1;globalThis.__pricingPwned=1','(1+2)','0x10','Infinity','',{},true])('rejects nonnumeric data without evaluating or coercing it',value=>{
 expect(()=>priceNumber(value)).toThrow()
 expect(calculateFinalPrice(order('distance + 1',{distance:value}))).toBe('err')
})
test('uses own identifiers only and preserves zero/optional values',()=>{
 expect(evaluateArithmetic('zero + optional',{zero:0,optional:null})).toBe(0)
 expect(()=>evaluateArithmetic('inherited',Object.create({inherited:100}))).toThrow()
 expect(()=>evaluateArithmetic('missing')).toThrow()
 expect(calculateFinalPriceFormula(order('distance',{distance:'<img src=x onerror=alert(1)>'}))).toBe('err')
})
test('preserves price sentinel and numeric option submit_price when no top-level override is present',()=>{
 expect(calculateFinalPriceFormula(order('-'))).toBe('-')
 expect(calculateFinalPrice(order('submit_price + distance',{submit_price:10,distance:2}))).toBe('12')
 expect(calculateFinalPriceFormula(order('submit_price + distance',{submit_price:10,distance:2}))).toBe('10 + 2')
 expect(calculateFinalPrice(order('submit_price',{submit_price:10},0))).toBe('0')
})
