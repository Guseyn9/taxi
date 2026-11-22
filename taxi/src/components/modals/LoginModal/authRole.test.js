import {authRoleForPath, keepCurrentDriverOrder} from './authRole'
import {EUserRoles} from '../../../types/types'
test.each(['/driver-order','/driver-order/','/driver-order/42','/driver-order-test'])('driver intent is preserved on %s',path=>{
 expect(authRoleForPath(path)).toBe(EUserRoles.Driver)
})
test.each(['/passenger-order','/some/driver-order','/driver-order-other','/'])('unrelated routes cannot select driver registration: %s',path=>{
 expect(authRoleForPath(path)).toBe(EUserRoles.Client)
})

test.each([
  ['/driver-order/42', '/driver-order', true],
  ['/driver-order/42/', '/driver-order', true],
  ['/driver-order/42', '/passenger-order', false],
  ['/driver-order', '/driver-order', false],
  ['/driver-order-test', '/driver-order', false],
  ['/driver-order/42/extra', '/driver-order', false],
])('keeps the current detail from %s for destination %s only when appropriate', (pathname, destination, expected) => {
  expect(keepCurrentDriverOrder(pathname, destination)).toBe(expected)
})
