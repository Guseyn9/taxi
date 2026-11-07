import axios from 'axios'
import { assertSessionGeneration, sessionGeneration } from '../security/sessionLifecycle'

export const LEGACY_HTTP_TIMEOUT_MS = 15000

// All legacy API modules use this shared Axios singleton. Individual calls may
// choose a shorter deadline (configuration version already uses ten seconds).
if (axios.defaults) axios.defaults.timeout = LEGACY_HTTP_TIMEOUT_MS
// Reject obsolete responses before endpoint-specific .then handlers can mutate caches.
if (axios.interceptors) {
  axios.interceptors.request.use(config => {
    ;(config as any).__taxiSessionGeneration = sessionGeneration()
    return config
  })
  axios.interceptors.response.use(response => {
    const expected = (response.config as any)?.__taxiSessionGeneration
    if (typeof expected === 'number') assertSessionGeneration(expected)
    return response
  }, error => {
    const expected = error?.config?.__taxiSessionGeneration
    if (typeof expected === 'number') assertSessionGeneration(expected)
    return Promise.reject(error)
  })
}
