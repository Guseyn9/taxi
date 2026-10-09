/**
 * Работа с интерфейсом пассажира из теста.
 *
 * Всё — настоящие клики в браузере: Redux напрямую не трогаем, backend-команды
 * вместо клика не отправляем. Отсюда же читается состояние, которое пассажир
 * ВИДИТ, — независимо от того, что в этот момент лежит на бэкенде.
 */

import path from 'path'
import { expect, Page, Request, Response } from '@playwright/test'
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
 * SOS после Started (TEST-E2E-007, ТЗ Passenger SOS).
 *
 * Кнопка в UI достижима ТОЛЬКО в плашке `MiniOrders` (внутри
 * `passenger-mini-order`): `PassengerLiveOrder` (`showLiveOrderPanel = false`
 * в pages/Passenger) и `OnTheWayModal` (нет ни одного вызова
 * `setOnTheWayModal(true)`) через интерфейс недостижимы — см. e2e/README.md.
 * Локатор привязан к конкретному заказу, а не к порядку кнопок на странице.
 */
export const sosOpenButton = (page: Page, orderId: string) =>
  miniOrderCard(page, orderId).getByTestId('passenger-sos-open')

/** Passenger SOS-модал (`components/modals/PassengerSosModal.tsx`). */
export const sosModal = (page: Page) => page.getByTestId('sos-alarm-modal')

/** Все причины SOS-модала — по префиксу testid, а не по порядку в DOM. */
export const sosReasonOptions = (page: Page) => page.locator('[data-testid^="sos-reason-"]')

/** Одна причина по её стабильному индексу (`sos-reason-0`, `sos-reason-1`, ...). */
export const sosReason = (page: Page, index: number) => page.getByTestId(`sos-reason-${index}`)

/** Выбранные причины (radio `aria-checked="true"`) — их должно быть ровно 0 или 1. */
export const sosSelectedReasons = (page: Page) =>
  page.locator('[data-testid^="sos-reason-"][aria-checked="true"]')

export const sosConfirmButton = (page: Page) => page.getByTestId('sos-confirm')

export const sosCloseButton = (page: Page) => page.getByTestId('sos-close')

/**
 * Запросы `set_cancel_state` по заказу, наблюдаемые из браузера пассажира.
 * Подписка ставится ДО действий пользователя: так видно и то, что Close не
 * отправил отмену, и то, что Confirm отправил её ровно один раз. Тело запроса —
 * multipart (`API.cancelDrive`), поэтому поля читаются из `postData()`.
 */
export interface ICancelRequest {
  readonly action: string
  readonly reason: string | undefined
  readonly hasToken: boolean
}

export function watchCancelRequests(page: Page, orderId: string): ICancelRequest[] {
  const seen: ICancelRequest[] = []
  page.on('request', request => {
    if (request.method() !== 'POST' || !request.url().includes(`/drive/get/${orderId}`))
      return
    const body = request.postData() ?? ''
    const field = (name: string) =>
      new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec(body)?.[1]
    if (field('action') !== 'set_cancel_state')
      return
    seen.push({ action: 'set_cancel_state', reason: field('reason'), hasToken: Boolean(field('token')) })
  })
  return seen
}

/** Ответ на `set_cancel_state`: HTTP-статус и тело (бизнес-ошибка приходит в теле, а не в HTTP). */
export async function waitForCancelResponse(page: Page, orderId: string) {
  const response = await page.waitForResponse(item =>
    item.request().method() === 'POST' &&
    item.url().includes(`/drive/get/${orderId}`) &&
    (item.request().postData() ?? '').includes('set_cancel_state'))
  return { status: response.status(), body: await response.json().catch(() => undefined) }
}

/**
 * Создание заказа через форму пассажира (TEST-E2E-008).
 *
 * Хелперы ниже моделируют ДЕЙСТВИЯ ПОЛЬЗОВАТЕЛЯ: ввод адреса, выбор подсказки,
 * свайп, ввод телефона и цены, клик по кнопке режима. Redux, localStorage и
 * page.evaluate() для бизнес-состояния не используются, `/drive` не мокается и из
 * теста не вызывается. Контракт, на котором они построены, замерен разведкой
 * (e2e/README.md, TEST-E2E-008).
 */

export type TPassengerOrderMode = 'order' | 'vote' | 'offer'

