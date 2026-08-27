/**
 * Посадка пассажира в голосовом заказе.
 *
 * Единственный путь команды — driverMapGateway.confirmBoarding (см. §4 ТЗ
 * DRIVER-BOARDING-001): прямого обращения к API здесь нет и быть не должно.
 * Модуль отвечает только за ПОРЯДОК шагов, а не за бизнес-логику перехода:
 * бэкенд остаётся источником истины, фронтенд лишь приводит к его результату
 * своё локальное состояние.
 *
 * Порядок важен и закреплён тестами: локальная синхронизация выполняется ТОЛЬКО
 * после успешного ответа шлюза. Оптимистичного перехода в Started нет — при
 * неверном коде состояние заказа не меняется, а карточка остаётся в режиме
 * подтверждения кода.
 */

import { IOrder } from '../types/types'
import { DRIVER_DOOR_NUMBER_PATTERN, normalizeDriverDoorNumber } from './driverDoorNumber'

/**
 * Код посадки, введённый водителем, сверяется с кодом заказа локально — до
 * обращения к бэкенду. Если заказ своего кода не знает (бэкенд его не прислал),
 * принимаем любой корректный по форме код: проверять его будет бэкенд.
 */
export function isBoardingCodeAccepted(expected: unknown, entered: unknown): boolean {
  const expectedCode = normalizeDriverDoorNumber(expected)
  const enteredCode = normalizeDriverDoorNumber(entered)

  if (!DRIVER_DOOR_NUMBER_PATTERN.test(enteredCode))
    return false

  return !DRIVER_DOOR_NUMBER_PATTERN.test(expectedCode) || enteredCode === expectedCode
}

export interface IConfirmDriverBoardingOptions {
  readonly orderId: IOrder['b_id']
  readonly code: string
  /** Единая точка выполнения команды посадки — driverMapGateway.confirmBoarding. */
  readonly confirmBoarding: (orderId: IOrder['b_id'], code: string) => Promise<void>
  /**
   * Привести локальное состояние заказа к результату бэкенда: заказ уже в
   * Started, и store/проекция, из которой Driver UI берёт состояние, должна это
   * увидеть, не дожидаясь следующего опроса.
   */
  readonly syncOrderState: (orderId: IOrder['b_id']) => void
  /** Пассажир в салоне: отметки голосования, закрытие карточки, переход на карту. */
  readonly onBoarded: (orderId: IOrder['b_id']) => void
}

export async function confirmDriverBoarding({
  orderId,
  code,
  confirmBoarding,
  syncOrderState,
  onBoarded,
}: IConfirmDriverBoardingOptions): Promise<void> {
  // Ошибка шлюза выбрасывается наружу: ни синхронизация, ни отметки посадки
  // ниже не выполняются, и заказ остаётся в прежнем состоянии.
  await confirmBoarding(orderId, code)
  syncOrderState(orderId)
  onBoarded(orderId)
}
