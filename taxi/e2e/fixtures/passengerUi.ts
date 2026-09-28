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

/**
 * Панель водителя с КОНКРЕТНЫМ водителем — локатор, а не чтение атрибута.
 *
 * Нужен там, где панель в этот момент появляется или исчезает: после отказа
 * выбранного водителя (А.1.4) она пропадает, и раздельные «есть ли элемент» и
 * «прочитать атрибут» гоняются между собой — `passengerDriverId` в такой момент
 * зависает на своём таймауте. Утверждение о локаторе Playwright перепроверяет
 * сам, поэтому гонки здесь нет по построению.
 */
export const passengerDriverPanelFor = (page: Page, driverId: string) =>
  page.locator(`[data-testid="passenger-driver-panel"][data-driver-id="${driverId}"]`)

/**
 * Панель водителя в состоянии выполняемой поездки — `Performer` и дальше.
 *
 * Состояния перечислены явно: `data-driver-state` — атрибут, и сравнить его как
 * число селектором нельзя. Зато так видно, какие именно состояния считаются
 * начавшейся поездкой.
 */
export const passengerDriverPanelInTrip = (page: Page) =>
  page.locator([3, 4, 5, 6]
    .map(state => `[data-testid="passenger-driver-panel"][data-driver-state="${state}"]`)
    .join(', '))

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

/** Строка кандидата в списке откликов пассажира (pages/Passenger/VotingForm.tsx). */
export const votingCandidate = (page: Page, driverId: string) =>
  page.locator(`[data-testid="passenger-voting-candidate"][data-driver-id="${driverId}"]`)

/**
 * Открыть голосовой заказ у пассажира. В отличие от стандартного заказа панели
 * водителя здесь ещё нет — до выбора пассажира её и не должно быть, поэтому
 * ждём появления списка откликов.
 *
 * Плашка голосового заказа активна сразу, без водителей
 * (components/MiniOrders/index.tsx), — ждать её «включения» не нужно.
 */
export async function openPassengerVotingOrder(page: Page, orderId: string): Promise<void> {
  await miniOrderCard(page, orderId).click()
  await expect(
    page.locator('[data-testid="passenger-voting-candidate"]').first(),
    'пассажир видит список откликнувшихся водителей',
  ).toBeVisible({ timeout: 120_000 })
}

/** Дождаться, что в списке откликов есть все перечисленные водители. */
export async function expectVotingCandidates(page: Page, driverIds: string[]): Promise<void> {
  for (const driverId of driverIds) {
    await expect(votingCandidate(page, driverId), `водитель ${driverId} в списке откликов`)
      .toBeVisible({ timeout: 120_000 })
  }
}

/**
 * Пассажир выбирает исполнителя — то самое действие, которым завершается
 * голосование (API/order.ts, chooseCandidate). Именно клик: подменять его
 * вызовом endpoint нельзя.
 */
export async function chooseVotingCandidate(page: Page, driverId: string): Promise<void> {
  const select = votingCandidate(page, driverId).getByTestId('passenger-voting-candidate-select')
  await expect(select, `кнопка выбора водителя ${driverId} доступна`).toBeEnabled({ timeout: 60_000 })
  await select.click()
}

/**
 * Цена предложения, которую пассажир ВИДИТ у конкретного водителя (А.1.3).
 *
 * Читается сырое значение из `data-offer-price`, а не показанная строка: та
 * отформатирована и содержит валюту из конфигурации бэкенда. Сырое значение
 * сравнимо с тем, что вернул backend (`offerPriceOf`, taxiApi.ts), — именно этим
 * доказывается, что до пассажира дошло предложение того самого водителя и с той
 * самой ценой.
 */
export async function candidateOfferPrice(page: Page, driverId: string): Promise<number | undefined> {
  const value = votingCandidate(page, driverId).getByTestId('passenger-candidate-offer-price')
  if (await value.count() === 0)
    return undefined

  const raw = await value.first().getAttribute('data-offer-price')
  return raw === null || raw === '' ? undefined : Number(raw)
}