/** Точка, которую пассажир вводит текстом и подтверждает подсказкой. */
export interface IPassengerOrderPoint {
  /** Что набирается в поле. */
  readonly query: string
  /**
   * Что должно быть в тексте нужной подсказки. Подсказку выбирают по тексту, а не
   * по порядку: список зависит от истории пассажира («Личный»/«Общий» пункты).
   */
  readonly match: string
}

/** Точки, замеренные разведкой на живом gruzvill. */
export const PASSENGER_ORDER_POINTS: Readonly<Record<'pickup' | 'destination' | 'intercityDestination', IPassengerOrderPoint>> = {
  // Standard и Voting идут PICKUP → DESTINATION (город), Offer — на межгородское назначение.
  pickup: { query: 'улица Содружества 35 Ростов-на-Дону', match: 'Содружества' },
  destination: { query: 'Акмолинская улица 79 Ростов-на-Дону', match: 'Акмолинская' },
  // Таганрог, 52 км: единственный маршрут, на котором UI сам выставляет класс поездки «2».
  intercityDestination: { query: 'Таганрог, Петровская улица 10', match: 'Bogudoniya' },
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const passengerOrderForm = (page: Page) => page.getByTestId('passenger-order-form')

const pointInput = (page: Page, which: 'from' | 'to') => page.getByTestId(`passenger-order-${which}`)

/**
 * Подсказка нужной точки: источник «Карта» (`official`) и текст адреса. Источник
 * читается атрибутом, а не подписью — подписи «Карта/Личный/Общий» зависят от языка.
 */
const pointSuggestion = (page: Page, which: 'from' | 'to', point: IPassengerOrderPoint) =>
  page.locator(`[data-testid="passenger-order-${which}-suggestion"][data-suggestion-source="official"]`)
    .filter({ hasText: point.match })

/** Открыть форму заказа пассажира: приложение поднялось, форма свободна для ввода. */
export async function openPassengerOrderForm(page: Page): Promise<void> {
  await page.goto(PASSENGER_PAGE)
  await expectAppBooted(page)
  await expect(passengerOrderForm(page), 'форма заказа пассажира открыта и не заблокирована')
    .toHaveAttribute('data-locked', 'false', { timeout: 60_000 })
}

/**
 * Ввести одну точку так, как это делает пассажир: набрать адрес и выбрать
 * подсказку. Список обновляется с задержкой, поэтому ждём именно ту подсказку,
 * что подходит по тексту, — устаревший список её не содержит.
 */
export async function pickPassengerPoint(
  page: Page,
  which: 'from' | 'to',
  point: IPassengerOrderPoint,
): Promise<void> {
  const input = pointInput(page, which)
  await input.click()
  await input.fill('')
  await input.pressSequentially(point.query, { delay: 30 })

  const suggestion = pointSuggestion(page, which, point)
  await expect(suggestion, `подсказка «${point.match}» появилась в поле ${which}`)
    .toBeVisible({ timeout: 60_000 })
  await suggestion.click()

  await expect(input, `поле ${which} содержит выбранную точку`)
    .toHaveValue(new RegExp(escapeRegExp(point.match)), { timeout: 30_000 })
}

/** FROM и TO — по очереди, как вводит пассажир. */
export async function fillPassengerOrderPoints(
  page: Page,
  from: IPassengerOrderPoint,
  to: IPassengerOrderPoint,
): Promise<void> {
  await pickPassengerPoint(page, 'from', from)
  await pickPassengerPoint(page, 'to', to)
}

/** Кнопки класса поездки: класс, который приложение выбрало для маршрута. */
const locationClassButton = (page: Page, id: string) =>
  page.locator(`[data-testid="passenger-order-location-class"][data-location-class="${id}"]`)

/**
 * Дождаться, что приложение само определило класс поездки по маршруту. Без этого
 * Offer можно отправить раньше расчёта маршрута: в payload уйдёт класс по умолчанию.
 * Класс не выбирается — проверяется то, что пассажир ВИДИТ.
 */
export async function expectPassengerLocationClass(page: Page, id: string): Promise<void> {
  await expect(locationClassButton(page, id), `маршрут определён, класс поездки ${id} выбран`)
    .toHaveAttribute('data-active', 'true', { timeout: 60_000 })
}

/**
 * Раскрыть форму настоящим touch-жестом. Раскрывается она только свайпом
 * (tools/swipe.ts, события touchstart/move/end), клика нет. Жест шлётся браузеру
 * через CDP `Input.dispatchTouchEvent` — это обычный ввод пользователя, а не
 * подмена состояния.
 */
export async function expandPassengerOrderForm(page: Page): Promise<void> {
  const form = passengerOrderForm(page)
  if (await form.getAttribute('data-expanded') === 'true')
    return

  await expect(async() => {
    const box = await form.boundingBox()
    if (!box)
      throw new Error('форма заказа не отрисована')

    const x = Math.round(box.x + box.width / 2)
    const fromY = Math.round(box.y + 40)
    const toY = Math.max(60, fromY - 450)
    const cdp = await page.context().newCDPSession(page)
    try {
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) => cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: y === undefined ? [] : [{ x, y }],
      })
      await touch('touchStart', fromY)
      for (let step = 1; step <= 8; step += 1) {
        await touch('touchMove', fromY + ((toY - fromY) * step) / 8)
        await page.waitForTimeout(40)
      }
      await touch('touchEnd')
    } finally {
      await cdp.detach().catch(() => undefined)
    }
    await expect(form).toHaveAttribute('data-expanded', 'true', { timeout: 3_000 })
  }, 'форма заказа раскрылась свайпом').toPass({ timeout: 30_000, intervals: [500, 1_000] })
}

