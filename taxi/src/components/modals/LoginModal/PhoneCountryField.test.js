import {canonicalPhone,phoneCountry} from './PhoneCountryField'
import {normalizePhoneNumber} from '../../../tools/phoneUtils'
test.each([['+212 (612) 345-678','+212612345678','MA'],['00381 64 123 4567','+381641234567','RS'],['+233 24 123 4567','+233241234567','GH']])('international paste %s keeps the country and subscriber number',(input,canonical,iso)=>{
 expect(canonicalPhone(input)).toBe(canonical);expect(phoneCountry(canonical).iso).toBe(iso)
})
test('mask and country choice do not rewrite the established driver normalization',()=>{
 window.data={site_constants:{def_maska_tel:{value:'+233(___)___-____'}}}
 expect(normalizePhoneNumber(canonicalPhone('+233 24 123 4567'),true,true)).toBe('+11241234567')
 expect(normalizePhoneNumber(canonicalPhone('+212 612 345678'),true,true)).toBe('+212612345678')
 delete window.data
})
