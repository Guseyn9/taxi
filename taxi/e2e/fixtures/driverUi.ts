/**
 * Работа с интерфейсом водителя из теста.
 *
 * Все действия — настоящие клики в браузере. Redux напрямую не трогаем, шлюз
 * из теста не вызываем, backend-команды вместо клика не отправляем (§20 ТЗ).
 */

import path from 'path'
import { expect, Page } from '@playwright/test'
import { expectAppBooted } from './appShell'
import { DRIVER_STATE } from './taxiApi'

/** Сессия водителя, сохранённая проектом `setup`. */
export const DRIVER_STORAGE = path.resolve(__dirname, '../.auth/driver.json')

/** Сессия второго водителя — отдельный файл, общих cookies/localStorage у ролей нет. */
export const DRIVER2_STORAGE = path.resolve(__dirname, '../.auth/driver2.json')

/** Точка подачи и назначения тестового заказа. Ростов-на-Дону, как у эмулятора. */
export const PICKUP = { latitude: 47.2216, longitude: 39.6343 }
export const DESTINATION = { latitude: 47.2239, longitude: 39.6366 }

/**
 * driverEmulator=1 — штатный переключатель самого приложения
 * (tools/emulatorMode.ts): без него список заказов водителя принудительно пуст.
 * Это режим приложения, а не мок API.
 */
export const DRIVER_PAGE = '/driver-order?tab=map&driverEmulator=1'
/**
 * Вкладка «Все». Значение именно `detailed`: вкладок у водителя три —
 * map/lite/detailed (EDriverTabs в pages/Driver/index.tsx), и при неизвестном
 * значении не отрисовывается ни один список заказов.
 */
export const DRIVER_LIST_PAGE = '/driver-order?tab=detailed&driverEmulator=1'

const primaryAction = (page: Page) => page.getByTestId('driver-map-primary-action')

export async function openDriverMap(page: Page): Promise<void> {
  await page.goto(DRIVER_PAGE)
  await expectAppBooted(page)
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

/** Карточка конкретного заказа в списке водителя. */
export const orderCard = (page: Page, orderId: string) =>
  page.locator(`[data-testid="driver-order-card"][data-order-id="${orderId}"]`)

/**
 * Сколько раз перезагружать список заказов, если карточка не появилась.
 *
 * Не «на всякий случай»: опрос списка у водителя может встать навсегда на
 * первой же загрузке страницы (дефект приложения, подробности у самой функции и
 * в e2e/README.md). Перезагрузка — единственное, что его оживляет. Предел
 * жёсткий: после последней попытки падение остаётся падением.
 */
const LIST_ATTEMPTS = 3

/**
 * Открыть список заказов водителя и дождаться в нём конкретного заказа — БЕЗ
 * клика по карточке.
 *
 * Отдельно от `openOrderCard` потому, что список полезен и сам по себе: пока
 * страница открыта, приложение опрашивает список, и карточка появляется и
 * исчезает по состоянию заказа. Сценарию А.1.4 это нужно, чтобы дождаться
 * ВОЗВРАЩЕНИЯ заказа в живом списке, а не грузить страницу заново.
 */
export async function expectOrderInDriverList(page: Page, orderId: string): Promise<void> {
  for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt += 1) {
    await page.goto(DRIVER_LIST_PAGE)
    await expectAppBooted(page)

    const card = orderCard(page, orderId)
    const last = attempt === LIST_ATTEMPTS
    try {
      await expect(card, `заказ ${orderId} появился в списке водителя`)
        .toBeVisible({ timeout: last ? 120_000 : 45_000 })
    } catch (error) {
      if (last)
        throw error
      // Обход ДЕФЕКТА ПРИЛОЖЕНИЯ, а не «селектор на всякий случай»: селектор тот
      // же, повторяется только загрузка страницы. Опрос списка заказов у
      // водителя умирает навсегда, если на момент первого запроса машина
      // водителя ещё не загружена: `getReadyOrdersSaga` выходит молча, не
      // отправив ни GET_READY_ORDERS_SUCCESS, ни ..._FAIL, а
      // `watchReadyOrdersSaga` ждёт именно их и больше не просыпается
      // (state/orders/sagas.ts). Список остаётся пустым до перезагрузки.
      // Лечится перезагрузкой; чинить надо приложение — см. e2e/README.md.
      console.warn(
        `E2E DRIVER LIST STALLED: заказ ${orderId} не появился в списке за 45 с ` +
        `(попытка ${attempt} из ${LIST_ATTEMPTS}) — перезагружаю страницу. ` +
        'Причина — дефект опроса списка заказов, см. e2e/README.md.')
      continue
    }

    return
  }
}

