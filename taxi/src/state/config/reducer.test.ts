import reducer from './reducer'
import { ActionTypes } from './constants'
import SITE_CONSTANTS from '../../siteConstants'

jest.mock('../../siteConstants', () => ({
  __esModule: true,
  default: { THE_LANGUAGE_OF_THE_SERVICE: '2', LANGUAGES: [{ id: 2, iso: 'en', native: 'English', logo: 'gb' }] },
}))

afterEach(() => {
  document.cookie = 'user_lang=;max-age=0;path=/'
  SITE_CONSTANTS.LANGUAGES = SITE_CONSTANTS.LANGUAGES.filter(i => i.iso === 'en')
})

it('restores a saved language when remote configuration makes it available', () => {
  const initial = reducer(undefined, { type: 'init' } as any)
  document.cookie = 'user_lang=ar;path=/'
  const arabic = { id: 9, iso: 'ar', native: 'العربية', logo: 'ma' }
  SITE_CONSTANTS.LANGUAGES.push(arabic)
  const restored = reducer(initial, { type: ActionTypes.SET_CONFIG_SUCCESS } as any)
  expect(restored.get('language')).toEqual(arabic)
})

it('keeps the current language when a saved code is unavailable', () => {
  const initial = reducer(undefined, { type: 'init' } as any)
  document.cookie = 'user_lang=unknown;path=/'
  expect(reducer(initial, { type: ActionTypes.SET_CONFIG_SUCCESS } as any).get('language')).toEqual(initial.get('language'))
})
