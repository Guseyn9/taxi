/**
 * Работа с интерфейсом водителя из теста.
 *
 * Все действия — настоящие клики в браузере. Redux напрямую не трогаем, шлюз
 * из теста не вызываем, backend-команды вместо клика не отправляем (§20 ТЗ).
 */

import { expect, Page } from '@playwright/test'
import { DRIVER_STATE } from './taxiApi'

/** Точка подачи и назначения тестового заказа. Ростов-на-Дону, как у эмулятора. */
export const PICKUP = { latitude: 47.2216, longitude: 39.6343 }
export const DESTINATION = { latitude: 47.2239, longitude: 39.6366 }

/**
 * driverEmulator=1 — штатный переключатель самого приложения
 * (tools/emulatorMode.ts): без него список заказов водителя принудительно пуст.
 * Это режим приложения, а не мок API.
 */
export const DRIVER_PAGE = '/driver-order?tab=map&driverEmulator=1'
export const DRIVER_LIST_PAGE = '/driver-order?tab=all&driverEmulator=1'

const primaryAction = (page: Page) => page.getByTestId('driver-map-primary-action')

export async function openDriverMap(page: Page): Promise<void> {
  await page.goto(DRIVER_PAGE)
  await expect(page.locator('header')).toBeVisible()
}

/**
 * Состояние заказа, которое ПОКАЗЫВАЕТ интерфейс. Читается атрибутом кнопки
 * основного действия, а не переводом подписи: подписи приходят из конфигурации
 * бэкенда и зависят от языка, состояние — нет.
 */
export async function uiDriverState(page: Page): Promise<number | undefined> {
  const button = primaryAction(page)
  if (await button.count() === 0)
    return undefined
  const raw = await button.first().getAttribute('data-driver-state')
  return raw === null || raw === '' ? undefined : Number(raw)
}

export async function expectUiDriverState(
  page: Page,
  state: number,
  message: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(() => uiDriverState(page), { message, timeout, intervals: [100, 200, 500] })
    .toBe(state)
}

/**
 * Сколько миллисекунд интерфейс шёл до нужного состояния. Нужно ровно для
 * одного: дефект DRIVER-BOARDING-001 — не «UI никогда не догонит бэкенд», а «UI
 * догонит его только следующим опросом списка заказов». Без замера времени
 * тест проходит и на сломанном коде.
 */
export async function measureUiStateDelay(page: Page, state: number, timeout: number): Promise<number> {
  const startedAt = Date.now()
  await expect
    .poll(() => uiDriverState(page), { timeout, intervals: [100, 200, 300] })
    .toBe(state)
  return Date.now() - startedAt
}

/** Дождаться, пока заказ появится в списке водителя, и открыть его карточку. */
export async function openOrderCard(page: Page, orderId: string): Promise<void> {
  await page.goto(DRIVER_LIST_PAGE)
  const card = page.locator(`[href*="/driver-order/${orderId}"], [data-order-id="${orderId}"]`).first()
  await expect(card).toBeVisible({ timeout: 120_000 })
  await card.click()
}

/** Нажать основное действие карты («Поехал», «Приехал», «Код посадки»). */
export async function clickPrimaryAction(page: Page): Promise<void> {
  const button = primaryAction(page).first()
  await expect(button).toBeVisible({ timeout: 120_000 })
  await expect(button).toBeEnabled({ timeout: 120_000 })
  await button.click()
}

/**
 * Открыть форму кода посадки: на карте это «Код посадки» → карточка заказа, а в
 * карточке голосовой заказ сначала просит отметить прибытие к пассажиру.
 */
export async function openBoardingForm(page: Page): Promise<void> {
  await clickPrimaryAction(page)

  const arrived = page.getByTestId('driver-voting-arrived')
  const input = page.getByTestId('driver-boarding-code-input')

  await expect
    .poll(async() => (await input.count()) > 0 || (await arrived.count()) > 0,
      { message: 'карточка голосового заказа открылась', timeout: 90_000 })
    .toBe(true)

  if (await input.count() === 0) {
    await expect(arrived).toBeEnabled({ timeout: 60_000 })
    await arrived.click()
  }

  await expect(input, 'появилось поле кода посадки').toBeVisible({ timeout: 90_000 })
}

export const boardingCodeInput = (page: Page) => page.getByTestId('driver-boarding-code-input')
export const boardingConfirmButton = (page: Page) => page.getByTestId('driver-boarding-confirm')

/** Открыта ли форма подтверждения кода посадки. */
export async function isBoardingFormVisible(page: Page): Promise<boolean> {
  return boardingCodeInput(page).isVisible().catch(() => false)
}

export async function submitBoardingCode(page: Page, code: string): Promise<void> {
  const input = boardingCodeInput(page)
  await expect(input).toBeVisible({ timeout: 60_000 })
  await input.fill(code)
  await boardingConfirmButton(page).click()
}

export const STATE_NAMES: Record<number, string> = {
  [DRIVER_STATE.Considering]: 'Considering',
  [DRIVER_STATE.Performer]: 'Performer',
  [DRIVER_STATE.Arrived]: 'Arrived',
  [DRIVER_STATE.Started]: 'Started',
  [DRIVER_STATE.Finished]: 'Finished',
}
