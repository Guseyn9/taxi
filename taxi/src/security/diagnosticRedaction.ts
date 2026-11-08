const HIDDEN = '[hidden]'
const decodeLayer = (value: string) => new URLSearchParams(`value=${value.replace(/&/g, '%26')}`).get('value') || ''
function decoded(value: string): string {
  for (let i = 0; i < 8; i++) {
    // URLSearchParams decodes each escape tolerantly: an unrelated bare percent
    // or invalid UTF-8 must not hide an encoded credential elsewhere in the log.
    const next = decodeLayer(value)
    if (next === value) return value
    value = next
  }
  return '[encoded-data]'
}
export function isCredentialKey(key: string): boolean {
  const name = decoded(key).toLowerCase().replace(/[^a-z0-9]/g, '')
  return /password|passwd|token|secret|authorization|authhash|uhash|apikey|phpsessid/.test(name)
}
function redactPlain(value: string): string {
  return value
    // Header values may contain spaces, quotes and commas (Basic/Digest/etc.).
    .replace(/\b((?:proxy-)?authorization)\s*:[^\r\n]*/gi, `$1: ${HIDDEN}`)
    .replace(/\b([\w.-]*(?:password|passwd|token|secret|auth[_-]?hash|u[_-]?hash|api[_-]?key|phpsessid)[\w.-]*)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, `$1: ${HIDDEN}`)
    .replace(/([^\s=?&#;]+)=([^?&#;\s]*)/g, (match, key: string) =>
    isCredentialKey(key) || ['code', 'otp', 'state'].includes(decoded(key).toLowerCase()) ? `${key}=${HIDDEN}` : match)
    .replace(/(["'])([^"']+)\1\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,}\s]+)/g, (match, quote: string, key: string) => isCredentialKey(key) ? `${quote}${key}${quote}:"${HIDDEN}"` : match)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, `$1${HIDDEN}`)
    .replace(/(\b(?:https?|wss?):\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, `$1${HIDDEN}@`)
}
/** Encoded nested URLs are made readable only when needed to remove credentials. */
export function redactDiagnosticText(value: string, depth = 0): string {
  if (depth > 30) return '[depth-limit]'
  let current = value
  let changed = false
  for (let layer = 0; layer < 8; layer++) {
    if (/^[\s]*[\[{"]/.test(current)) {
      try {
        const parsed = JSON.parse(current)
        const clean = JSON.stringify(redactDiagnostics(parsed, new WeakSet<object>(), depth + 1))
        if (clean !== JSON.stringify(parsed)) return clean
      } catch { /* Truncated legacy strings still pass through lexical redaction below. */ }
    }
    // Redact at every layer BEFORE decoding again. Encoded delimiters inside a
    // credential are part of its value, never a new query field to retain.
    const safe = redactPlain(current)
    changed = changed || safe !== current
    const next = decodeLayer(safe)
    if (next === safe) return changed ? safe : value
    current = next
  }
  return '[encoded-data]'
}
/** Final export boundary also covers records persisted by older application versions. */
export function redactDiagnostics(value: any, seen = new WeakSet<object>(), depth = 0): any {
  if (typeof value === 'string') return redactDiagnosticText(value, depth)
  if (value === null || typeof value !== 'object') return value
  if (depth > 30) return '[depth-limit]'
  if (value instanceof Date) return value.toISOString()
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(item => redactDiagnostics(item, seen, depth + 1))
  const result: Record<string, any> = Object.create(null)
  for (const key of Object.keys(value)) result[key] = isCredentialKey(key) ? HIDDEN : redactDiagnostics(value[key], seen, depth + 1)
  return result
}
