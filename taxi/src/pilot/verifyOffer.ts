/** Verify the persisted mode across sessions; never infer it from creator-only localStorage. */
export async function verifyCreatedOffer<T>({read,isOffer,cancel}:{read:()=>Promise<T|null>,isOffer:(order:T)=>boolean,cancel:()=>Promise<unknown>}):Promise<'verified'|'canceled'|'unverified'|'retained'> {
  let order:T|null
  try{order=await read()}catch{return 'unverified'}
  if(!order)return 'unverified'
  if(isOffer(order))return 'verified'
  try{await cancel();return 'canceled'}catch{return 'retained'}
}
