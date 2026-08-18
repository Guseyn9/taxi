import { clearDecisionLog, getDecisionLogSnapshot } from './decisionLog'
import {
  recordOrderInteraction,
  recordOrderPresentationEnded,
  recordOrderPresented,
  resetOrderInteractionLog,
} from './orderInteractionLog'

function interactions() {
  return getDecisionLogSnapshot().entries.filter(item => item.event === 'ORDER_INTERACTION')
}

function stepsOf(orderId: string) {
  return interactions()
    .filter(item => String(item.orderId) === orderId)
    .map(item => item.interaction!.step)
}

beforeEach(() => {
  resetOrderInteractionLog()
  clearDecisionLog()
})

describe('таймлайн взаимодействия', () => {

  it('пишет шаги в порядке действий водителя', () => {
    recordOrderPresented('a', 'LIST', 'driver-1')
    recordOrderInteraction({ step: 'SELECTED', orderId: 'a', surface: 'LIST' })
    recordOrderInteraction({ step: 'OPENED', orderId: 'a', surface: 'ORDER_SCREEN' })
    recordOrderInteraction({ step: 'TAKE_REQUESTED', orderId: 'a', surface: 'API' })
    recordOrderInteraction({ step: 'TAKE_SUCCEEDED', orderId: 'a', surface: 'API' })

    expect(stepsOf('a')).toEqual([
      'PRESENTED',
      'SELECTED',
      'OPENED',
      'TAKE_REQUESTED',
      'TAKE_SUCCEEDED',
    ])
  })

  it('измеряет интервалы от показа и от предыдущего шага', () => {
    recordOrderPresented('a', 'LIST')
    recordOrderInteraction({ step: 'OPENED', orderId: 'a' })

    const opened = interactions()[1].interaction!
    expect(opened.msSincePresented).not.toBeNull()
    expect(opened.msSincePreviousStep).not.toBeNull()
    expect(opened.previousStep).toBe('PRESENTED')
  })

  it('у первого шага интервалов ещё нет', () => {
    recordOrderPresented('a', 'LIST')

    const presented = interactions()[0].interaction!
    expect(presented.msSincePresented).toBe(0)
    expect(presented.msSincePreviousStep).toBeNull()
    expect(presented.previousStep).toBeNull()
  })

  it('не считает показ на второй поверхности новым показом', () => {
    recordOrderPresented('a', 'LIST')
    recordOrderPresented('a', 'MAP')

    expect(stepsOf('a')).toEqual(['PRESENTED'])
  })

  it('заканчивает показ, только когда заказа не осталось ни на одном экране', () => {
    recordOrderPresented('a', 'LIST')
    recordOrderPresented('a', 'MAP')
    recordOrderPresentationEnded('a', 'LIST')

    expect(stepsOf('a')).toEqual(['PRESENTED'])

    recordOrderPresentationEnded('a', 'MAP')
    expect(stepsOf('a')).toEqual(['PRESENTED', 'PRESENTATION_ENDED'])
  })

  it('вместо вердикта об игнорировании перечисляет состоявшиеся шаги', () => {
    recordOrderPresented('a', 'LIST')
    recordOrderPresentationEnded('a', 'LIST')

    recordOrderPresented('b', 'LIST')
    recordOrderInteraction({ step: 'OPENED', orderId: 'b' })
    recordOrderPresentationEnded('b', 'LIST')

    const ignored = interactions().find(item =>
      item.orderId === 'a' && item.interaction!.step === 'PRESENTATION_ENDED')!
    const considered = interactions().find(item =>
      item.orderId === 'b' && item.interaction!.step === 'PRESENTATION_ENDED')!

    expect((ignored.interaction!.details as any).precedingSteps).toEqual(['PRESENTED'])
    expect((considered.interaction!.details as any).precedingSteps).toEqual(['PRESENTED', 'OPENED'])
    // Разницу между «не заинтересовался» и «посмотрел и не взял» выводит
    // анализатор — в журнале лежат только шаги.
    expect(JSON.stringify(interactions())).not.toContain('IGNORED')
  })

  it('ведёт таймлайны заказов независимо', () => {
    recordOrderPresented('a', 'LIST')
    recordOrderPresented('b', 'LIST')
    recordOrderInteraction({ step: 'OPENED', orderId: 'b' })

    expect(stepsOf('a')).toEqual(['PRESENTED'])
    expect(stepsOf('b')).toEqual(['PRESENTED', 'OPENED'])
  })

  it('не пишет шаг без заказа', () => {
    expect(recordOrderInteraction({ step: 'OPENED', orderId: null })).toBeNull()
    expect(interactions()).toHaveLength(0)
  })

  it('не заканчивает показ, которого не было', () => {
    expect(recordOrderPresentationEnded('a', 'LIST')).toBeNull()
    expect(interactions()).toHaveLength(0)
  })

})
