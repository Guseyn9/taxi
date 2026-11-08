/** MAD/GHS amounts retain cents across input, display and API serialization. */
export function normalizeMoney(value: unknown): number | null {
  if (Array.isArray(value)) return value.length === 1 ? normalizeMoney(value[0]) : null
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).trim().replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const amount = Number(text)
  if (!Number.isFinite(amount) || amount > Number.MAX_SAFE_INTEGER / 100) return null
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

/** Keep the decimal separator while the user is typing, including a trailing comma. */
export function moneyDraft(value: unknown): string | null {
  const text = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '')
  return /^\d*(?:[.,]\d{0,2})?$/.test(text) ? text : null
}
