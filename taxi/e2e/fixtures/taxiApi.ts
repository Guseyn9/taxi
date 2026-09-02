/**
 * Клиент живого Taxi API для E2E.
 *
 * Никаких моков: те же endpoint-ы, что использует приложение и driver-emulator.
 * Отсюда тест готовит данные (голосовой заказ, выбор водителя пассажиром) и
 * НЕЗАВИСИМО от UI проверяет состояние заказа на бэкенде.
 *
 * Действия самого водителя здесь сознательно НЕ выполняются — «Взять заказ»,
 * «Поехал», «Приехал» и подтверждение кода делает браузер через интерфейс.
 */

import { apiBase, IAccount } from './accounts'

export interface ISession {
  readonly token: string
  readonly uHash: string
  readonly userId: string
}

export interface ICar {
  readonly c_id: string
  readonly cc_id?: string
  readonly registration_plate?: string
}

export interface IOrderDriver {
  readonly u_id: string
  readonly c_state: string | number
}

export interface IOrderSnapshot {
  readonly b_id: string
  readonly b_state?: string | number
  readonly b_voting?: string | number
  readonly b_cars_count?: string | number
  readonly b_services?: unknown
  readonly b_confirm_state?: string | number
  readonly b_driver_code?: string
  readonly drivers?: IOrderDriver[] | null
  readonly b_start_latitude?: string
  readonly b_start_longitude?: string
  readonly b_destination_latitude?: string
  readonly b_destination_longitude?: string
}

/** Состояния водителя в заказе — те же числа, что и в types/types.ts. */
export const DRIVER_STATE = {
  Considering: 1,
  Canceled: 2,
  Performer: 3,
  Arrived: 4,
  Started: 5,
  Finished: 6,
} as const

export class BackendError extends Error {
  constructor(message: string, readonly response: unknown) {
    super(message)
  }
}

function encode(fields: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '')
      continue
    params.append(key, String(value))
  }
  return params
}

/**
 * Коды, которые означают, что соединение так и не установилось: запрос до
 * бэкенда не дошёл и повторить его безопасно. Всё остальное — включая обрыв
 * уже отправленного запроса — не повторяется: там нельзя утверждать, что
 * заказ не создался.
 */
const CONNECT_FAILURE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
])

const CONNECT_ATTEMPTS = 3

const connectFailureCode = (error: unknown): string | undefined => {
  const code = String((error as any)?.cause?.code ?? (error as any)?.code ?? '')
  return CONNECT_FAILURE_CODES.has(code) ? code : undefined
}

async function fetchWithConnectRetry(url: string, init: RequestInit): Promise<Response> {
  let lastCode = ''
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(url, init)
    } catch (error) {
      const code = connectFailureCode(error)
      if (!code)
        throw error
      lastCode = code
    }
  }
  throw new BackendError(
    `нет соединения с ${url}: ${CONNECT_ATTEMPTS} попытки подряд не установили ` +
    `соединение (${lastCode})`, lastCode)
}

async function post(endpoint: string, fields: Record<string, unknown>): Promise<any> {
  const url = `${apiBase()}${endpoint}`
  const response = await fetchWithConnectRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: encode(fields),
  })
  const text = await response.text()
  let data: any
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text.slice(0, 500) }
  }
  if (!response.ok)
    throw new BackendError(`HTTP ${response.status} ${url}`, data)
  return data
}

function assertOk(response: any, what: string): any {
  if (response?.status === 'error')
    throw new BackendError(`${what}: ${response?.message ?? 'backend error'}`, response)
  return response
}

export async function login(account: IAccount, label: string): Promise<ISession> {
  const auth = await post('/auth', {
    login: account.login,
    password: account.password,
    type: account.type,
    au: 'f',
  })
  if (!auth?.auth_hash)
    throw new BackendError(`${label}: авторизация не прошла (${auth?.message ?? 'нет auth_hash'})`, auth)

  const tokens = await post('/token', { auth_hash: auth.auth_hash })
  const token = tokens?.data?.token
  const uHash = tokens?.data?.u_hash
  if (!token || !uHash)
    throw new BackendError(
      `${label}: не получен токен — бэкенд ответил ` +
      `status=${tokens?.status ?? 'нет'}, message=${tokens?.message ?? 'нет'}`, tokens)

  return { token, uHash, userId: String(auth.auth_user?.u_id ?? '') }
}

