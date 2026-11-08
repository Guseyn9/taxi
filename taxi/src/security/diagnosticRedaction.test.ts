import { isCredentialKey, redactDiagnosticText, redactDiagnostics } from './diagnosticRedaction'

it.each([
  'https://example.invalid/?auth_hash=SENTINEL&tab=map',
  'https://example.invalid/?%61uth%5fhash=SENTINEL&auth_hash=SENTINEL',
  '/driver#access_token=SENTINEL&tab=map',
  'redirect=https%3A%2F%2Fexample.invalid%2F%3Fauth_hash%3DSENTINEL%26tab%3Dmap',
  'https://example.invalid/?%2561uth_hash=SENTINEL',
  'Bearer SENTINEL', 'https://user:SENTINEL@example.invalid/path',
  'Authorization: Basic SENTINEL',
  'Proxy-Authorization: Digest username="SENTINEL", response="SENTINEL"',
  'password: SENTINEL', 'u_hash: SENTINEL',
  'authorization%3A%20Basic%20SENTINEL',
  'redirect=https%3A%2F%2Fexample.invalid%2F%3Fauth_hash%3DSENTINEL&progress=100%',
  'redirect=https%3A%2F%2Fexample.invalid%2F%3Fu_hash%3DSENTINEL&invalid=%E0%A4%A',
  'redirect=https%3A%2F%2Fexample.invalid%2F%3Ftoken%3Dprefix%2526SENTINEL',
  'redirect=https%3A%2F%2Fexample.invalid%2F%3Ftoken%3Dprefix%2523SENTINEL',
  'Error: password: "SENTINEL with spaces"',
  JSON.stringify({auth_hash:'SENTINEL'}),
  JSON.stringify({legacy:JSON.stringify({u_hash:'SENTINEL'})}),
  '{"password":"SENTINEL","unfinished":',
])('removes credentials in every URL representation: %s', (value: string) => {
  expect(redactDiagnosticText(value)).not.toContain('SENTINEL')
})
it('preserves route diagnostics and non-secret correlation IDs', () => {
  expect(redactDiagnosticText('/driver?tab=map&config=gruzvill')).toBe('/driver?tab=map&config=gruzvill')
  expect(redactDiagnostics({sessionId:'correlation',status:'pending',code:200,u_hash:'SENTINEL',nested:['token=SENTINEL']})).toEqual({sessionId:'correlation',status:'pending',code:200,u_hash:'[hidden]',nested:['token=[hidden]']})
  expect(isCredentialKey('%75_hash')).toBe(true)
})
it.each(['copyAndClearInterfaceLog', 'copyAndClearFlowDebugLog', 'copyAndClearRawLog', 'copyAndClearDecisionLog', 'copyAndClearAllLogs', 'copyAndClearFrontendLog'])('redacts the final %s export including raw URL and nested snapshot strings', async (name: string) => {
  const log = require('../tools/frontendLog')
  window.history.replaceState(null,'','/driver?auth_hash=SENTINEL&tab=map#access_token=SENTINEL')
  const spy = jest.spyOn(console,'info').mockImplementation(() => {})
  try {
    const result = await log[name]({ legacy:'https://example.invalid/?u_hash=SENTINEL',serialized:JSON.stringify({auth_hash:'SENTINEL'}),auth_hash:'SENTINEL', header:'Authorization: Basic SENTINEL', error:'password: SENTINEL' })
    expect(result.text).not.toContain('SENTINEL')
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SENTINEL')
  } finally { window.history.replaceState(null,'','/'); spy.mockRestore() }
})
