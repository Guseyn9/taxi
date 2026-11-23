import { loadTenantDictionary } from './security/tenantDictionary'
import store from './state'
import { setConfigError, setConfigLoaded } from './state/config/actionCreators'
import { DEFAULT_CONFIG_NAME } from './constants'
import { serviceEndpoints } from './serviceEndpoints'
import { SESSION_DOMAIN_RESET, clearPrivateDerivedStorage, setPrivateDataOwner } from './security/sessionLifecycle'
import { clearSessionTokens } from './security/sessionTokens'
import { writeRawLog } from './tools/rawLog'

let _configName: string
let currentConfigRead: AbortController | undefined
const resetTenantIdentity = (previous: string | null, next: string) => {
  if (!previous || previous === next) return
  clearSessionTokens();clearPrivateDerivedStorage();setPrivateDataOwner(null)
  // Config can be constructed during store imports; dispatch after that synchronous bootstrap.
  Promise.resolve().then(() => store.dispatch({type:SESSION_DOMAIN_RESET,payload:{clearUser:true}}))
}

const normalizeConfigName = (name?: string | null) => {
  // A dedicated stand must not inherit another service's tenant from an old tab.
  const fixedConfig = process.env.REACT_APP_SERVICE_CONFIG?.trim()
  if (fixedConfig) return fixedConfig
  const configName = (name || '').trim()
  const allowed = new Set([DEFAULT_CONFIG_NAME, ...(process.env.REACT_APP_ALLOWED_SERVICE_CONFIGS || '').split(',').map(value => value.trim()).filter(value => /^[A-Za-z0-9_-]+$/.test(value))])
  return !configName || configName === '0' || !/^[A-Za-z0-9_-]+$/.test(configName) || !allowed.has(configName) ?
    DEFAULT_CONFIG_NAME :
    configName
}

const applyConfigName = (url: string) => {
  currentConfigRead?.abort()
  const controller = new AbortController()
  currentConfigRead = controller
  let deadline: ReturnType<typeof setTimeout>
  const finish = () => {
    clearTimeout(deadline)
    if (currentConfigRead !== controller) return false
    currentConfigRead = undefined
    return true
  }
  const fail = () => {
    if (!finish()) return
    document.getElementById('preloader')?.classList.remove('active')
    store.dispatch(setConfigError())
  }
  // Cap both read attempts together and abort when the tenant changes.
  deadline = setTimeout(() => {
    if (currentConfigRead === controller)
      writeRawLog('TENANT_DICTIONARY_READ_FAILURE', { method: 'GET', endpoint: '/data', reason: 'deadline', durationMs: 15000 })
    fail()
    controller.abort()
  }, 15000)
  loadTenantDictionary(url, controller.signal).then(({ dictionary, metadata }) => {
    if (!finish()) return
    ;(window as any).data = dictionary
    for (const [key, value] of Object.entries(metadata)) (window as any)[key] = value
    store.dispatch(setConfigLoaded())
  }).catch(fail)
}

class Config {
  constructor() {
    let params = new URLSearchParams(window.location.search),
      configParam = params.get('config'),
      clearConfigParam = params.get('clearConfig') !== null

    if (clearConfigParam) {
      this.clearConfig()
    } else if (configParam !== null) {
      this.setConfig(configParam)
    }

    if (configParam !== null) {
      params.delete('config')
    }
    if (!!clearConfigParam) {
      params.delete('clearConfig')
    }

    if (configParam !== null || clearConfigParam) {
      const _path = window.location.origin + window.location.pathname
      let _newUrl = params.toString() ?
        _path + '?' + params.toString() :
        _path
      window.history.replaceState({}, document.title, _newUrl)
    } else {
      this.setDefaultName()
    }
  }

  setConfig(name?: string | null) {
    const configName = normalizeConfigName(name)
    resetTenantIdentity(localStorage.getItem('config'), configName)
    localStorage.setItem('config', configName)
    _configName = configName
    applyConfigName(this.API_URL)
  }

  clearConfig() {
    const previous = localStorage.getItem('config')
    localStorage.removeItem('config')
    _configName = normalizeConfigName()
    resetTenantIdentity(previous, _configName)
    applyConfigName(this.API_URL)
  }

  setDefaultName() {
    this.setConfig(this.SavedConfig)
  }

  get API_URL() {
    return serviceEndpoints(_configName || normalizeConfigName()).apiUrl
  }

  get SERVER_URL() {
    return serviceEndpoints(_configName || normalizeConfigName()).serverUrl
  }

  get SavedConfig() {
    return localStorage.getItem('config')
  }
}

const config = new Config()

export default config
