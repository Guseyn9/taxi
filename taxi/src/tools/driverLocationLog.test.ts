import { clearRawLog, getRawLogSnapshot } from './rawLog'
import {
  recordDriverLocation,
  recordEmulatorGeoState,
  resetDriverLocationLog,
} from './driverLocationLog'

function entries() {
  return getRawLogSnapshot().entries
}

function eventsOf(event: string) {
  return entries().filter(item => item.event === event)
}

function payloadOf(record: any) {
  return record.payload as Record<string, any>
}

beforeEach(() => {
  resetDriverLocationLog()
  clearRawLog()
})

describe('recordDriverLocation', () => {

  it('пишет первую точку с указанием источника', () => {
    expect(recordDriverLocation([54.7, 20.48], 'EMULATOR_ROUTE')).toBe(true)

    const [location] = eventsOf('DRIVER_LOCATION')
    expect(payloadOf(location).positionSource).toBe('EMULATOR_ROUTE')
    expect(payloadOf(location).samplingTrigger).toBe('source_change')
  })

  it('прореживает поток: соседние точки одного источника не пишутся', () => {
    recordDriverLocation([54.7, 20.48], 'EMULATOR_ROUTE')
    const secondTick = recordDriverLocation([54.70001, 20.48001], 'EMULATOR_ROUTE')
    const thirdTick = recordDriverLocation([54.70002, 20.48002], 'EMULATOR_ROUTE')

    expect(secondTick).toBe(false)
    expect(thirdTick).toBe(false)
    expect(eventsOf('DRIVER_LOCATION')).toHaveLength(1)
  })

  it('всегда пишет заметное перемещение, чтобы скачок не потерялся', () => {
    recordDriverLocation([54.7, 20.48], 'EMULATOR_ROUTE')
    // ~2.4 км — прореживание такое перемещение пропускать не должно.
    expect(recordDriverLocation([54.7216, 20.48], 'EMULATOR_ROUTE')).toBe(true)

    const jump = payloadOf(eventsOf('DRIVER_LOCATION')[1])
    expect(jump.samplingTrigger).toBe('distance_step')
    expect(jump.distanceMeters).toBeGreaterThan(2000)
    expect(jump.deltaTimeMs).not.toBeNull()
    expect(jump.previous.latitude).toBe(54.7)
  })

  it('фиксирует смену источника отдельным событием с обеими точками', () => {
    recordDriverLocation([54.702, 20.481], 'EMULATOR_ROUTE')
    recordDriverLocation([54.714381, 20.485609], 'BROWSER_GPS')

    // [0] — появление первой точки (NONE → EMULATOR_ROUTE), [1] — смена провайдера.
    const payload = payloadOf(eventsOf('LOCATION_SOURCE_CHANGED')[1])

    expect(payload.oldSource).toBe('EMULATOR_ROUTE')
    expect(payload.newSource).toBe('BROWSER_GPS')
    expect(payload.distanceMeters).toBeGreaterThan(1000)
    expect(payload.previous.source).toBe('EMULATOR_ROUTE')
  })

  it('не называет скачок аномалией — только измеренные величины', () => {
    recordDriverLocation([54.702, 20.481], 'EMULATOR_ROUTE')
    recordDriverLocation([54.714381, 20.485609], 'BROWSER_GPS')

    const text = JSON.stringify(entries())
    expect(text).not.toContain('TELEPORT')
    expect(text).not.toContain('ANOMALY')
    // Вывод «так двигаться невозможно» делает анализатор — по этим трём числам.
    const payload = payloadOf(eventsOf('DRIVER_LOCATION')[1])
    expect(payload).toHaveProperty('distanceMeters')
    expect(payload).toHaveProperty('deltaTimeMs')
    expect(payload).toHaveProperty('calculatedSpeedKmh')
  })

  it('фиксирует потерю позиции', () => {
    recordDriverLocation([54.7, 20.48], 'EMULATOR_ROUTE')
    expect(recordDriverLocation(null, 'NONE')).toBe(true)

    const lost = payloadOf(eventsOf('DRIVER_LOCATION')[1])
    expect(lost.samplingTrigger).toBe('position_lost')
    expect(lost.latitude).toBeNull()
    // [0] — появление первой точки (NONE → EMULATOR_ROUTE), [1] — её потеря.
    expect(payloadOf(eventsOf('LOCATION_SOURCE_CHANGED')[1]).newSource).toBe('NONE')
  })

  it('называет режим прореживания в самой записи', () => {
    recordDriverLocation([54.7, 20.48], 'BROWSER_GPS')

    const payload = payloadOf(eventsOf('DRIVER_LOCATION')[0])
    expect(payload.samplingIntervalMs).toBe(5000)
    expect(payload.samplingDistanceMeters).toBe(150)
  })

})

describe('recordEmulatorGeoState', () => {

  it('пишет запуск и остановку эмуляции с последним известным источником', () => {
    recordDriverLocation([54.7, 20.48], 'EMULATOR_ROUTE')
    recordEmulatorGeoState('drivers', false)

    const [stopped] = eventsOf('EMULATOR_GEO_STOPPED')
    expect(payloadOf(stopped).mode).toBe('drivers')
    expect(payloadOf(stopped).lastKnownSource).toBe('EMULATOR_ROUTE')
  })

  it('даёт анализатору полную последовательность остановки эмулятора', () => {
    recordDriverLocation([54.702, 20.481], 'EMULATOR_ROUTE')
    recordEmulatorGeoState('drivers', false)
    recordDriverLocation([54.714381, 20.485609], 'BROWSER_GPS')

    const sequence = entries()
      .map(item => item.event)
      .filter(event => event !== 'app_started')

    expect(sequence).toEqual([
      'LOCATION_SOURCE_CHANGED',
      'DRIVER_LOCATION',
      'EMULATOR_GEO_STOPPED',
      'LOCATION_SOURCE_CHANGED',
      'DRIVER_LOCATION',
    ])
  })

})
