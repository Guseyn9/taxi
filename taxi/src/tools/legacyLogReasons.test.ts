import fs from 'fs'
import path from 'path'
import { DECISION_CHECK_KEYS } from './orderDecisionMatrix'
import {
  LEGACY_LOG_REASONS,
  LEGACY_REASON_IGNORED,
  LEGACY_REASON_SOURCE_FILES,
  getLegacyInterpretationManifest,
  isLegacyReasonModelFullyCovered,
} from './legacyLogReasons'

const PROJECT_ROOT = path.resolve(__dirname, '../..')

function readSource(relativePath: string) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8')
}

/**
 * Все строковые причины, которые водительская цепочка пишет в журналы сегодня.
 * Ловим оба способа: поле записи (`reason:`, `distanceFilterReason:`) и функцию,
 * возвращающую готовый код причины.
 */
function collectReasonsFromSources() {
  const found = new Set<string>()

  LEGACY_REASON_SOURCE_FILES.forEach(file => {
    const source = readSource(file)
    for (const match of source.matchAll(/\b\w*[Rr]eason: '([a-z0-9_]+)'/g))
      found.add(match[1])
    for (const match of source.matchAll(/\breturn '([a-z0-9]+_[a-z0-9_]+)'/g))
      found.add(match[1])
  })

  return found
}

/** Причина всё ещё встречается в исходниках — хоть литералом, хоть в тернарнике. */
function isReasonPresentInSources(reason: string) {
  return LEGACY_REASON_SOURCE_FILES.some(file => readSource(file).includes(`'${reason}'`))
}

describe('реестр legacy-интерпретаций', () => {

  it('регистрирует каждую причину, которую пишет водительская цепочка', () => {
    const registered = new Set(LEGACY_LOG_REASONS.map(entry => entry.reason))
    const ignored = new Set(LEGACY_REASON_IGNORED)

    const unregistered = [...collectReasonsFromSources()]
      .filter(reason => !registered.has(reason) && !ignored.has(reason))

    // Новая вычисленная причина в коде обязана попасть в реестр вместе с
    // фактами, которые её заменяют, — иначе её потом нельзя будет снять.
    expect(unregistered).toEqual([])
  })

  it('не держит в реестре причин, которых в коде уже нет', () => {
    const stale = LEGACY_LOG_REASONS
      .map(entry => entry.reason)
      .filter(reason => !isReasonPresentInSources(reason))

    // Убрали причину из кода — уберите и из реестра: иначе манифест в выгрузке
    // будет обещать анализатору поля, которых там нет.
    expect(stale).toEqual([])
  })

  it('у каждой причины назван факт, который её заменяет', () => {
    const uncovered = LEGACY_LOG_REASONS
      .filter(entry => entry.replacedBy.length === 0)
      .map(entry => entry.reason)

    expect(uncovered).toEqual([])
    expect(isLegacyReasonModelFullyCovered()).toBe(true)
  })

  it('ссылается только на существующие ключи матрицы', () => {
    const knownKeys = new Set<string>(DECISION_CHECK_KEYS)
    const brokenReferences = LEGACY_LOG_REASONS.flatMap(entry =>
      entry.replacedBy
        .filter(item => item.kind === 'check')
        .map(item => (item as { key: string }).key)
        .filter(key => !knownKeys.has(key))
        .map(key => `${entry.reason} -> ${key}`))

    expect(brokenReferences).toEqual([])
  })

  it('не содержит дублей', () => {
    const reasons = LEGACY_LOG_REASONS.map(entry => entry.reason)
    expect(reasons).toHaveLength(new Set(reasons).size)
  })

})

describe('манифест для экспорта', () => {

  it('называет legacy-поля, которым анализатор верить не должен', () => {
    const manifest = getLegacyInterpretationManifest()

    expect(manifest.legacyFields).toContain('reason')
    expect(manifest.legacyFields).toContain('distanceFilterReason')
    expect(manifest.reasons).toHaveLength(LEGACY_LOG_REASONS.length)
    expect(manifest.reasons.every(item => item.covered)).toBe(true)
  })

  it('отдельно перечисляет непокрытые причины — их удалять рано', () => {
    expect(getLegacyInterpretationManifest().uncovered).toEqual([])
  })

})

describe('факты рядом с интерпретациями', () => {

  it('фильтр расстояния пишет измеренное значение и порог', () => {
    const source = readSource('src/state/orders/sagas.ts')

    expect(source).toContain('pickupDistanceKm')
    expect(source).toContain('pickupDistanceLimitKm')
    expect(source).toContain('driverHasActiveTripInOrder')
  })

  it('решение по геолокации заказа пишет наблюдения значениями', () => {
    const source = readSource('src/state/orders/sagas.ts')

    expect(source).toContain('serverReturnedCurrentDriver')
    expect(source).toContain('hasDriverGeoposition')
    expect(source).toContain('hasOrderStartCoordinates')
  })

  it('появление и уход водителя из заказа описаны значениями', () => {
    const source = readSource('src/state/orders/sagas.ts')

    expect(source).toContain('driverInPreviousResponse')
    expect(source).toContain('driverInCurrentResponse')
  })

})
