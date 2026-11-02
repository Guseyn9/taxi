import {setLocalizationLanguageReader} from './runtime'
jest.mock('../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../state/config',()=>({configSelectors:{language:jest.fn()}}))
import {configSelectors} from '../state/config'
import {t} from './index'
setLocalizationLanguageReader(()=>configSelectors.language())
const prior=window.data
afterEach(()=>{window.data=prior})
test('regional Arabic and French locale tags use their bundled UI translations',()=>{
 window.data=undefined
 configSelectors.language.mockReturnValue({id:9,iso:'ar-MA'})
 expect(t('profile')).toBe('الملف الشخصي');expect(t('booking_driver_states.1')).toBe('جارٍ البحث عن سائق')
 configSelectors.language.mockReturnValue({id:4,iso:'fr-FR'})
 expect(t('profile')).toBe('Profil');expect(t('client_driver_on_way_title')).toBe('Le chauffeur arrive')
})
test('normalizing the UI locale does not replace server-owned car model names',()=>{
 configSelectors.language.mockReturnValue({id:9,iso:'ar-MA'})
 window.data={car_models:{42:{'ar-MA':'Actual model'}}}
 expect(t('car_models.42')).toBe('Actual model')
})

test('service values take precedence over every bundled business label and hint',()=>{
 configSelectors.language.mockReturnValue({id:9,iso:'ar-MA'})
 window.data={lang_vls:{vote:{9:'DB vote'},client_offer_short_button:{ar:'DB offer'},client_offer_hint:{'ar-MA':'DB hint'}}}
 expect(t('vote')).toBe('DB vote')
 expect(t('client_offer_short_button')).toBe('DB offer')
 expect(t('client_offer_hint',{fallback:'Packaged hint'})).toBe('DB hint')
 expect(t('new_interface_key',{fallback:'Offline copy'})).toBe('Offline copy')
})
test('business text is never rewritten by the frontend',()=>{
 configSelectors.language.mockReturnValue({id:1,iso:'ru'})
 window.data={lang_vls:{client_intercity_order_mode:{ru:'Предложение'}}}
 expect(t('client_intercity_order_mode')).toBe('Предложение')
})
