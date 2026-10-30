/** Ratings are shown only when the server supplied a valid five-point score. */
export function formatDriverRating(value: unknown): string {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '')
    return '—'
  const rating = Number(value)
  return Number.isFinite(rating) && rating > 0 && rating <= 5 ? rating.toFixed(1) : '—'
}
