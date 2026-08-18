/**
 * Реестр legacy-интерпретаций в существующих журналах.
 *
 * Спецификация: `taxi/DECISION_LOG_SPEC_RU.md`, §9 и §16.
 *
 * До Decision Log журналы отвечали на вопрос «почему» готовой строкой:
 * `reason: 'outside_visible_radius'`. Это вывод, а не факт: правило изменится —
 * и старая запись начнёт врать, потому что фактов, по которым её можно
 * перепроверить, в ней нет.
 *
 * Удалить такие поля сразу нельзя: по ним сейчас разбирают уже собранные логи, и
 * должна остаться возможность сверить старую модель с новой. Поэтому строки
 * остаются как есть (переименование сломало бы сравнение), но каждая обязана
 * быть здесь зарегистрирована и указывать, какими фактами она теперь покрыта.
 *
 * Реестр — не документация, а инструмент: пока у причины нет замены, удалять её
 * нельзя; когда замены есть у всех — legacy-поля можно снимать. Тест
 * `legacyLogReasons.test.ts` сверяет реестр с исходниками водительской цепочки,
 * поэтому новая интерпретация не появится в коде незамеченной.
 */

import { TDecisionCheckKey } from './orderDecisionMatrix'

/** Чем именно факт заменён: ключ матрицы решений или событие журнала. */
export type TLegacyReplacement =
  | { kind: 'check', key: TDecisionCheckKey }
  | { kind: 'event', event: string }
  | { kind: 'field', field: string }

export interface ILegacyReasonEntry {
  /** Строка, которая пишется в журнал сегодня. */
  reason: string
  /** Где она пишется. */
  source: string
  /** Что она утверждает. */
  meaning: string
  /**
   * Факты, по которым тот же вывод теперь строится заново. Пустой список
   * означает, что причина ещё не покрыта и удалять её рано.
   */
  replacedBy: TLegacyReplacement[]
}

const check = (key: TDecisionCheckKey): TLegacyReplacement => ({ kind: 'check', key })
const event = (name: string): TLegacyReplacement => ({ kind: 'event', event: name })
const field = (name: string): TLegacyReplacement => ({ kind: 'field', field: name })

/**
 * Водительская цепочка видимости заказов — область этапов 3–6. Пассажирская
 * сторона (голосование, выбор водителя) в реестр пока не входит: её решения
 * Decision Log не снимает, и заменять там нечего.
 */
