import { configureEmulatorTestRuntime, getEmulatorTestRuntime, emulatorTestReady, requireEmulatorAccounts } from './testRuntime'

afterEach(() => configureEmulatorTestRuntime(null))
it('start/check/restore have no default accounts or network endpoint', () => {
  expect(emulatorTestReady('drivers')).toBe(false); expect(emulatorTestReady('clients')).toBe(false)
  expect(() => getEmulatorTestRuntime()).toThrow(); expect(() => requireEmulatorAccounts('drivers')).toThrow()
})
it.each(['https://ibronevik.ru/taxi', 'http://127.0.0.1.evil.test/api', 'https://user:secret@localhost/api', 'http://localhost/api?token=x'])('rejects non-isolated test roots %s', (apiUrl: string) => {
  expect(() => configureEmulatorTestRuntime({ apiUrl, drivers: [], clients: [] })).toThrow()
})
it('stores operator test accounts only in memory and can revoke the configuration', () => {
  const set = jest.spyOn(Storage.prototype, 'setItem')
  configureEmulatorTestRuntime({ apiUrl: 'http://localhost:57100/api/', drivers: [{ name: 'test', login: 'local@example.invalid', password: 'disposable', type: 'e-mail' }], clients: [] })
  expect(emulatorTestReady('drivers')).toBe(true); expect(emulatorTestReady('clients')).toBe(false)
  expect(getEmulatorTestRuntime().apiUrl).toBe('http://localhost:57100/api'); expect(set).not.toHaveBeenCalled()
  configureEmulatorTestRuntime(null); expect(emulatorTestReady('drivers')).toBe(false); set.mockRestore()
})
