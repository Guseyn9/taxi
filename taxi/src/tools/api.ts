import '../API/httpPolicy'
import { userSelectors } from '../state/user'
import { ParametersExceptFirst } from '../types'
import state from '../state'
import { assertSessionGeneration, sessionGeneration } from '../security/sessionLifecycle'

export interface IApiMethodArguments {
  token: string,
  uHash: string,
  formData: FormData
}

interface apiMethodOptions {
  authRequired?: boolean
}

export const apiMethod = <T extends (...args: any[]) => any>(
  method: T,
  {
    authRequired = true,
  }: apiMethodOptions = {},
) => {
  return (...args: ParametersExceptFirst<T>): ReturnType<T> => {
    const generation = sessionGeneration()
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.reject(new Error('Network unavailable. Reconnect and check the current order before trying again.')) as ReturnType<T>
    const formData = new FormData()
    let tokens

    if (authRequired) {
      tokens = userSelectors.tokens(state.getState())
      if (!tokens) {
        console.error('Auth failed for API call')
        return Promise.reject(new Error('Unauthorized user')) as ReturnType<T>
      }

      formData.append('token', tokens.token)
      formData.append('u_hash', tokens.u_hash)
    }

    const parameters = [
      {
        token: tokens?.token,
        u_hash: tokens?.u_hash,
        formData,
      }, ...args,
    ] as Parameters<T>
    return Promise.resolve(method(...parameters)).then(result => {
      assertSessionGeneration(generation)
      return result
    }) as ReturnType<T>
  }
}

export interface IResponseFields {
  /** Список валидных ключей */
  affected_fields: string[],
  /** Список невалидных ключей */
  forbidden_fields: string[],
  /** Список ключей с некорректными данными */
  wrong_data_fields?: string[]
}

export const addToFormData = (formData: FormData, object: {[key: string]: any}) => {
  for (let [key, value] of Object.entries(object)) {
    if (value === null || value === undefined || value === '') continue
    formData.append(key, value)
  }
  return formData
}