/**
 * Ввести телефон в поле формы: выделить содержимое и набрать цифры. Поле
 * предзаполнено телефоном профиля, поэтому тест задаёт номер явно. Маска
 * форматирует ввод сама — сверяются только цифры.
 */
export async function fillPassengerPhone(page: Page, phone: string): Promise<void> {
  const digits = phone.replace(/\D/g, '')
  const input = page.getByTestId('passenger-order-phone')
  await expect(input, 'поле телефона видно в раскрытой форме').toBeVisible({ timeout: 30_000 })
  await input.click()
  await input.press('Control+A')
  await input.press('Backspace')

  // Маска (`+233(___)-___-___`) сама показывает код страны. Если набрать номер
  // целиком, часть цифр совпадёт с этим префиксом, и результат зависит от
  // положения каретки (замерено: `233335550001` вместо `233555000111`). Поэтому
  // после очистки набирается только то, чего в маске ещё нет.
  const shown = (await input.inputValue()).replace(/\D/g, '')
  const rest = digits.startsWith(shown) ? digits.slice(shown.length) : digits
  await input.pressSequentially(rest, { delay: 40 })

  await expect
    .poll(async() => (await input.inputValue()).replace(/\D/g, ''), {
      message: 'поле телефона содержит введённый номер',
      timeout: 15_000,
    })
    .toBe(digits)
}

/**
 * Цена заказчика в режиме «Предложение»: третий сегмент блока цены. Редактируется,
 * пока режим не выбран (после клика по Vote/Order он становится неактивным).
 */
export async function setPassengerOfferPrice(page: Page, price: number): Promise<void> {
  const segment = page.locator('[data-testid="passenger-order-price-segment"][data-price-key="customer"]')
  const input = page.locator('[data-testid="passenger-order-price"][data-price-key="customer"]')
  await expect(segment, 'сегмент цены заказчика виден в раскрытой форме').toBeVisible({ timeout: 30_000 })
  await segment.click()
  await expect(input, 'поле цены заказчика доступно для ввода').toBeEditable({ timeout: 15_000 })
  await input.fill(String(price))
  await input.blur()
  await expect(input, 'поле цены содержит введённое значение').toHaveValue(String(price))
}

/** Кнопка режима — она же создание заказа: отдельной кнопки «Создать» в форме нет. */
export const passengerOrderModeButton = (page: Page, mode: TPassengerOrderMode) =>
  page.getByTestId(`passenger-order-mode-${mode}`)

/**
 * Нажать кнопку режима. Один клик = создание заказа выбранного режима
 * (`setSelectedMode(mode); submit(mode)` в pages/Passenger/VotingForm.tsx), поэтому
 * «выбрать режим» и «создать» в UI — одно действие.
 */
export async function submitPassengerOrder(page: Page, mode: TPassengerOrderMode): Promise<void> {
  const button = passengerOrderModeButton(page, mode)
  await expect(button, `кнопка режима «${mode}» доступна`).toBeEnabled({ timeout: 30_000 })
  await button.click()
}

/** Что браузер отправил, создавая заказ. Токены в эту структуру не попадают. */
export interface IOrderCreationRequest {
  readonly payload: Record<string, any>
}

