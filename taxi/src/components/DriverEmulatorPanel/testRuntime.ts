import { subscribeSessionBoundary } from '../../security/sessionLifecycle'

export interface EmulatorTestAccount {
  name: string
  login: string
  password: string
  type: string
  location?: { latitude: number, longitude: number }
}
interface TestRuntime { apiUrl: string, drivers: EmulatorTestAccount[], clients: EmulatorTestAccount[] }
let runtime: TestRuntime | null = null
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]'].includes(host)
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const configurationSizeLimit = 32 * 1024
subscribeSessionBoundary(() => { runtime = null })

function localApiUrl(apiUrl: string): URL {
  const url = new URL(apiUrl)
  if (!loopback(window.location.hostname) || !loopback(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('EMULATOR_REQUIRES_LOCAL_TEST_SERVER')
  return url
}

export function canConfigureEmulatorTestRuntime(apiUrl: string): boolean {
  try { return Boolean(localApiUrl(apiUrl)) } catch { return false }
}

function parseAccounts(value: unknown): EmulatorTestAccount[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
  return value.map(account => {
    if (!record(account)) throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
    const { name, login, password, type, location } = account
    if (!nonempty(name) || !nonempty(login) || !nonempty(password) || !nonempty(type))
      throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
    const parsed = { name: name.trim(), login: login.trim(), password, type: type.trim() }
    if (location === undefined) return parsed
    if (!record(location)) throw new Error('EMULATOR_TEST_LOCATION_INVALID')
    const { latitude, longitude } = location
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
      throw new Error('EMULATOR_TEST_LOCATION_INVALID')
    return { ...parsed, location: { latitude, longitude } }
  })
}

export function parseEmulatorTestConfiguration(apiUrl: string, source: string, role: 'drivers' | 'clients'): TestRuntime {
  localApiUrl(apiUrl)
  if (source.length > configurationSizeLimit) throw new Error('EMULATOR_TEST_CONFIGURATION_TOO_LARGE')
  const value: unknown = JSON.parse(source)
  if (!record(value) || 'apiUrl' in value) throw new Error('EMULATOR_TEST_CONFIGURATION_INVALID')
  const configuration = { apiUrl, drivers: parseAccounts(value.drivers), clients: parseAccounts(value.clients) }
  if (!configuration[role].length) throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
  return configuration
}

/** Operator-provided disposable accounts, in memory only, on an isolated local stand. */
export function configureEmulatorTestRuntime(value: TestRuntime | null): void {
  runtime = null
  if (!value) return
  const url = localApiUrl(value.apiUrl)
  runtime = { apiUrl: url.href.replace(/\/+$/, ''), drivers: parseAccounts(value.drivers), clients: parseAccounts(value.clients) }
}
export function getEmulatorTestRuntime(): TestRuntime {
  if (!runtime || !loopback(window.location.hostname)) throw new Error('EMULATOR_REQUIRES_LOCAL_TEST_SERVER')
  return runtime
}
export function emulatorTestReady(role: 'drivers' | 'clients'): boolean {
  try { return getEmulatorTestRuntime()[role].length > 0 } catch { return false }
}
export function requireEmulatorAccounts(role: 'drivers' | 'clients'): EmulatorTestAccount[] {
  const accounts = getEmulatorTestRuntime()[role]
  if (!accounts.length) throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
  return accounts.map(account => ({ ...account }))
}