export const LEGACY_LOG_REASONS: ILegacyReasonEntry[] = [
  {
    reason: 'distance_unavailable',
    source: 'state/orders/sagas.ts: getDistanceFilterDecision',
    meaning: 'расстояние до подачи посчитать не удалось',
    replacedBy: [check('pickupDistance')],
  },
  {
    reason: 'inside_visible_radius',
    source: 'state/orders/sagas.ts: getDistanceFilterDecision',
    meaning: 'заказ ближе порога видимости',
    replacedBy: [check('pickupDistance')],
  },
  {
    reason: 'outside_visible_radius',
    source: 'state/orders/sagas.ts: getDistanceFilterDecision',
    meaning: 'заказ дальше порога видимости',
    replacedBy: [check('pickupDistance')],
  },
  {
    reason: 'active_trip_kept_even_if_far',
    source: 'state/orders/sagas.ts: getDistanceFilterDecision',
    meaning: 'далёкий заказ оставлен видимым, потому что водитель его выполняет',
    replacedBy: [check('pickupDistance'), check('activeTrip')],
  },
  {
    reason: 'server_returned_current_driver_in_order',
    source: 'state/orders/sagas.ts: getOrderLocationDecisionReason',
    meaning: 'бэкенд вернул текущего водителя внутри заказа',
    replacedBy: [check('driverParticipation')],
  },
  {
    reason: 'driver_geolocation_missing',
    source: 'state/orders/sagas.ts: getOrderLocationDecisionReason',
    meaning: 'геопозиции водителя нет',
    replacedBy: [check('pickupDistance'), event('DRIVER_LOCATION')],
  },
  {
    reason: 'order_start_coordinates_missing',
    source: 'state/orders/sagas.ts: getOrderLocationDecisionReason',
    meaning: 'у заказа нет координат точки подачи',
    replacedBy: [check('pickupDistance'), field('orderSnapshot.startPoint')],
  },
  {
    reason: 'server_returned_active_order_nearby_or_by_backend_filter',
    source: 'state/orders/sagas.ts: getOrderLocationDecisionReason',
    meaning: 'заказ пришёл с бэкенда без объяснимой клиентом причины',
    replacedBy: [check('pickupDistance'), field('stage:API_RESPONSE')],
  },
  {
    reason: 'emulator_not_running',
    source: 'state/orders/sagas.ts: getActiveOrdersSaga',
    meaning: 'водителю показан пустой список, потому что эмулятор не запущен',
    replacedBy: [check('emulatorGate')],
  },
  {
    reason: 'poll_diff_applied',
    source: 'state/orders/sagas.ts: writeActiveOrderDiffFlowEvents',
    meaning: 'состояние изменилось между двумя ответами поллинга',
    replacedBy: [event('ORDER_DECISION_CHANGED'), field('fingerprint')],
  },
  {
    reason: 'server_returned_driver_in_order',
    source: 'state/orders/sagas.ts: writeActiveOrderDiffFlowEvents',
    meaning: 'водитель появился в списке водителей заказа',
    replacedBy: [check('driverParticipation'), check('votingPosition')],
  },
  {
    reason: 'server_removed_driver_from_order',
    source: 'state/orders/sagas.ts: writeActiveOrderDiffFlowEvents',
    meaning: 'водитель пропал из списка водителей заказа',
    replacedBy: [check('driverParticipation'), check('votingPosition')],
  },
  {
    reason: 'first_visible_in_driver_order_list',
    source: 'pages/Driver/Orders.tsx',
    meaning: 'снимок сделан, потому что карточка впервые появилась в списке',
    replacedBy: [event('ORDER_DECISION_INITIAL'), event('ORDER_INTERACTION')],
  },
  {
    reason: 'not_in_visible_driver_order_list',
    source: 'pages/Driver/Orders.tsx',
    meaning: 'карточки больше нет в списке',
    replacedBy: [event('ORDER_DECISION_FINAL'), event('ORDER_INTERACTION')],
  },
  {
    reason: 'first_marker_visible_on_driver_map',
    source: 'pages/Driver/Map.tsx',
    meaning: 'снимок сделан, потому что булавка впервые появилась на карте',
    replacedBy: [event('ORDER_DECISION_INITIAL'), event('ORDER_INTERACTION')],
  },
  {
    reason: 'not_in_visible_driver_map_markers',
    source: 'pages/Driver/Map.tsx',
    meaning: 'булавки больше нет на карте',
    replacedBy: [event('ORDER_DECISION_FINAL'), event('ORDER_INTERACTION')],
  },
  {
    reason: 'visible_for_driver_ui',
    source: 'state/orders/sagas.ts: ACTIVE_ORDER_FILTER_DECISION',
    meaning: 'селектор отдал заказ водительскому UI',
    replacedBy: [field('decision:VISIBLE')],
  },
  {
    reason: 'hidden_by_selector_or_filter',
    source: 'state/orders/sagas.ts: ACTIVE_ORDER_FILTER_DECISION',
    meaning: 'селектор заказ не отдал',
    replacedBy: [field('decision:HIDDEN')],
  },
]

/** Файлы водительской цепочки, за которыми следит тест реестра. */
export const LEGACY_REASON_SOURCE_FILES = [
  'src/state/orders/sagas.ts',
  'src/pages/Driver/Orders.tsx',
  'src/pages/Driver/Map.tsx',
]

/**
 * Причины, которые пишутся в этих файлах, но к видимости заказов отношения не
 * имеют. Держим списком, чтобы тест не заставлял регистрировать чужое.
 */
export const LEGACY_REASON_IGNORED = [
  // Построение маршрута на карте, не решение о видимости заказа.
  'no_current_route_target_or_start',
]

/**
 * Манифест для экспорта: какие поля в выгруженных журналах являются выводами и
 * чем они заменены. Анализатор по нему понимает, чему в файле верить.
 */
export function getLegacyInterpretationManifest() {
  return {
    note: 'Поля ниже — вычисленные причины из старой модели. Это выводы, а не факты. ' +
      'Анализ строится по decisionMatrix; эти строки оставлены только для сверки моделей.',
    legacyFields: ['reason', 'distanceFilterReason', 'distanceFilterWouldHide'],
    reasons: LEGACY_LOG_REASONS.map(entry => ({
      reason: entry.reason,
      source: entry.source,
      meaning: entry.meaning,
      replacedBy: entry.replacedBy,
      covered: entry.replacedBy.length > 0,
    })),
    uncovered: LEGACY_LOG_REASONS
      .filter(entry => entry.replacedBy.length === 0)
      .map(entry => entry.reason),
  }
}

/** Все ли старые причины покрыты фактами. Пока `false` — удалять `reason` рано. */
export function isLegacyReasonModelFullyCovered() {
  return LEGACY_LOG_REASONS.every(entry => entry.replacedBy.length > 0)
}
