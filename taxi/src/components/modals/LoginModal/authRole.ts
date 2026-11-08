import {EUserRoles} from '../../../types/types'
/** UI intent only. The authenticated role still comes from the server session. */
export function authRoleForPath(pathname: string): EUserRoles {
  return /^\/driver-order(?:\/[^/]+)?\/?$/.test(pathname) || pathname === '/driver-order-test'
    ? EUserRoles.Driver : EUserRoles.Client
}
