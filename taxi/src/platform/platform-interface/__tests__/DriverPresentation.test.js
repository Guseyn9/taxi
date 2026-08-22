import { createPlatformSnapshot } from '../snapshot'
import { selectDriverPresentation } from '../surfaces/driver/DriverPresentation'

describe('DriverPresentation', () => {
  it('projects List and HUD data from one read-only Snapshot', () => {
    const snapshot = createPlatformSnapshot({
      revision: 3,
      state: {
        driver: {
          user: { u_id: '7' },
          activeOrders: [{ b_id: '42' }],
          readyOrders: [{ b_id: '43' }],
          historyOrders: [{ b_id: '41' }],
        },
      },
      availableActions: ['driver.order.arrive'],
    })

    const presentation = selectDriverPresentation(snapshot)

    expect(presentation.available).toBe(true)
    expect(presentation.user.u_id).toBe('7')
    expect(presentation.activeOrders).toEqual([{ b_id: '42' }])
    expect(presentation.readyOrders).toEqual([{ b_id: '43' }])
    expect(presentation.historyOrders).toEqual([{ b_id: '41' }])
    expect(presentation.availableActions).toEqual(['driver.order.arrive'])
    expect(Object.isFrozen(presentation)).toBe(true)
  })

  it('returns an explicit unavailable projection before bootstrap', () => {
    expect(selectDriverPresentation(null)).toEqual(expect.objectContaining({
      available: false,
      activeOrders: [],
      readyOrders: [],
      historyOrders: [],
    }))
  })
})
