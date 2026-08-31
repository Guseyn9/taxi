import { test as setup, expect, Page, BrowserContext } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { IAccount, driverAccount, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import { DRIVER_PAGE, DRIVER_STORAGE, PICKUP } from './fixtures/driverUi'
import { PASSENGER_PAGE, PASSENGER_STORAGE } from './fixtures/passengerUi'

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
 * Вход через настоящую форму приложения, а не подстановкой Redux/localStorage
 * (§6 ТЗ). Результат сохраняется в storageState, чтобы каждый тест не проходил
 * форму заново.
 */
async function signIn(
  page: Page,
  context: BrowserContext,
  account: IAccount,
  entryPage: string,
  storage: string,
): Promise<void> {
  await context.setGeolocation(PICKUP)
  await stubMapTiles(context)
  await page.goto(entryPage)

  await expectAppBooted(page)

  // Вход открывается аватаром в шапке (components/Header/index.tsx).
  await page.locator('header .avatar').first().click()

  const login = page.locator('input[name="login"]')
  await expect(login).toBeVisible()
  const password = page.locator('input[name="password"]')
  const signInButton = page.getByRole('button', { name: /^sign in$/i })

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
      await expect(signInButton).toBeEnabled({ timeout: 2_000 })
    }).toPass({ timeout: 60_000, intervals: [500, 1_000, 2_000] })
  } catch {
    // Иначе падение выглядит как глухой таймаут клика по disabled-кнопке и не
    // говорит, что именно форму не устроило.
    throw new Error(
      'E2E: форма входа не приняла учётные данные, кнопка «Sign in» осталась ' +
      `заблокированной. ${await describeLoginState(page)}`)
  }

  await signInButton.click()

  // Приложение хранит токены здесь (state/user/sagas.ts) — ждём именно их,
  // а не таймер.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('state.user.tokens')), { timeout: 60_000 })
    .toBeTruthy()

  fs.mkdirSync(path.dirname(storage), { recursive: true })
  await context.storageState({ path: storage })
}

// Вход выполняется на «своей» странице роли, поэтому и режим внешнего
// эмулятора (driverEmulator=1), и токены сессии оказываются в storageState уже
// к моменту сохранения — перезагружать страницу ещё раз незачем.
setup('водитель входит через форму приложения', async({ page, context }) => {
  await signIn(page, context, driverAccount(), DRIVER_PAGE, DRIVER_STORAGE)
})

setup('пассажир входит через форму приложения', async({ page, context }) => {
  await signIn(page, context, passengerAccount(), PASSENGER_PAGE, PASSENGER_STORAGE)
})