/**
 * Дождаться заказа в списке водителя и открыть его карточку.
 * Клик по карточке открывает модальную карточку заказа
 * (components/Card/OrderCard.tsx → setOrderCardModal), а не отдельную страницу.
 */
export async function openOrderCard(page: Page, orderId: string): Promise<void> {
  await expectOrderInDriverList(page, orderId)
  await orderCard(page, orderId).click()
}

/** Кнопка «Взять заказ» в карточке заказа. У голосового заказа — «Готов поехать». */
export const takeOrderButton = (page: Page) => page.getByTestId('driver-order-take')

/**
 * ПОКАЗАННОЕ окно результата (components/modals/MessageModal.tsx).
 *
 * Именно видимое, а не любой узел в DOM: замерено, что после закрытия окна в
 * DOM остаётся невидимый узел `message-modal` с другим статусом
 * (e2e/README.md, TEST-E2E-005). Узел в DOM — не то же самое, что окно,
 * показанное водителю.
 */
const messageModal = (page: Page) =>
  page.locator('[data-testid="message-modal"]').filter({ visible: true }).first()

/**
 * Результат действия, о котором приложение сообщило водителю:
 * 'success' | 'warning' | 'fail'. Отклик на голосование подтверждается именно
 * этим окном.
 */
export async function messageModalStatus(page: Page): Promise<string | undefined> {
  const modal = messageModal(page)
  if (await modal.count() === 0)
    return undefined
  return (await modal.getAttribute('data-message-status')) ?? undefined
}

/**
 * Дождаться подтверждения отклика и закрыть окно, как это делает водитель.
 * Окно модальное: пока оно открыто, до карты и списка заказов не добраться.
 *
 * Кнопка закрытия берётся ВНУТРИ показанного окна, а не глобально: иначе клик
 * может уйти в невидимый узел и повиснуть.
 */
export async function confirmActionResult(page: Page, expectedStatus: string, message: string): Promise<void> {
  await expect.poll(() => messageModalStatus(page), { message, timeout: 90_000 }).toBe(expectedStatus)
  const modal = messageModal(page)
  await modal.getByTestId('message-modal-close').click()
  await expect(modal, 'окно с результатом закрылось').toBeHidden({ timeout: 30_000 })
}

/**
 * Перейти на карту вкладкой, как это делает водитель. В отличие от goto,
 * страница не перезагружается: приложение заново тянет конфигурацию с сервера
 * при каждой перезагрузке (src/config.ts), и лишние перезагрузки — лишний риск
 * на ровном месте.
 */
