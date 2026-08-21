import { AppInteractionContract } from '../../map-channel/AppInteractionContract'
import { PlatformInterfaceRuntime } from '../PlatformInterfaceRuntime'
import { createPlatformSnapshot } from '../snapshot'
import { SurfaceRegistry } from '../SurfaceRegistry'

const ACTION = {
  type: 'order.cancel',
  payload: { orderId: '42' },
  metadata: {
    source: 'test',
    timestamp: '2026-08-08T12:00:00.000Z',
  },
}

const makeSnapshot = (revision, orderState, availableActions = []) =>
  createPlatformSnapshot({
    revision,
    state: { orderState },
    availableActions,
    updatedAt: `2026-08-08T12:00:0${revision}.000Z`,
  })

const createSubject = provider => {
  const logger = { log: jest.fn(), error: jest.fn() }
  const contract = new AppInteractionContract(logger)
  const registry = new SurfaceRegistry()
  const runtime = new PlatformInterfaceRuntime(contract, provider, registry, logger)
  return { contract, logger, registry, runtime }
}

describe('PlatformInterfaceRuntime', () => {
  it('loads one authoritative snapshot and exposes available actions', async() => {
    const provider = {
      load: jest.fn().mockResolvedValue(
        makeSnapshot(1, 'order_vote_waiting_candidates', ['order_select_candidate']),
      ),
    }
    const { runtime } = createSubject(provider)
    const listener = jest.fn()
    runtime.subscribeRuntime(listener)

    await runtime.start()

    expect(runtime.getState()).toEqual(expect.objectContaining({
      status: 'ready',
      error: null,
    }))
    expect(runtime.getSnapshot().state.orderState).toBe('order_vote_waiting_candidates')
    expect(runtime.isActionAvailable('order_select_candidate')).toBe(true)
    expect(runtime.isActionAvailable('order_start')).toBe(false)
    expect(listener.mock.calls.map(([state]) => state.status)).toEqual(['loading', 'ready'])
  })

  it('routes an action to Application and refreshes the snapshot afterwards', async() => {
    const provider = {
      load: jest.fn()
        .mockResolvedValueOnce(makeSnapshot(1, 'order_vote_waiting_candidates'))
        .mockResolvedValueOnce(makeSnapshot(2, 'order_vote_driver_assigned', ['order_arrive'])),
    }
    const { contract, runtime } = createSubject(provider)
    const handler = jest.fn()
    contract.registerHandler(handler)
    await runtime.start()

    await runtime.dispatch(ACTION)

    expect(handler).toHaveBeenCalledWith(ACTION)
    expect(provider.load).toHaveBeenCalledTimes(2)
    expect(runtime.getSnapshot().revision).toBe(2)
    expect(runtime.isActionAvailable('order_arrive')).toBe(true)
  })

  it('keeps the last snapshot and exposes an error when refresh fails', async() => {
    const provider = {
      load: jest.fn()
        .mockResolvedValueOnce(makeSnapshot(1, 'order_created'))
        .mockRejectedValueOnce(new Error('domain api unavailable')),
    }
    const { logger, runtime } = createSubject(provider)
    await runtime.start()

    await runtime.refresh()

    expect(runtime.getState().status).toBe('error')
    expect(runtime.getState().error.message).toBe('domain api unavailable')
    expect(runtime.getSnapshot().revision).toBe(1)
    expect(logger.error).toHaveBeenCalledWith(
      'Platform Interface snapshot refresh failed',
      expect.any(Error),
    )
  })

  it('projects the PI snapshot through the unchanged Interaction Contract', async() => {
    const provider = {
      load: jest.fn().mockResolvedValue(
        makeSnapshot(3, 'order_driver_arrived', ['order_start']),
      ),
    }
    const { runtime } = createSubject(provider)

    await expect(runtime.snapshot()).resolves.toEqual({
      revision: 3,
      state: {
        orderState: 'order_driver_arrived',
        availableActions: ['order_start'],
      },
    })
  })

  it('owns Surface lifecycle and stops after the final unmount', async() => {
    const providerStop = jest.fn()
    const provider = {
      load: jest.fn().mockResolvedValue(makeSnapshot(1, 'order_created')),
      subscribe: jest.fn(() => providerStop),
    }
    const { registry, runtime } = createSubject(provider)
    const surfaceUnmount = jest.fn()
    const surface = {
      id: 'driver.map',
      kind: 'map',
      isMounted: jest.fn(() => true),
      mount: jest.fn(() => surfaceUnmount),
    }
    registry.register(surface)

    const unmountFirst = runtime.mountSurface('driver.map')
    const unmountSecond = runtime.mountSurface('driver.map')
    await Promise.resolve()

    expect(surface.mount).toHaveBeenCalledTimes(2)
    expect(provider.subscribe).toHaveBeenCalledTimes(1)
    unmountFirst()
    expect(runtime.getState().status).not.toBe('stopped')
    unmountSecond()

    expect(surfaceUnmount).toHaveBeenCalledTimes(2)
    expect(providerStop).toHaveBeenCalledTimes(1)
    expect(runtime.getState().status).toBe('stopped')
  })

  it('accepts pushed snapshots only while Runtime is started', async() => {
    let publish
    const provider = {
      load: jest.fn().mockResolvedValue(makeSnapshot(1, 'order_created')),
      subscribe: listener => {
        publish = listener
        return jest.fn()
      },
    }
    const { runtime } = createSubject(provider)
    await runtime.start()

    publish(makeSnapshot(2, 'order_vote_waiting_candidates'))
    expect(runtime.getSnapshot().revision).toBe(2)

    runtime.stop()
    publish(makeSnapshot(3, 'order_vote_driver_assigned'))
    expect(runtime.getSnapshot().revision).toBe(2)
  })

  it('does not overwrite a realtime snapshot with an older pending load', async() => {
    let resolveLoad
    let publish
    const provider = {
      load: jest.fn(() => new Promise(resolve => {
        resolveLoad = resolve
      })),
      subscribe: listener => {
        publish = listener
        return jest.fn()
      },
    }
    const { runtime } = createSubject(provider)
    const started = runtime.start()

    publish(makeSnapshot(2, 'order_vote_driver_assigned'))
    resolveLoad(makeSnapshot(1, 'order_vote_waiting_candidates'))
    await started

    expect(runtime.getSnapshot().revision).toBe(2)
    expect(runtime.getSnapshot().state.orderState).toBe('order_vote_driver_assigned')
  })

  it('keeps only the newest result across 100 concurrent refreshes', async() => {
    const resolvers = []
    const provider = {
      load: jest.fn(() => new Promise(resolve => resolvers.push(resolve))),
    }
    const { runtime } = createSubject(provider)

    const requests = Array.from({ length: 100 }, () => runtime.refresh())
    resolvers[99](makeSnapshot(100, 'order_completed'))
    for (let index = 98; index >= 0; index -= 1)
      resolvers[index](makeSnapshot(index + 1, 'order_created'))
    await Promise.all(requests)

    expect(runtime.getSnapshot().revision).toBe(100)
    expect(runtime.getSnapshot().state.orderState).toBe('order_completed')
  })
})
