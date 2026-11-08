import fs from 'fs'
import os from 'os'
import path from 'path'
const {collectSecrets, makeRedactor, redactObject} = require('../../e2e/reporters/reportPrivacy.cjs')

test('report privacy normalizes environment precedence and tab session credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'taxi-report-privacy-'))
  try {
    fs.writeFileSync(path.join(root, '.env.e2e.local'), '# comment\nE2E_DRIVER_PASSWORD="file-secret"\nE2E_DRIVER_LOGIN="qa@example.invalid"\n')
    fs.mkdirSync(path.join(root, 'e2e/.auth'), {recursive:true})
    fs.writeFileSync(path.join(root, 'e2e/.auth/driver.session.json'), JSON.stringify({entries:{'state.user.tokens':JSON.stringify({token:'session-token',u_hash:'session-hash'})}}))
    const secrets = collectSecrets(root, {E2E_DRIVER_PASSWORD:' "environment-secret" '})
    expect(secrets).toEqual(expect.arrayContaining(['environment-secret','qa@example.invalid','session-token','session-hash']))
    expect(secrets).not.toContain('file-secret')
  } finally { fs.rmSync(root, {recursive:true, force:true}) }
})

test('report privacy removes escaped and encoded values without hiding order diagnostics', () => {
  const secret = 'private"/Тест+901'
  const redact = makeRedactor([secret])
  const variants = [secret, JSON.stringify(secret).slice(1,-1), encodeURIComponent(secret), new URLSearchParams({value:secret}).toString().slice(6), Buffer.from(secret).toString('base64')]
  for (const value of variants) expect(redact('Order 42 pending '+value)).toBe('Order 42 pending [REDACTED]')
  const error = {message:secret, nested:{stack:secret}, status:'pending', orderId:42}
  error.cause = error
  redactObject(error, redact)
  expect(error.message).toBe('[REDACTED]')
  expect(error.nested.stack).toBe('[REDACTED]')
  expect(error.orderId).toBe(42)
  expect(error.status).toBe('pending')
})