export async function switchToDriverMap(page: Page): Promise<void> {
  await page.getByTestId('driver-tab-map').click()
  await expect(primaryAction(page).first(), 'карта показала основное действие')
    .toBeVisible({ timeout: 120_000 })
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

/**
 * Форма предложения водителя (А.1.3, components/modals/CardModal.tsx).
 *
 * Кнопок две, и подпись у них ОДНА И ТА ЖЕ (`DRIVER_OFFER_SEND`): первая только
 * открывает форму, вторая отправляет предложение. Различить их можно лишь
 * атрибутом, поэтому у каждой свой `data-testid`.
 */
export const offerOpenButton = (page: Page) => page.getByTestId('driver-offer-open')
export const offerPriceInput = (page: Page) => page.getByTestId('driver-offer-price')
export const offerSendButton = (page: Page) => page.getByTestId('driver-offer-send')

/** Открыта ли форма предложения. */
export async function isOfferFormVisible(page: Page): Promise<boolean> {
  return offerPriceInput(page).isVisible().catch(() => false)
}

/** Открыть форму предложения в карточке заказа. */
export async function openOfferForm(page: Page): Promise<void> {
  if (await isOfferFormVisible(page))
    return

  const open = offerOpenButton(page)
  await expect(open, 'в карточке заказа есть кнопка предложения').toBeVisible({ timeout: 90_000 })
  await expect(open, 'кнопка предложения доступна').toBeEnabled({ timeout: 60_000 })
  await open.click()
  await expect(offerPriceInput(page), 'открылась форма предложения').toBeVisible({ timeout: 60_000 })
}

/**
 * Водитель вводит свою цену и подтверждает предложение — оба действия кликом и
 * вводом, как это делает человек. Endpoint предложения из теста не вызывается.
 */
export async function submitDriverOffer(page: Page, price: number): Promise<void> {
  const input = offerPriceInput(page)
  await expect(input, 'поле цены предложения доступно').toBeVisible({ timeout: 60_000 })
  await input.fill(String(price))
  await offerSendButton(page).click()
}

/**
 * Отказ водителя от НАЗНАЧЕННОГО заказа (А.1.4).
 *
 * Доступен только водителю в состоянии `Performer`: после выбора пассажира
 * offer-ветка карточки исчезает (`shouldUseOfferFlow`), и остаётся ветка
 * `c_state === Performer` с тремя кнопками — чат, «Приехал» и эта.
 *
 * Обе кнопки различаются ТОЛЬКО атрибутом: подписи у кнопки отказа нет вовсе,
 * класс совпадает с остальными, а иконка — инлайновый SVG без опознавательных
 * признаков. Подтверждение — отдельное окно, где «OK» тоже неотличим по тексту.
 */
export const orderCancelOpenButton = (page: Page) => page.getByTestId('driver-order-cancel-open')
export const orderCancelConfirmButton = (page: Page) =>
  page.getByTestId('driver-order-cancel-confirm')

/** Доступно ли водителю действие отказа от назначенного заказа. */
export async function isOrderCancelAvailable(page: Page): Promise<boolean> {
  return orderCancelOpenButton(page).isVisible().catch(() => false)
}

/**
 * Водитель отказывается от назначенного заказа — два клика, как это делает
 * человек: сначала действие, затем подтверждение в окне.
 *
 * Endpoint отмены из теста не вызывается. Важно: приложение отправляет запрос
 * БЕЗ `await` и уходит со страницы независимо от результата
 * (`components/modals/DriverCancelModal.tsx`), поэтому факт клика ничего не
 * доказывает — результат обязан подтверждаться чтением состояния заказа.
 */
export async function declineAssignedOrder(page: Page): Promise<void> {
  const open = orderCancelOpenButton(page)
  await expect(open, 'водителю доступно действие отказа от заказа').toBeVisible({ timeout: 90_000 })
  await expect(open, 'действие отказа доступно').toBeEnabled({ timeout: 60_000 })
  await open.click()

  const confirm = orderCancelConfirmButton(page)
  await expect(confirm, 'открылось окно подтверждения отказа').toBeVisible({ timeout: 60_000 })
  await confirm.click()
}

export const STATE_NAMES: Record<number, string> = {
  [DRIVER_STATE.Considering]: 'Considering',
  [DRIVER_STATE.Canceled]: 'Canceled',
  [DRIVER_STATE.Performer]: 'Performer',
  [DRIVER_STATE.Arrived]: 'Arrived',
  [DRIVER_STATE.Started]: 'Started',
  [DRIVER_STATE.Finished]: 'Finished',
}
