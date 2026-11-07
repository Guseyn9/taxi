'use strict'
const fs = require('node:fs')
const path = require('node:path')

// Test credentials and saved authentication state stay outside report output.
function collectSecrets(root, env = process.env) {
  const values = new Set()
  const add = value => { if (typeof value === 'string' && value) values.add(value) }
  const fileEnv = {}
  const envFile = path.join(root, '.env.e2e.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator !== -1) fileEnv[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }
  for (const key of new Set([...Object.keys(fileEnv), ...Object.keys(env)])) {
    if (!/^E2E_.*(?:LOGIN|PASSWORD|TOKEN|HASH|SECRET)$/.test(key)) continue
    const raw = (env[key] ?? fileEnv[key] ?? '').trim()
    const quoted = /^(['"])(.*)\1$/.exec(raw)
    add(quoted ? quoted[2] : raw)
  }
  function readTokens(value) {
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (/^(?:token|u_hash|access_token|refresh_token|authorization)$/i.test(key)) add(child)
      if (key === 'cookies' && Array.isArray(child)) child.forEach(cookie => add(cookie?.value))
      if (key === 'state.user.tokens' && typeof child === 'string') {
        add(child)
        try { readTokens(JSON.parse(child)) } catch { /* partial state is not published */ }
      }
      readTokens(child)
    }
  }
  const stateDir = path.join(root, 'e2e/.auth')
  if (fs.existsSync(stateDir)) for (const name of fs.readdirSync(stateDir)) {
    if (!name.endsWith('.json')) continue
    try { readTokens(JSON.parse(fs.readFileSync(path.join(stateDir, name), 'utf8'))) } catch { /* absent/partial state */ }
  }
  return [...values]
}

function makeRedactor(secrets) {
  const forms = new Set()
  for (const value of secrets) {
    if (typeof value !== 'string' || !value) continue
    for (const text of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), new URLSearchParams({ value }).toString().slice(6), Buffer.from(value).toString('base64')]) {
      forms.add(text)
      forms.add(text.replace(/%[0-9A-F]{2}/g, part => part.toLowerCase()))
    }
  }
  const sorted = [...forms].sort((a, b) => b.length - a.length)
  return text => {
    let result = String(text)
    for (const secret of sorted) result = result.split(secret).join('[REDACTED]')
    return result
  }
}

function redactObject(value, redact, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value) || Buffer.isBuffer(value)) return
  seen.add(value)
  for (const key of Object.keys(value)) {
    if (typeof value[key] === 'string') value[key] = redact(value[key])
    else redactObject(value[key], redact, seen)
  }
}

module.exports = { collectSecrets, makeRedactor, redactObject }
