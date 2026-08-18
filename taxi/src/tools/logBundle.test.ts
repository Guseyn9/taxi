/**
 * Выгрузка журналов: сшивка по сессии, манифест legacy-полей и видимая обрезка.
 *
 * Экспорт в браузере скачивает файл или кладёт текст в буфер обмена; в jsdom оба
 * пути недоступны, поэтому проверяем сам собранный текст — он один и тот же.
 */

import { clearDecisionLog, getDecisionLogSnapshot, writeOrderDecision } from './decisionLog'
import { clearFlowLog, getFlowLogSnapshot, writeFlowEvent } from './flowLog'
import { clearRawLog, getRawLogSnapshot, writeRawLog } from './rawLog'
import { copyAndClearAllLogs, copyAndClearDecisionLog } from './frontendLog'

function seedAllLogs() {
  writeRawLog('DRIVER_LOCATION', { source: 'test', positionSource: 'BROWSER_GPS' })
  writeFlowEvent('TRIP_STARTED', { orderId: 'order-1' })
  writeOrderDecision({
    event: 'ORDER_DECISION_INITIAL',
    stage: 'LIST_UI',
    decision: 'VISIBLE',
    orderId: 'order-1',
    driverId: 'driver-1',
    decisionMatrix: [{ key: 'requiredSeats', status: 'PASS', value: { requiredSeats: 1 }, limit: 4 }],
    fingerprint: 'fp-1',
  })
}

beforeEach(() => {
  clearDecisionLog()
  clearRawLog()
  clearFlowLog()
})

describe('общий sessionId', () => {

  it('одинаков у всех трёх журналов — иначе их не сшить', () => {
    const raw = getRawLogSnapshot()
    const flow = getFlowLogSnapshot()
    const decision = getDecisionLogSnapshot()

    expect(raw.session_id).toBeTruthy()
    expect(flow.sessionId).toBe(raw.session_id)
    expect(decision.sessionId).toBe(raw.session_id)
    expect(decision.deviceId).toBe(raw.device_id)
  })

})

describe('copyAndClearAllLogs', () => {

  it('кладёт в один файл все четыре журнала', async() => {
    seedAllLogs()
    const result = await copyAndClearAllLogs()
    const bundle = JSON.parse(result.text)

    expect(bundle.decision.entries.length).toBeGreaterThan(0)
    expect(bundle.raw.entries.length).toBeGreaterThan(0)
    expect(bundle.flow.steps.length).toBeGreaterThan(0)
    expect(bundle.interfaceLog).toBeDefined()
    expect(bundle.sessionId).toBe(bundle.raw.session_id)
  })

  it('не даёт молчаливой обрезки: объём и лимиты названы в файле', async() => {
    seedAllLogs()
    const result = await copyAndClearAllLogs()
    const bundle = JSON.parse(result.text)

    expect(bundle.volume.entryCounts.decision).toBeGreaterThan(0)
    expect(bundle.volume.totalEntries).toBeGreaterThan(0)
    expect(bundle.volume.limits).toEqual({
      rawRecords: 3000,
      flowSteps: 400,
      decisionRecords: 1500,
      interfaceEntries: 250,
    })
    // Ни один буфер не переполнен — списку вытесненных журналов быть пустым.
    expect(bundle.volume.atLimit).toEqual([])
    expect(result.byteLength).toBeGreaterThan(0)
  })

  it('предупреждает анализатор, каким полям верить нельзя', async() => {
    seedAllLogs()
    const bundle = JSON.parse((await copyAndClearAllLogs()).text)

    expect(bundle.legacyInterpretation.legacyFields).toContain('reason')
    expect(bundle.legacyInterpretation.uncovered).toEqual([])
    expect(bundle.legacyInterpretation.reasons.length).toBeGreaterThan(0)
  })

  it('называет спецификацию, по которой файл читается', async() => {
    const bundle = JSON.parse((await copyAndClearAllLogs()).text)
    expect(bundle.specification).toBe('DECISION_LOG_SPEC_RU.md')
  })

})

describe('copyAndClearDecisionLog', () => {

  it('выгружает матрицы решений вместе с манифестом legacy-полей', async() => {
    seedAllLogs()
    const result = await copyAndClearDecisionLog()
    const exported = JSON.parse(result.text)

    expect(exported.entries[0].decisionMatrix[0].key).toBe('requiredSeats')
    expect(exported.principle).toBe('facts only, no conclusions')
    expect(exported.legacyInterpretation.legacyFields).toContain('distanceFilterReason')
  })

})
