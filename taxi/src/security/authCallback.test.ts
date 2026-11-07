import { captureAuthCallback, consumeOAuthHash, consumeRegistrationCallback, beginGoogleOAuth } from './authCallback'

beforeEach(() => { process.env.REACT_APP_OAUTH_STATE_SUPPORTED = 'true'; window.history.replaceState({ keep: true }, '', '/passenger-order'); sessionStorage.clear(); captureAuthCallback(); try { consumeOAuthHash() } catch {} ; consumeRegistrationCallback() })
it('scrubs every secret parameter before bootstrap and preserves unrelated navigation state', () => {
  window.history.replaceState({ keep: true }, '', '/passenger-order?auth_hash=%25%2B&auth_hash=second&state=s&keep=1#map')
  sessionStorage.setItem('taxi.oauth.state', 's')
  captureAuthCallback()
  expect(window.location.search).toBe('?keep=1'); expect(window.location.hash).toBe('#map'); expect(window.history.state).toEqual({ keep: true })
  expect(consumeOAuthHash()).toBe('%+'); expect(consumeOAuthHash()).toBeNull()
})
it.each(['%', '%25', '%2B', '%E2%82%AC'])('accepts URLSearchParams decoding without a second URI decode: %s', (encoded: string) => {
  sessionStorage.setItem('taxi.oauth.state', 's')
  window.history.replaceState(null, '', `/?state=s&auth_hash=${encoded}`); captureAuthCallback()
  expect(consumeOAuthHash()).toBe(new URLSearchParams(`auth_hash=${encoded}`).get('auth_hash'))
})
it('mismatched and unsolicited callbacks never expose a hash for exchange', () => {
  sessionStorage.setItem('taxi.oauth.state', 'expected'); window.history.replaceState(null, '', '/?auth_hash=x&state=other'); captureAuthCallback()
  expect(() => consumeOAuthHash()).toThrow('OAUTH_STATE_MISMATCH'); expect(consumeOAuthHash()).toBeNull()
  expect(window.location.search).toBe(''); expect(sessionStorage.getItem('taxi.oauth.state')).toBeNull()
})
it('cleans empty hashes and keeps registration names with literal plus, percent and Unicode', () => {
  window.history.replaceState(null, '', '/?auth_hash='); captureAuthCallback(); expect(window.location.search).toBe(''); expect(consumeOAuthHash()).toBeNull()
  sessionStorage.setItem('taxi.oauth.state', 's'); window.history.replaceState(null, '', '/?u_email=a%2Bb%40example.invalid&u_name=A%2BB%20%25%20%D9%85&state=s'); captureAuthCallback()
  expect(consumeRegistrationCallback()).toEqual({ email: 'a+b@example.invalid', name: 'A+B % م' }); expect(consumeRegistrationCallback()).toBeNull()
})
it('Google initiation is unavailable until the matching server callback is supported', () => {
  const previous = process.env.REACT_APP_OAUTH_STATE_SUPPORTED; delete process.env.REACT_APP_OAUTH_STATE_SUPPORTED
  try { expect(() => beginGoogleOAuth('https://accounts.google.com/o/oauth2/v2/auth')).toThrow('OAUTH_BACKEND_NOT_READY') }
  finally { if (previous !== undefined) process.env.REACT_APP_OAUTH_STATE_SUPPORTED = previous }
})

it.each([null, 'wrong'])('registration rejects absent/mismatched state %p', (state: string | null) => {
  sessionStorage.setItem('taxi.oauth.state', 'expected')
  window.history.replaceState(null, '', '/?u_email=x%40example.invalid&u_name=X'+(state?'&state='+state:'')); captureAuthCallback()
  expect(consumeRegistrationCallback()).toBeNull(); expect(sessionStorage.getItem('taxi.oauth.state')).toBeNull()
})
it('disabled Google cannot activate a registration callback even with a matching old state', () => {
 delete process.env.REACT_APP_OAUTH_STATE_SUPPORTED;sessionStorage.setItem('taxi.oauth.state','s')
 window.history.replaceState(null,'','/?u_email=x%40example.invalid&u_name=X&state=s');captureAuthCallback();expect(consumeRegistrationCallback()).toBeNull()
})
