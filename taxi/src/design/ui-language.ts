/** UI language only: changing it must not affect API locales or map coordinates. */
export function uiLanguageAttributes(iso?: string): { lang: string; dir: 'rtl' | 'ltr' } {
  const raw = (iso || 'en').trim().replace(/_/g, '-')
  const aliases: Record<string, string> = { arab: 'ar', arabic: 'ar', english: 'en', russian: 'ru', french: 'fr' }
  const parts = raw.split('-')
  parts[0] = aliases[parts[0].toLowerCase()] || parts[0].toLowerCase()
  let lang = 'en'
  try { lang = Intl.getCanonicalLocales(parts.join('-'))[0] || 'en' } catch { lang = 'en' }
  const base = lang.split('-')[0]
  if (!['ru', 'en', 'es', 'fr', 'ar', 'ary', 'zgh'].includes(base)) lang = 'en'
  // The Morocco dictionary distinguishes Arabic and Latin scripts for Darija.
  // Script wins over language: ary-Arab is RTL, ary-Latn is LTR.
  const script = lang.split('-').find(part => /^[A-Z][a-z]{3}$/.test(part))
  const rtl = script ? script === 'Arab' : ['ar', 'ary'].includes(lang.split('-')[0])
  return { lang, dir: rtl ? 'rtl' : 'ltr' }
}

export function applyUiDocumentLanguage(iso: string | undefined, root: Pick<HTMLElement, 'setAttribute'>) {
  const attributes = uiLanguageAttributes(iso)
  root.setAttribute('lang', attributes.lang)
  root.setAttribute('dir', attributes.dir)
}
