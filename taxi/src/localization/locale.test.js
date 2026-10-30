jest.mock('../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../state/config',()=>({configSelectors:{language:jest.fn()}}))
import {configSelectors} from '../state/config'
import {t} from './index'
const prior=window.data
afterEach(()=>{window.data=prior})
test('regional Arabic and French locale tags use their bundled UI translations',()=>{
 window.data={lang_vls:{profile:{en:'Profile'},client_searching_driver:{en:'Searching'}}}
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
