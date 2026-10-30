import { formatPhoneNumber } from './phoneUtils'

const previousData = window.data
beforeEach(() => {
  window.data = { site_constants: { def_maska_tel: { value: '+233(___)-___-___' } } }
})
afterAll(() => { window.data = previousData })

test.each(['233000102901', '+233000102901', '+233(000)-102-901'])(
  'formats a complete site-prefix number without consuming its country code as local digits: %s', phone => {
    expect(formatPhoneNumber(phone)).toBe('+233(000)-102-901')
  },
)
test('formats local digits including leading zeros without dropping any digits', () => {
  expect(formatPhoneNumber('000102901')).toBe('+233(000)-102-901')
  // A local subscriber number can coincidentally begin with the site prefix.
  expect(formatPhoneNumber('233102901')).toBe('+233(233)-102-901')
})
test.each(['11000102901', '+11000102901', '+11 000 102 901'])(
  'maps the complete internal driver prefix back to the site prefix: %s', phone => {
    expect(formatPhoneNumber(phone)).toBe('+233(000)-102-901')
  },
)
test.each(['447700900123', '+44 7700 900123', '+330102901', '23300010290155', '00010'])(
  'keeps an unknown prefix or a non-fitting value intact instead of clipping it: %s', phone => {
    expect(formatPhoneNumber(phone)).toBe(phone)
  },
)
test('leaves empty values empty and does not invent a subscriber number', () => {
  expect(formatPhoneNumber('')).toBe('')
})
