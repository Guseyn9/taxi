import {
  DomainApiSnapshotProvider,
  SwitchableSnapshotProvider,
} from '../SnapshotProvider'
import { createPlatformSnapshot } from '../snapshot'

describe('DomainApiSnapshotProvider', () => {
  it('normalizes loaded Domain FSM data into a read-only PI snapshot', async() => {
    const transport = {
      loadSnapshot: jest.fn().mockResolvedValue({
        revision: 7,
        state: { orderState: 'order_vote_waiting_candidates' },
        availableActions: ['order_select_candidate', 'order_cancel_by_client'],
        updatedAt: '2026-08-08T12:00:00.000Z',
      }),
    }
    const provider = new DomainApiSnapshotProvider(transport)

    const snapshot = await provider.load()

    expect(snapshot).toEqual({
      revision: 7,
      state: { orderState: 'order_vote_waiting_candidates' },
      availableActions: ['order_select_candidate', 'order_cancel_by_client'],
      updatedAt: '2026-08-08T12:00:00.000Z',
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.state)).toBe(true)
    expect(Object.isFrozen(snapshot.availableActions)).toBe(true)
  })

  it('forwards realtime snapshots when transport supports subscriptions', () => {
    let publish
    const stop = jest.fn()
    const transport = {
      loadSnapshot: jest.fn(),
      subscribeSnapshots: listener => {
        publish = listener
        return stop
      },
    }
    const provider = new DomainApiSnapshotProvider(transport)
    const listener = jest.fn()

    const unsubscribe = provider.subscribe(listener)
    publish({
      revision: 8,
      state: { orderState: 'order_vote_driver_assigned' },
      availableActions: ['order_arrive'],
    })

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      revision: 8,
      availableActions: ['order_arrive'],
    }))
    unsubscribe()
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

describe('SwitchableSnapshotProvider', () => {
  it('replaces the bootstrap provider without rebuilding Runtime subscribers', async() => {
    const initialStop = jest.fn()
    const nextStop = jest.fn()
    const initial = {
      load: jest.fn().mockResolvedValue(createPlatformSnapshot({ revision: 0 })),
      subscribe: jest.fn(() => initialStop),
    }
    const nextSnapshot = createPlatformSnapshot({
      revision: 5,
      state: { orderState: 'order_driver_assigned' },
      availableActions: ['order_arrive'],
    })
    const next = {
      load: jest.fn().mockResolvedValue(nextSnapshot),
      subscribe: jest.fn(() => nextStop),
    }
    const provider = new SwitchableSnapshotProvider(initial)
    const listener = jest.fn()
    const unsubscribe = provider.subscribe(listener)

    await provider.setProvider(next)

    expect(initialStop).toHaveBeenCalledTimes(1)
    expect(next.subscribe).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(nextSnapshot)
    unsubscribe()
    expect(nextStop).toHaveBeenCalledTimes(1)
  })
})
