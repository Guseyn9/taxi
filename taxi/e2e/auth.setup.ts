import { test as setup, expect, Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { driverAccount } from './fixtures/accounts'
import { DRIVER_PAGE, PICKUP, openDriverMap } from './fixtures/driverUi'

const STORAGE = path.resolve(__dirname, '.auth/driver.json')

/**
 * Почему форма не пускает дальше. Значения полей не раскрываются — только их
 * длина и текст сообщений самой формы: строка уходит в лог прогона.
 */
async function describeLoginState(page: Page): Promise<string> {
  const lengthOf = async(selector: string) =>
    (await page.locator(selector).inputValue().catch(() => '')).length
  const emailChecked = await page.locator('input[name="type"][value="e-mail"]')
    .isChecked().catch(() => false)
  const messages = (await page.locator('.sign-in-subform .input__error').allInnerTexts())
    .map(text => text.trim()).filter(Boolean)

  return `логин: ${await lengthOf('input[name="login"]')} символов, ` +
    `пароль: ${await lengthOf('input[name="password"]')} символов, ` +
    `переключатель e-mail: ${emailChecked ? 'выбран' : 'не выбран'}, ` +
    (messages.length ?
      `форма сообщает: ${messages.join(' | ')}` :
      'сообщений об ошибке форма не показывает')
}

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
  const password = page.locator('input[name="password"]')
  const signIn = page.getByRole('button', { name: /^sign in$/i })

  // Кнопка включается только при чистой валидации формы
  // (`disabled={!!Object.values(errors).length}` в LoginModal/Login.tsx), а поле
  // логина перемонтируется, когда форма определяется с типом входа (`key={type}`
  // там же): введённый текст пропадает вместе со старым элементом. На медленной
  // машине ввод успевает раньше этого, поэтому повторяем его, пока форма не
  // признает данные валидными.
  try {
    await expect(async() => {
      await login.fill(account.login)
      await password.fill(account.password)
      await expect(signIn).toBeEnabled({ timeout: 2_000 })
    }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000] })
  } catch {
    // Иначе падение выглядит как глухой таймаут клика по disabled-кнопке и не
    // говорит, что именно форму не устроило.
    throw new Error(
      'E2E: форма входа не приняла учётные данные, кнопка «Sign in» осталась ' +
      `заблокированной. ${await describeLoginState(page)}`)
  }

  await signIn.click()

  // Приложение хранит токены здесь (state/user/sagas.ts) — ждём именно их,
  // а не таймер.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('state.user.tokens')), { timeout: 60_000 })
    .toBeTruthy()

  await openDriverMap(page)

  fs.mkdirSync(path.dirname(STORAGE), { recursive: true })
  await context.storageState({ path: STORAGE })
})
