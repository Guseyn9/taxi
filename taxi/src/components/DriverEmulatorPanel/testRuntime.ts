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

/** Operator-provided disposable accounts, in memory only, on an isolated local stand. */
export function configureEmulatorTestRuntime(value: TestRuntime | null): void {
  runtime = null
  if (!value) return
  const url = new URL(value.apiUrl)
  if (!loopback(window.location.hostname) || !loopback(url.hostname) ||
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('EMULATOR_REQUIRES_LOCAL_TEST_SERVER')
  for (const account of [...value.drivers, ...value.clients])
    if (!account.login || !account.password || !account.type) throw new Error('EMULATOR_TEST_ACCOUNT_REQUIRED')
  runtime = { apiUrl: url.href.replace(/\/+$/, ''), drivers: value.drivers.map(a => ({ ...a })), clients: value.clients.map(a => ({ ...a })) }
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
