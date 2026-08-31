/**
 * Работа с интерфейсом пассажира из теста.
 *
 * Всё — настоящие клики в браузере: Redux напрямую не трогаем, backend-команды
 * вместо клика не отправляем. Отсюда же читается состояние, которое пассажир
 * ВИДИТ, — независимо от того, что в этот момент лежит на бэкенде.
 */

import path from 'path'
import { expect, Page } from '@playwright/test'
import { expectAppBooted } from './appShell'

export const PASSENGER_PAGE = '/passenger-order'

/** Сессия пассажира, сохранённая проектом `setup`. */
export const PASSENGER_STORAGE = path.resolve(__dirname, '../.auth/passenger.json')

/** Плашка конкретного активного заказа в верхнем списке (components/MiniOrders). */
export const miniOrderCard = (page: Page, orderId: string) =>
  page.locator(`[data-testid="passenger-mini-order"][data-order-id="${orderId}"]`)

const driverPanel = (page: Page) => page.getByTestId('passenger-driver-panel')

/** Открыть экран заказа пассажира и дождаться, пока в списке появится свой заказ. */
export async function expectOrderVisibleToPassenger(page: Page, orderId: string): Promise<void> {
  await page.goto(PASSENGER_PAGE)
  await expectAppBooted(page)
  await expect(miniOrderCard(page, orderId), `заказ ${orderId} виден пассажиру`)
    .toBeVisible({ timeout: 120_000 })
}

/**
 * Выбрать свой заказ в списке. После выбора форма переходит в режим активного
 * заказа и показывает панель водителя (pages/Passenger/VotingForm.tsx).
 *
 * До назначения водителя плашка стандартного заказа неактивна
 * (components/MiniOrders/index.tsx) — выбирать заказ имеет смысл только после
 * того, как исполнитель появился.
 */
export async function selectPassengerOrder(page: Page, orderId: string): Promise<void> {
  const card = miniOrderCard(page, orderId)
  await expect(card, `плашка заказа ${orderId} стала активной`)
    .not.toHaveClass(/(^|\s)disabled(\s|$)/, { timeout: 120_000 })
  await card.click()
  await expect(driverPanel(page), 'форма пассажира показывает панель водителя')
    .toBeVisible({ timeout: 60_000 })
}

/**
 * Состояние водителя, которое ПОКАЗЫВАЕТ интерфейс пассажира. Читается
 * атрибутом панели, а не переводом подписи: подписи зависят от языка,
 * состояние — нет. Тот же приём, что и на стороне водителя (driverUi.ts).
 */
export async function passengerDriverState(page: Page): Promise<number | undefined> {
  const panel = driverPanel(page)
  if (await panel.count() === 0)
    return undefined
  const raw = await panel.first().getAttribute('data-driver-state')
  return raw === null || raw === '' ? undefined : Number(raw)
}

export async function expectPassengerDriverState(
  page: Page,
  state: number,
  message: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(() => passengerDriverState(page), { message, timeout, intervals: [100, 200, 500] })
    .toBe(state)
}
