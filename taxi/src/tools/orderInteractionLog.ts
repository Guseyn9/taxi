/**
 * Таймлайн взаимодействия водителя с заказом.
 *
 * Спецификация: `taxi/DECISION_LOG_SPEC_RU.md`, §14.
 *
 * Матрица решений отвечает на вопрос «что система показала водителю». Она не
 * отвечает на вторую половину вопроса «почему водитель взял заказ А, а мимо
 * заказа Б проехал»: между показом карточки и взятием заказа проходит время, и
 * без него нельзя отличить «водитель не увидел» от «увидел и не стал брать».
 *
 * Модуль пишет только наблюдаемые шаги и измеренные интервалы между ними.
 * Никаких «водитель проигнорировал заказ» и «не заинтересовался» — при
 * исчезновении заказа записывается список фактически состоявшихся шагов, а
 * вывод делает анализатор.
 */

import {
  TOrderInteractionStep,
  TOrderInteractionSurface,
  writeOrderInteraction,
} from './decisionLog'

interface IOrderTimeline {
  presentedAt: number | null
  lastStep: TOrderInteractionStep | null
  lastStepAt: number | null
  steps: TOrderInteractionStep[]
  /** Поверхности, на которых заказ сейчас показан. */
  surfaces: Set<TOrderInteractionSurface>
}

const timelines = new Map<string, IOrderTimeline>()

/** Сколько таймлайнов держим в памяти, чтобы длинная смена не росла без границ. */
const MAX_TIMELINES = 300

function getTimeline(orderId: string | number): IOrderTimeline {
  const key = String(orderId)
  const existing = timelines.get(key)
  if (existing)
    return existing

  if (timelines.size >= MAX_TIMELINES) {
    const oldestKey = timelines.keys().next().value
    if (oldestKey !== undefined)
      timelines.delete(oldestKey)
  }

  const created: IOrderTimeline = {
    presentedAt: null,
    lastStep: null,
    lastStepAt: null,
    steps: [],
    surfaces: new Set(),
  }
  timelines.set(key, created)
  return created
}

export interface IRecordOrderInteractionInput {
  step: TOrderInteractionStep
  orderId?: string | number | null
  driverId?: string | number | null
  surface?: TOrderInteractionSurface | null
  details?: any
}

/** Записывает шаг и измеряет интервалы от показа и от предыдущего шага. */
export function recordOrderInteraction(input: IRecordOrderInteractionInput) {
  if (!input.orderId)
    return null

  const timeline = getTimeline(input.orderId)
  const now = Date.now()

  const record = writeOrderInteraction({
    orderId: input.orderId,
    driverId: input.driverId ?? null,
    interaction: {
      step: input.step,
      surface: input.surface ?? null,
      msSincePresented: timeline.presentedAt === null ? null : now - timeline.presentedAt,
      msSincePreviousStep: timeline.lastStepAt === null ? null : now - timeline.lastStepAt,
      previousStep: timeline.lastStep,
      details: input.details,
    },
  })

  timeline.lastStep = input.step
  timeline.lastStepAt = now
  timeline.steps.push(input.step)

  return record
}

/**
 * Заказ показан водителю. Повторный показ на второй поверхности (список и
 * карта одновременно) новым шагом не считается — таймлайн ведётся по заказу, а
 * не по экрану; поверхности при этом запоминаются.
 */
export function recordOrderPresented(
  orderId: string | number,
  surface: TOrderInteractionSurface,
  driverId?: string | number | null,
) {
  const timeline = getTimeline(orderId)
  const alreadyPresented = timeline.surfaces.size > 0
  timeline.surfaces.add(surface)

  if (alreadyPresented)
    return null

  timeline.presentedAt = Date.now()
  return recordOrderInteraction({
    step: 'PRESENTED',
    orderId,
    driverId,
    surface,
  })
}

/**
 * Заказ пропал с поверхности. Шаг пишется, только когда заказа не осталось ни
 * на одном экране: пока карточка видна на карте, показ не закончился.
 */
export function recordOrderPresentationEnded(
  orderId: string | number,
  surface: TOrderInteractionSurface,
  driverId?: string | number | null,
) {
  const timeline = timelines.get(String(orderId))
  if (!timeline || !timeline.surfaces.has(surface))
    return null

  timeline.surfaces.delete(surface)
  if (timeline.surfaces.size > 0)
    return null

  const record = recordOrderInteraction({
    step: 'PRESENTATION_ENDED',
    orderId,
    driverId,
    surface,
    // Перечень состоявшихся шагов вместо вердикта «водитель проигнорировал»:
    // из [PRESENTED] и [PRESENTED, OPENED, TAKE_FAILED] анализатор сделает
    // разные выводы, а лог остаётся набором фактов.
    details: { precedingSteps: timeline.steps.filter(step => step !== 'PRESENTATION_ENDED') },
  })

  timeline.presentedAt = null
  return record
}

/** Сброс — смена водителя, выход из сессии, тесты. */
export function resetOrderInteractionLog() {
  timelines.clear()
}
