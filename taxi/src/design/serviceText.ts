import {t} from '../localization'
/** Service translations own the wording; packaged prose is an offline fallback. */
export function serviceText<T extends Record<string,string>>(copy:T, namespace:string, keys:Partial<Record<keyof T,string>>={}):T {
 const result={...copy}
 for(const field of Object.keys(copy) as (keyof T)[])
  result[field]=t(keys[field] || `${namespace}_${String(field)}`,{fallback:copy[field]}) as T[keyof T]
 return result
}
