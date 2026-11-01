import { test as setup, expect, Page, BrowserContext } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { IAccount, driver2Account, driverAccount, hasDriver2Account, passengerAccount } from './fixtures/accounts'
import { expectAppBooted, stubMapTiles } from './fixtures/appShell'
import { DRIVER2_STORAGE, DRIVER_PAGE, DRIVER_STORAGE, PICKUP } from './fixtures/driverUi'
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

  // В текущем Header вход находится в первом пункте бокового меню:
  // сначала открываем меню, затем выбираем пункт аккаунта.
  await page.locator('header .burger-button').click()
  await page.locator('header .menu__account').click()

  const login = page.locator('input[name="login"]')
  const password = page.locator('input[name="password"]')
  // Вход E2E-учёток выполняется по e-mail; форма уже открывается
  // с выбранным email-каналом. Не переключаем radio: это перемонтирует
  // login input (key={type}) и не нужно для обычного входа.
  const signInButton = page.locator('button.login-modal_login-btn')

  await expect(login).toBeVisible()
  await expect(password).toBeVisible()
  await login.fill(account.login)
  await password.fill(account.password)

  // Проверяем, что React Hook Form получил оба значения и валидация
  // сняла disabled. Не нажимаем кнопку, пока форма сама её не разрешит.
  await expect(login).toHaveValue(account.login)
  await expect(password).toHaveValue(account.password)
  await expect(signInButton).toBeEnabled({ timeout: 10_000 })

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

// Второй водитель нужен только голосованию (A.1.2). Пропуск здесь не прячет
// падение сценария: без этой сессии голосовой тест падает на первом же шаге,
// где второй водитель обязателен, — а тесты, которым он не нужен, из-за
// незаполненной учётки не ломаются.
setup('второй водитель входит через форму приложения', async({ page, context }) => {
  setup.skip(!hasDriver2Account(),
    'E2E_DRIVER2_LOGIN/E2E_DRIVER2_PASSWORD не заданы — сессия второго водителя не создаётся')
  await signIn(page, context, driver2Account(), DRIVER_PAGE, DRIVER2_STORAGE)
})
