import type {ITokens,IUser} from '../../types/types'
export function authorizationRejected(error:any):boolean{return [401,403].includes(Number(error?.response?.status??error?.status))}
/** A network failure is not evidence that a session was revoked. A late response cannot undo logout. */
export async function verifySession(tokens:ITokens,check:()=>Promise<IUser|null>,current:()=>ITokens|null):Promise<{kind:'ready';user:IUser}|{kind:'stale'}|{kind:'invalid'}|{kind:'retry'}>{
 try{const user=await check(),now=current();if(!now||now.token!==tokens.token||now.u_hash!==tokens.u_hash)return {kind:'stale'};return user?{kind:'ready',user}:{kind:'invalid'}}catch(error){const now=current();if(!now||now.token!==tokens.token||now.u_hash!==tokens.u_hash)return {kind:'stale'};return {kind:authorizationRejected(error)?'invalid':'retry'}}
}
