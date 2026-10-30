import { applyUiDocumentLanguage, uiLanguageAttributes } from './ui-language'

it('normalizes regional UI codes and sets matching HTML language and direction', () => {
  const root = document.createElement('html')
  applyUiDocumentLanguage('AR_ma', root)
  expect(root.lang).toBe('ar-MA')
  expect(root.dir).toBe('rtl')
  applyUiDocumentLanguage('FR_ca', root)
  expect(root.lang).toBe('fr-CA')
  expect(root.dir).toBe('ltr')
})

it('supports the backend Arabic alias and safely falls back for invalid or missing UI locales', () => {
  expect(uiLanguageAttributes('Arab')).toEqual({ lang: 'ar', dir: 'rtl' })
  expect(uiLanguageAttributes('ru_ru')).toEqual({ lang: 'ru-RU', dir: 'ltr' })
  expect(uiLanguageAttributes('en-us')).toEqual({ lang: 'en-US', dir: 'ltr' })
  expect(uiLanguageAttributes(undefined)).toEqual({ lang: 'en', dir: 'ltr' })
  expect(uiLanguageAttributes('invalid locale')).toEqual({ lang: 'en', dir: 'ltr' })
})