/** Дождаться, что пассажир видит у водителя именно эту цену предложения. */
export async function expectCandidateOfferPrice(
  page: Page,
  driverId: string,
  price: number,
  message: string,
  timeout = 90_000,
): Promise<void> {
  await expect
    .poll(() => candidateOfferPrice(page, driverId), { message, timeout, intervals: [200, 500, 1000] })
    .toBe(price)
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

/** Идентификатор водителя, которого ПОКАЗЫВАЕТ пассажиру интерфейс. */
export async function passengerDriverId(page: Page): Promise<string | undefined> {
  const panel = driverPanel(page)
  if (await panel.count() === 0)
    return undefined
  const raw = await panel.first().getAttribute('data-driver-id')
  return raw === null || raw === '' ? undefined : String(raw)
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

/**
 * Отмена ЗАКАЗА пассажиром (А.1.5) — основная кнопка "Cancel" внизу панели.
 *
 * Не путать с инлайн-кнопкой "Отменить" у аватара водителя
 * (`passenger-voting-form__driver-cancel`): та лишь снимает кандидата
 * (`releaseCandidate`), и backend её отклоняет для уже назначенного `Performer`
 * (`wrong booking state`, замерено при разведке TEST-E2E-006). Различить их можно
 * только атрибутом — обе кнопки называются/выглядят как «отмена».
 */
export const orderCancelOpenButton = (page: Page) => page.getByTestId('passenger-order-cancel-open')
export const orderCancelConfirmButton = (page: Page) => page.getByTestId('passenger-order-cancel-confirm')

/**
 * Пассажир отменяет уже назначенный заказ — два клика, как это делает человек:
 * основная кнопка "Cancel", затем подтверждение в модалке причины. Endpoint
 * отмены (`set_cancel_state`) из теста не вызывается.
 */
export async function cancelAssignedOrder(page: Page): Promise<void> {
  const open = orderCancelOpenButton(page)
  await expect(open, 'пассажиру доступна кнопка отмены заказа').toBeVisible({ timeout: 90_000 })
  await expect(open, 'кнопка отмены заказа доступна').toBeEnabled({ timeout: 60_000 })
  await open.click()

  const confirm = orderCancelConfirmButton(page)
  await expect(confirm, 'открылась модалка подтверждения отмены').toBeVisible({ timeout: 60_000 })
  await confirm.click()
}

/**
 * Открыть плашку заказа кликом — БЕЗ ожидания `passenger-driver-panel`
 * (`selectPassengerOrder` выше). Разведка TEST-E2E-007 (e2e/README.md)
 * показала, что для голосового заказа в `Started` этот узел не рендерится —
 * вероятно, VotingForm.tsx на этом шаге уже уступает место
 * PassengerLiveOrder. Подходит там, где важна сама раскрытая карточка
 * (например, чтобы увидеть SOS/Finish), а не конкретно панель водителя.
 */
export async function openPassengerOrderCard(page: Page, orderId: string): Promise<void> {
  const card = miniOrderCard(page, orderId)
  await expect(card, `плашка заказа ${orderId} видна и активна`)
    .not.toHaveClass(/(^|\s)disabled(\s|$)/, { timeout: 120_000 })
  await card.click()
}

/**
 * SOS после Started (TEST-E2E-007). Один и тот же `data-testid` стоит на
 * ДВУХ разных кнопках — `MiniOrders/index.tsx` (компактная карточка) и
 * `PassengerLiveOrder/index.tsx` (развёрнутая панель); обе вызывают один и
 * тот же `setAlarmModal({isOpen:true})`, поэтому какая из них попадёт под
 * клик — не важно.
 */
export const sosOpenButton = (page: Page) => page.getByTestId('passenger-sos-open').first()

/**
 * Модал, который реально открывается по SOS (`components/modals/AlarmModal.tsx`).
 *
 * Измеренный контракт (e2e/README.md, TEST-E2E-007) — это НЕ «причина +
 * подтверждение»: чисто клиентский 60-секундный таймер без списка причин и
 * без единого обращения к backend. Имя `sosAlarmModal`, а не `sosModal`, —
 * чтобы будущий тест на реальный reason-flow (если он появится) не спутал
 * его с этим.
 */
export const sosAlarmModal = (page: Page) => page.getByTestId('sos-alarm-modal')
export const sosAlarmCancelButton = (page: Page) => page.getByTestId('sos-alarm-cancel')

/** Есть ли внутри SOS-модала хоть один элемент выбора причины. */
export async function sosAlarmReasonElementCount(page: Page): Promise<number> {
  const modal = sosAlarmModal(page)
  if (await modal.count() === 0)
    return 0
  return modal.evaluate(el =>
    el.querySelectorAll('input[type=radio], input[type=checkbox], select, li').length)
}