export interface IOrderCreation {
  readonly request: IOrderCreationRequest
  readonly status: number
  /** Ответ backend целиком: токенов там нет. */
  readonly body: any
  /** `b_id` из ответа — строкой (backend отдаёт число). */
  readonly orderId: string
}

/** Поле `data` multipart-тела: его нет у опроса списка заказов, который идёт тем же `POST /drive`. */
function creationPayloadOf(request: Request): Record<string, any> | undefined {
  if (request.method() !== 'POST' || !/\/drive$/.test(new URL(request.url()).pathname))
    return undefined

  const match = /name="data"\r?\n\r?\n([\s\S]*?)\r?\n--/.exec(request.postData() ?? '')
  if (!match)
    return undefined

  try {
    const payload = JSON.parse(match[1])
    return payload && typeof payload === 'object' && 'b_start_latitude' in payload ? payload : undefined
  } catch {
    return undefined
  }
}

export interface IOrderCreationWatch {
  /** Все запросы СОЗДАНИЯ, которые ушли из браузера (опрос списка заказов сюда не входит). */
  readonly requests: readonly IOrderCreationRequest[]
  /** Дождаться ответа на запрос создания и достать из него `b_id`. Падает, если `b_id` нет. */
  waitForCreated(timeout?: number): Promise<IOrderCreation>
  /** Короткое описание без токенов — для диагностики падения. */
  describe(): string
  dispose(): void
}

/**
 * Наблюдать запрос создания заказа. Подписку надо ставить ДО клика: так видно
 * ровно один запрос и не пропускается быстрый ответ. `POST /drive` — не только
 * создание (им же опрашивается список активных заказов), поэтому создание
 * узнаётся по полю `data` с `b_start_latitude`.
 */
export function watchOrderCreationRequest(page: Page): IOrderCreationWatch {
  const requests: IOrderCreationRequest[] = []
  const responses = new Map<IOrderCreationRequest, { status: number; body: any }>()
  const byRequest = new Map<Request, IOrderCreationRequest>()

  const onRequest = (request: Request) => {
    const payload = creationPayloadOf(request)
    if (!payload)
      return
    const entry: IOrderCreationRequest = { payload }
    requests.push(entry)
    byRequest.set(request, entry)
  }
  const onResponse = async(response: Response) => {
    const entry = byRequest.get(response.request())
    if (!entry)
      return
    responses.set(entry, { status: response.status(), body: await response.json().catch(() => undefined) })
  }

  page.on('request', onRequest)
  page.on('response', onResponse)

  const summarize = () => requests.map((entry, index) => {
    const response = responses.get(entry)
    return `#${index + 1}: HTTP ${response?.status ?? 'нет ответа'}, ` +
      `status=${response?.body?.status ?? '?'}, b_id=${response?.body?.data?.b_id ?? 'нет'}, ` +
      `message=${response?.body?.message ?? response?.body?.data?.message ?? '—'}`
  }).join('; ') || 'запросов создания не было'

  return {
    requests,
    describe: summarize,
    dispose() {
      page.off('request', onRequest)
      page.off('response', onResponse)
    },
    async waitForCreated(timeout = 60_000) {
      await expect
        .poll(() => requests.some(entry => responses.has(entry)), {
          message: 'создающий POST /drive получил ответ',
          timeout,
        })
        .toBe(true)

      const request = requests.find(entry => responses.has(entry))!
      const { status, body } = responses.get(request)!
      const orderId = body?.data?.b_id
      if (orderId === undefined || orderId === null || orderId === '')
        throw new Error(
          `E2E: форма отправила создание заказа, но b_id в ответе нет — HTTP ${status}, ` +
          `status=${body?.status ?? '?'}, message=${body?.message ?? '—'}`)

      return { request, status, body, orderId: String(orderId) }
    },
  }
}

/** После создания пассажир видит ИМЕННО этот заказ, а форма перешла в состояние созданного заказа. */
export async function expectPassengerOrderCreated(page: Page, orderId: string): Promise<void> {
  await expect(miniOrderCard(page, orderId), `в списке пассажира есть заказ ${orderId}`)
    .toBeVisible({ timeout: 120_000 })
  await expect(passengerOrderForm(page), 'форма перешла в состояние созданного заказа')
    .toHaveAttribute('data-locked', 'true', { timeout: 60_000 })
}
