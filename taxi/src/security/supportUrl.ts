/** Preserve supported contacts without reinterpreting a URL containing @ as email. */
export function supportHref(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) return null
  const email = /^[^\s@/:?<>]+@[^\s@/:?<>]+\.[^\s@/:?<>]+$/
  if (email.test(raw)) return `mailto:${raw}`
  try {
    const url = new URL(raw)
    if (['https:', 'http:'].includes(url.protocol)) return url.hostname && !url.username && !url.password ? url.href : null
    if (url.protocol === 'mailto:') return email.test(url.pathname) ? url.href : null
    if (url.protocol === 'tel:') return /^\+?[0-9(). -]+$/.test(url.pathname) ? url.href : null
  } catch { /* Invalid contacts remain unavailable. */ }
  return null
}