const authFields = (session: ISession, extra: Record<string, unknown> = {}) =>
  ({ token: session.token, u_hash: session.uHash, ...extra })

/** Машина водителя: из неё же берётся код посадки (номер по борту). */
export async function getDriverCar(session: ISession): Promise<ICar> {
  const response = await post(`/user/${session.userId}/car`, authFields(session, { array_type: 'list' }))
  const cars = response?.data?.car
  const car: ICar | undefined = Array.isArray(cars) ? cars[0] : cars && (Object.values(cars)[0] as ICar)
  if (!car?.c_id)
    throw new BackendError('у водителя нет машины — E2E запускать не на чем', response)
  return car
}

/**
 * Код посадки ровно по тому же правилу, что и в приложении
 * (tools/driverDoorNumber.ts): первое значение из 3–4 цифр.
 */
export function boardingCodeOf(car: ICar): string {
  const candidates = [
    (car as any).door_number,
    (car as any).profile_number,
    car.c_id,
    car.registration_plate,
  ]
  for (const candidate of candidates) {
    const normalized = String(candidate ?? '').replace(/\D/g, '').slice(0, 4)
    if (/^\d{3,4}$/.test(normalized))
      return normalized
  }
  throw new BackendError('не удалось определить код посадки водителя', car)
}

/** Водитель «на линии»: машина в рейсе и координата отправлена. */
export async function goOnline(
  session: ISession,
  car: ICar,
  position: { latitude: number; longitude: number },
): Promise<void> {
  const drive = await post(`/car/${car.c_id}/drive`, authFields(session))
  // «car is already driven by this user» — нормальное состояние повторного запуска.
  if (drive?.status === 'error' && !/already driven/i.test(String(drive?.message ?? '')))
    throw new BackendError(`не удалось включить машину: ${drive?.message}`, drive)

  assertOk(await post('/location', authFields(session, position)), 'отправка координаты водителя')
}

function startDatetime(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60000)
  const pad = (value: number) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const absolute = Math.abs(offset)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

export interface ICreateOrderOptions {
  readonly pickup: { latitude: number; longitude: number }
  readonly destination: { latitude: number; longitude: number }
  /** Заказ помечается для конкретного водителя — чужие прогоны друг друга не видят. */
  readonly driverId: string
  readonly carClassId?: string
  readonly label: string
}

/** Совпадает с ICreateOrderOptions; имя оставлено ради прежних вызовов. */
export type ICreateVotingOrderOptions = ICreateOrderOptions

/**
 * Общая часть заказа — те же поля, что собирает форма пассажира
 * (pages/Passenger/VotingForm.tsx). Тип заказа задаётся НЕ здесь: голосование
 * добавляет b_voting/b_services, предложение — b_cars_count=0, а стандартный
 * вызов не добавляет ничего.
 */
function orderPayload(options: ICreateOrderOptions): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    b_start_address: `E2E pickup ${options.label}`,
    b_start_latitude: String(options.pickup.latitude),
    b_start_longitude: String(options.pickup.longitude),
    b_destination_address: `E2E destination ${options.label}`,
    b_destination_latitude: String(options.destination.latitude),
    b_destination_longitude: String(options.destination.longitude),
    b_contact: '+70000000000',
    b_start_datetime: startDatetime(2),
    b_passengers_count: 1,
    b_payment_way: 1,
    b_max_waiting: 7200,
    // [DRV:<id>] — механизм изоляции самого проекта: в режиме внешнего эмулятора
    // водитель видит только свои помеченные заказы (tools/emulatorMode.ts).
    b_custom_comment: `[E2E ${options.label}] [DRV:${options.driverId}]`,
    b_options: {
      fromShortAddress: `E2E pickup ${options.label}`,
      toShortAddress: `E2E destination ${options.label}`,
      customer_price: 150,
    },
  }
  if (options.carClassId)
    payload.b_car_class = options.carClassId
  return payload
}

