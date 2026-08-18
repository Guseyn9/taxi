/**
 * When the client emulator should plant a same-way ("попутный") order.
 *
 * Waiting for the scenario to happen by itself is hopeless: a companion only
 * appears if a fresh order lands in the ready list exactly while the driver is
 * mid-trip, which falls out maybe once in several runs. So the emulator plants
 * one deliberately — every N-th generated order — and alternates the moment it
 * shows up, so both orderings of the trip plan get exercised:
 *
 *   1-й попутчик — пока водитель едет ЗА пассажиром (до посадки);
 *   2-й попутчик — пока он ВЕЗЁТ пассажира (после посадки);
 *   3-й — снова до посадки, и так далее.
 *
 * The rule lives here, away from the 3000-line emulator, because the invariant
 * that matters ("every second order, and the phases really do alternate") is
 * exactly the kind of counter juggling that silently rots.
 */

import { TDriverTripPhase } from './driverTripPhase'

/** Каждый N-й сгенерированный заказ делаем попутным. */
export const ALONG_THE_WAY_EVERY_NTH_ORDER = 2

/** Фазы поездки, в которых по очереди появляется попутчик. */
export const ALONG_THE_WAY_PHASE_SEQUENCE: TDriverTripPhase[] = ['to-pickup', 'to-dropoff']

export class AlongTheWaySchedule {
  /** Обычных заказов создано с прошлого попутчика. */
  private ordersSinceAlongTheWay = 0
  /** Какая фаза на очереди у следующего попутчика. */
  private phaseCursor = 0

  constructor(private readonly everyNth: number = ALONG_THE_WAY_EVERY_NTH_ORDER) {}

  /** Новый прогон эмулятора — снова начинаем с первой фазы. */
  reset() {
    this.ordersSinceAlongTheWay = 0
    this.phaseCursor = 0
  }

  /** Фаза, в которой должен появиться следующий попутчик. */
  get wantedPhase(): TDriverTripPhase {
    return ALONG_THE_WAY_PHASE_SEQUENCE[this.phaseCursor % ALONG_THE_WAY_PHASE_SEQUENCE.length]
  }

  /**
   * Подошла ли очередь попутчика. Это только «пора» — попадёт ли он в маршрут,
   * решает фаза водителя: пока она не совпала, очередь остаётся взведённой, а
   * эмулятор продолжает выдавать обычные заказы (иначе генерация замирала бы,
   * пока водитель не окажется в нужном состоянии).
   */
  isDue(): boolean {
    return this.ordersSinceAlongTheWay >= this.everyNth - 1
  }

  /** Учёт созданного заказа: попутчик обнуляет очередь и переводит фазу. */
  register(alongTheWay: boolean) {
    if (alongTheWay) {
      this.ordersSinceAlongTheWay = 0
      this.phaseCursor += 1
      return
    }

    this.ordersSinceAlongTheWay += 1
  }
}
