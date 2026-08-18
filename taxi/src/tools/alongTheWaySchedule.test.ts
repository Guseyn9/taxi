import { AlongTheWaySchedule } from './alongTheWaySchedule'
import { TDriverTripPhase } from './driverTripPhase'

/**
 * Прогон генерации: на каждом шаге эмулятор спрашивает «пора ли попутчик»,
 * сверяет нужную фазу с фазой водителя и создаёт тот или иной заказ.
 * Возвращает фазы созданных попутчиков в порядке появления.
 */
function run(schedule: AlongTheWaySchedule, driverPhases: Array<TDriverTripPhase | null>) {
  const created: Array<TDriverTripPhase> = []

  driverPhases.forEach(driverPhase => {
    const alongTheWay = schedule.isDue() && schedule.wantedPhase === driverPhase
    if (alongTheWay)
      created.push(schedule.wantedPhase)

    schedule.register(alongTheWay)
  })

  return created
}

describe('AlongTheWaySchedule', () => {

  it('попутчиком становится каждый второй заказ', () => {
    const schedule = new AlongTheWaySchedule()
    // Водитель всё время в нужной фазе, поэтому мешает только счётчик.
    const marks = [0, 1, 2, 3, 4, 5].map(() => {
      const due = schedule.isDue()
      schedule.register(due)
      return due
    })

    expect(marks).toEqual([false, true, false, true, false, true])
  })

  it('фазы чередуются по мере появления попутчиков', () => {
    const schedule = new AlongTheWaySchedule()
    // Водитель постоянно переключается между фазами — берём ту, что на очереди.
    const created = run(schedule, [
      null,
      'to-dropoff', 'to-pickup', // первый попутчик ждёт «до посадки»
      'to-pickup', 'to-dropoff', // второй — «после посадки»
      'to-dropoff', 'to-pickup',
      'to-pickup', 'to-dropoff',
    ])

    expect(created).toEqual(['to-pickup', 'to-dropoff', 'to-pickup', 'to-dropoff'])
  })

  it('пока фаза не совпала, очередь остаётся взведённой и заказы идут обычные', () => {
    const schedule = new AlongTheWaySchedule()
    schedule.register(false)

    expect(schedule.isDue()).toBe(true)
    expect(run(schedule, ['to-dropoff', 'to-dropoff', null])).toEqual([])
    // Ожидание не сбрасывает очередь — попутчик появится, как только фаза совпадёт.
    expect(schedule.isDue()).toBe(true)
    expect(schedule.wantedPhase).toBe('to-pickup')
    expect(run(schedule, ['to-pickup'])).toEqual(['to-pickup'])
  })

  it('вне поездки попутчик не создаётся', () => {
    const schedule = new AlongTheWaySchedule()

    expect(run(schedule, [null, null, null, null])).toEqual([])
  })

  it('reset возвращает расписание к первой фазе', () => {
    const schedule = new AlongTheWaySchedule()
    run(schedule, ['to-pickup', 'to-pickup', 'to-dropoff', 'to-dropoff'])
    expect(schedule.wantedPhase).toBe('to-pickup')

    schedule.register(false)
    schedule.register(true)
    expect(schedule.wantedPhase).toBe('to-dropoff')

    schedule.reset()
    expect(schedule.wantedPhase).toBe('to-pickup')
    expect(schedule.isDue()).toBe(false)
  })

  it('шаг настраивается: каждый третий заказ', () => {
    const schedule = new AlongTheWaySchedule(3)
    const marks = [0, 1, 2, 3, 4, 5].map(() => {
      const due = schedule.isDue()
      schedule.register(due)
      return due
    })

    expect(marks).toEqual([false, false, true, false, false, true])
  })

})