async function postDrive(
  session: ISession,
  payload: Record<string, unknown>,
  what: string,
): Promise<string> {
  const created = await post('/drive', authFields(session, { data: JSON.stringify(payload) }))
  const orderId = created?.data?.b_id ?? created?.b_id
  if (!orderId)
    throw new BackendError(`не удалось создать ${what}: ${created?.message ?? ''}`, created)
  return String(orderId)
}

/** Голосовой заказ от лица пассажира. Каждый прогон создаёт свой. */
export async function createVotingOrder(
  session: ISession,
  options: ICreateOrderOptions,
): Promise<string> {
  const orderId = await postDrive(
    session,
    { ...orderPayload(options), b_voting: 1, b_services: [5] },
    'голосовой заказ',
  )

  // Приложение подтверждает только голосовые заказы (API/order.ts).
  assertOk(
    await post(`/drive/get/${orderId}`, authFields(session, { action: 'set_confirm_state' })),
    'подтверждение заказа пассажиром',
  )

  return orderId
}

/**
 * Стандартный вызов — заказ А.1.1. Отличается от двух остальных типов ровно
 * отсутствием их признаков: нет b_voting/b_services=[5] голосования и нет
 * b_cars_count=0 предложения (pages/Passenger/VotingForm.tsx, mode='order').
 * set_confirm_state приложение для такого заказа не шлёт — не шлём и мы.
 */
export async function createStandardOrder(
  session: ISession,
  options: ICreateOrderOptions,
): Promise<string> {
  return postDrive(session, orderPayload(options), 'стандартный заказ')
}

export async function readOrder(session: ISession, orderId: string): Promise<IOrderSnapshot> {
  const response = await post(`/drive/get/${orderId}`, authFields(session))
  const booking = response?.data?.booking
  const order = booking?.[orderId] ?? booking ?? response?.data
  if (!order)
    throw new BackendError(`заказ ${orderId} не читается`, response)
  return { b_id: orderId, ...order }
}

/** Состояние конкретного водителя в заказе — то, что ТЗ называет c_state. */
export function driverStateOf(order: IOrderSnapshot, driverId: string): number | undefined {
  const driver = (order.drivers ?? []).find(item => String(item.u_id) === String(driverId))
  return driver === undefined ? undefined : Number(driver.c_state)
}

/** Пассажир выбирает водителя из откликнувшихся кандидатов. */
export async function choosePerformer(
  session: ISession,
  orderId: string,
  driverId: string,
): Promise<void> {
  assertOk(
    await post(`/drive/get/${orderId}`, authFields(session, {
      action: 'set_performer',
      performer: '1',
      u_id: driverId,
    })),
    'выбор водителя пассажиром',
  )
}

/**
 * Уборка после теста: заказ уводится в терминальное состояние. Бросает, если
 * бэкенд отменить отказался, — иначе незакрытый заказ остался бы незамеченным,
 * а его номер обязан попасть в лог прогона.
 */
export async function cancelOrder(session: ISession, orderId: string): Promise<void> {
  assertOk(
    await post(`/drive/get/${orderId}`, authFields(session, {
      action: 'set_cancel_state',
      b_comments: 'E2E cleanup',
    })),
    `отмена заказа ${orderId}`,
  )
}

/**
 * Сколько раз перечитывать список активных заказов при уборке. Бэкенд отдаёт
 * его порциями (на gruzvill — по 5), а на общей тестовой учётке от прерванных
 * прогонов накапливаются десятки заказов.
 */
const ACTIVE_ORDERS_SWEEP_PASSES = 60

async function listActiveOrders(session: ISession): Promise<Record<string, any>> {
  const response = await post('/drive', authFields(session, { fields: '00000000u1' }))
  return response?.data?.booking ?? {}
}

/** Виден ли заказ в списке активных заказов пассажира — том самом, который опрашивает приложение. */
export async function isOrderActiveFor(session: ISession, orderId: string): Promise<boolean> {
  return Boolean((await listActiveOrders(session))[orderId])
}

