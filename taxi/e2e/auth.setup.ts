import { test as setup, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { driverAccount } from './fixtures/accounts'
import { DRIVER_PAGE, PICKUP, openDriverMap } from './fixtures/driverUi'

const STORAGE = path.resolve(__dirname, '.auth/driver.json')

/**
 * Авторизация — через настоящую форму входа приложения, а не подстановкой
 * Redux/localStorage (§6 ТЗ). Результат сохраняется в storageState, чтобы
 * каждый тест не проходил форму заново.
 */
setup('водитель входит через форму приложения', async({ page, context }) => {
  const account = driverAccount()

  await context.setGeolocation(PICKUP)
  await page.goto(DRIVER_PAGE)

  // Вход открывается аватаром в шапке (components/Header/index.tsx).
  await page.locator('header .avatar').first().click()

  const login = page.locator('input[name="login"]')
  await expect(login).toBeVisible()
  await login.fill(account.login)
  await page.locator('input[name="password"]').fill(account.password)
  await page.getByRole('button', { name: /^sign in$/i }).click()

  // Приложение хранит токены здесь (state/user/sagas.ts) — ждём именно их,
  // а не таймер.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('state.user.tokens')), { timeout: 60_000 })
    .toBeTruthy()

  await openDriverMap(page)

  fs.mkdirSync(path.dirname(STORAGE), { recursive: true })
  await context.storageState({ path: STORAGE })
})
