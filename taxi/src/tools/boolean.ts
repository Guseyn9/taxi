/** Wire flags may be JSON booleans or legacy numeric strings. Unknown flags fail closed. */
export function parseApiBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false' || !normalized) return false
  return /^[+-]?\d+$/.test(normalized) && Number.isFinite(Number(normalized)) && Number(normalized) !== 0
}