/**
 * Метки, по которым заказ опознаётся как тестовый:
 *
 * * `[E2E <label>]` — метка этих тестов;
 * * `[DRV:<id>]` и `[CASE] <имя>` — метки самого проекта, их ставит
 *   driver-emulator и читает приложение (src/tools/emulatorMode.ts).
 *
 * У настоящего заказа настоящего пассажира ни одной из них быть не может.
 */
const TEST_ORDER_MARKERS = [/\[E2E\b/i, /\[DRV:\s*\d+\]/i, /\[CASE\]/i]

const orderMarkerText = (order: any): string =>
  [order?.b_custom_comment, order?.b_comments].map(value => String(value ?? '')).join(' ')

/** Заказ создан тестовой оснасткой — этого проекта или его эмулятора. */
export const isTestOrder = (order: any): boolean =>
  TEST_ORDER_MARKERS.some(marker => marker.test(orderMarkerText(order)))

const driverParticipates = (order: any, driverId: string): boolean =>
  (order?.drivers ?? []).some((item: any) => String(item.u_id) === String(driverId))

export interface ISweepResult {
  /** Сколько заказов отменено. */
  readonly cancelled: number
  /** Заказы, которые уборка сознательно не тронула или не смогла отменить. */
  readonly skipped: string[]
}

/**
 * Уборка активных заказов пассажира.
 *
 * Отменяется ТОЛЬКО то, что опознано как тестовое: чужой заказ на чужой учётке
 * (например, если в окружении оказался не тот `E2E_PASSENGER_LOGIN`) уборка не
 * тронет — она его пропустит и назовёт в логе прогона.
 *
 * Список бэкенд отдаёт порциями, поэтому он перечитывается, пока порция
 * приносит хоть один отменяемый заказ. Порция целиком из неопознанных заказов
 * означает, что дальше не продвинуться: сдвинуть окно списка нечем, параметра
 * смещения у endpoint нет.
 */
async function sweepActiveOrders(
  passenger: ISession,
  shouldCancel: (orderId: string, order: any) => boolean,
): Promise<ISweepResult> {
  let cancelled = 0
  const skipped = new Set<string>()

  for (let pass = 0; pass < ACTIVE_ORDERS_SWEEP_PASSES; pass += 1) {
    const entries = Object.entries<any>(await listActiveOrders(passenger))
    if (!entries.length)
      break

    let cancelledInPass = 0
    for (const [orderId, order] of entries) {
      if (!shouldCancel(orderId, order)) {
        skipped.add(orderId)
        continue
      }
      try {
        await cancelOrder(passenger, orderId)
        cancelled += 1
        cancelledInPass += 1
      } catch (error) {
        // Один упрямый заказ не должен обрывать уборку остальных, но и
        // потеряться он не должен: его номер уходит в лог прогона.
        skipped.add(orderId)
        console.error(
          `E2E SWEEP: не удалось отменить orderId=${orderId} — ${(error as Error)?.message ?? error}`)
      }
    }

    if (!cancelledInPass)
      break
  }

  return { cancelled, skipped: [...skipped] }
}

/**
 * Подготовка предусловия: у пассажира не должно остаться тестовых заказов от
 * прерванных прогонов. Голосовой заказ с истёкшим ожиданием открывает
 * пассажиру модальное окно поверх страницы и сбрасывает выбранный заказ
 * (state/orders/sagas.ts), то есть ломает сценарий.
 */
export const cancelPassengerTestOrders = (passenger: ISession): Promise<ISweepResult> =>
  sweepActiveOrders(passenger, (_orderId, order) => isTestOrder(order))

/**
 * Уборка после прогона: тестовые заказы и заказы, в которых участвует наш
 * тестовый водитель, — чтобы следующий прогон не начинался с занятым водителем.
 */
export const cancelDriverActiveOrders = (
  passenger: ISession,
  driverId: string,
  keepOrderId?: string,
): Promise<ISweepResult> =>
  sweepActiveOrders(passenger, (orderId, order) =>
    orderId !== keepOrderId && (isTestOrder(order) || driverParticipates(order, driverId)))
