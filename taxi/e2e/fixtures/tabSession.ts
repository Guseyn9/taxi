import { Browser, BrowserContext, BrowserContextOptions, Page, test as base } from '@playwright/test'
import fs from 'fs'

// storageState does not include sessionStorage. Preserve only the real UI login's
// tab credentials, outside Git/reports; never synthesize credentials in a test.
const sessionFile = (storageFile: string) => storageFile.replace(/\.json$/, '.session.json')
const allowedKeys = ['state.user.tokens', 'taxi.auth.session-epoch']

export async function saveTabSession(page: Page, storageFile: string) {
  const saved = await page.evaluate(keys => ({
    origin: location.origin,
    revocation: localStorage.getItem('taxi.auth.revocation'),
    entries: Object.fromEntries(keys.map(key => [key, sessionStorage.getItem(key)]).filter(([, value]) => value !== null)),
  }), allowedKeys)
  if (!saved.entries['state.user.tokens']) throw new Error('UI login did not create a tab session')
  fs.writeFileSync(sessionFile(storageFile), JSON.stringify(saved), {mode:0o600})
  fs.chmodSync(sessionFile(storageFile), 0o600)
}

async function restoreTabSession(context: BrowserContext, storageFile: string) {
  const saved = JSON.parse(fs.readFileSync(sessionFile(storageFile), 'utf8'))
  const appOrigin = new URL(process.env.E2E_APP_URL || 'http://localhost:3000').origin
  if (saved.origin !== appOrigin || !saved.entries?.['state.user.tokens'])
    throw new Error('Saved UI session does not belong to this test origin; rerun setup')
  const entries = Object.fromEntries(allowedKeys.filter(key => typeof saved.entries[key] === 'string').map(key => [key, saved.entries[key]]))
  await context.addInitScript(({origin, entries, revocation}) => {
    if (location.origin !== origin) return
    if (revocation) localStorage.setItem('taxi.auth.revocation', revocation)
    for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value)
  }, {origin:appOrigin,entries,revocation:saved.revocation as string | null})
}

export async function newAuthenticatedContext(browser: Browser, options: BrowserContextOptions) {
  const context = await browser.newContext(options)
  try {
    if (typeof options.storageState === 'string') await restoreTabSession(context, options.storageState)
    return context
  } catch (error) { await context.close(); throw error }
}

export const test = base.extend({
  context: async({context, storageState}, use) => {
    if (typeof storageState === 'string') await restoreTabSession(context, storageState)
    await use(context)
  },
})
