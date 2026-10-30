/** UI language only: changing it must not affect API locales or map coordinates. */
export function uiLanguageAttributes(iso?: string): { lang: string; dir: 'rtl' | 'ltr' } {
  const raw = (iso || 'en').trim().replace(/_/g, '-')
  const aliases: Record<string, string> = { arab: 'ar', arabic: 'ar', english: 'en', russian: 'ru', french: 'fr' }
  const parts = raw.split('-')
  parts[0] = aliases[parts[0].toLowerCase()] || parts[0].toLowerCase()
  let lang = 'en'
  try { lang = Intl.getCanonicalLocales(parts.join('-'))[0] || 'en' } catch { lang = 'en' }
  const base = lang.split('-')[0]
  if (!['ru', 'en', 'fr', 'ar'].includes(base)) lang = 'en'
  return { lang, dir: lang.split('-')[0] === 'ar' ? 'rtl' : 'ltr' }
}

export function applyUiDocumentLanguage(iso: string | undefined, root: Pick<HTMLElement, 'setAttribute'>) {
  const attributes = uiLanguageAttributes(iso)
  root.setAttribute('lang', attributes.lang)
  root.setAttribute('dir', attributes.dir)
}
