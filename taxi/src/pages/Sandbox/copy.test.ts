import { parseSandboxSettings, sandboxCopy } from './copy'

it('keeps malformed or non-object JSON out of the preview settings', () => {
  for (const text of ['{broken', 'null', '[]', '4', '"text"']) expect(parseSandboxSettings(text)).toBeNull()
  expect(parseSandboxSettings('{"blocks":[]}')).toEqual({ blocks: [] })
})

it('provides distinct local copy for all supported interface languages', () => {
  expect(sandboxCopy('ru').save).toBe('Сохранить')
  expect(sandboxCopy('en').save).toBe('Save')
  expect(sandboxCopy('fr-FR').save).toBe('Enregistrer')
  expect(sandboxCopy('ar').save).toBe('احفظ')
})
