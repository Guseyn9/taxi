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

async function post(endpoint: string, fields: Record<string, unknown>): Promise<any> {
  const url = `${apiBase()}${endpoint}`
  const response = await fetch(url, {
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
    throw new BackendError(`${label}: не получен токен`, tokens)

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

export interface ICreateVotingOrderOptions {
  readonly pickup: { latitude: number; longitude: number }
  readonly destination: { latitude: number; longitude: number }
  /** Заказ помечается для конкретного водителя — чужие прогоны друг друга не видят. */
  readonly driverId: string
  readonly carClassId?: string
  readonly label: string
}

/** Голосовой заказ от лица пассажира. Каждый прогон создаёт свой. */
export async function createVotingOrder(
  session: ISession,
  options: ICreateVotingOrderOptions,
): Promise<string> {
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
    b_voting: 1,
    b_services: [5],
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

  const created = await post('/drive', authFields(session, { data: JSON.stringify(payload) }))
  const orderId = created?.data?.b_id ?? created?.b_id
  if (!orderId)
    throw new BackendError(`не удалось создать голосовой заказ: ${created?.message ?? ''}`, created)

  assertOk(
    await post(`/drive/get/${orderId}`, authFields(session, { action: 'set_confirm_state' })),
    'подтверждение заказа пассажиром',
  )

  return String(orderId)
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

/** Уборка после теста: заказ уводится в терминальное состояние. */
export async function cancelOrder(session: ISession, orderId: string): Promise<void> {
  await post(`/drive/get/${orderId}`, authFields(session, {
    action: 'set_cancel_state',
    b_comments: 'E2E cleanup',
  }))
}

/** Активные заказы водителя — для уборки «зависших» прогонов. */
export async function cancelDriverActiveOrders(
  passenger: ISession,
  driverId: string,
  keepOrderId?: string,
): Promise<number> {
  const response = await post('/drive', authFields(passenger, { fields: '00000000u1' }))
  const booking = response?.data?.booking ?? {}
  let cancelled = 0
  for (const [orderId, order] of Object.entries<any>(booking)) {
    if (orderId === keepOrderId)
      continue
    const mine = (order?.drivers ?? []).some((item: any) => String(item.u_id) === String(driverId))
    const label = String(order?.b_custom_comment ?? '')
    if (!mine && !label.includes('[E2E'))
      continue
    await cancelOrder(passenger, orderId)
    cancelled += 1
  }
  return cancelled
}
