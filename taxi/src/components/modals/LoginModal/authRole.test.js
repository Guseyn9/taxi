import {authRoleForPath} from './authRole'
import {EUserRoles} from '../../../types/types'
test.each(['/driver-order','/driver-order/','/driver-order/42','/driver-order-test'])('driver intent is preserved on %s',path=>{
 expect(authRoleForPath(path)).toBe(EUserRoles.Driver)
})
test.each(['/passenger-order','/some/driver-order','/driver-order-other','/'])('unrelated routes cannot select driver registration: %s',path=>{
 expect(authRoleForPath(path)).toBe(EUserRoles.Client)
})
