import { createPlatformInterfaceComposition } from '../compositionRoot'
import { createPlatformSnapshot } from '../snapshot'

describe('Platform Interface integration', () => {
  it('runs Snapshot, Passenger, Map and Navigation through one composition', async() => {
    const snapshot = createPlatformSnapshot({
      revision: 11,
      state: { orderState: 'order_vote_waiting_candidates' },
      availableActions: ['order_select_candidate', 'order_cancel_by_client'],
    })
    const provider = { load: jest.fn().mockResolvedValue(snapshot) }
    const logger = { log: jest.fn(), error: jest.fn() }
    const composition = createPlatformInterfaceComposition({
      snapshotProvider: provider,
      logger,
    })
    const setOrderCardModal = jest.fn()
    composition.mapSurface.setBindings({ mockEnabled: false, setOrderCardModal })
    const unmountMap = composition.runtime.mountSurface(composition.mapSurface.id)
    const unmountPassenger = composition.runtime.mountSurface(composition.passengerSurface.id)
    await composition.runtime.start()

    const passenger = composition.passengerSurface.resolve({ selectedOrder: null })
    composition.mapChannel.selectOrder('42')
    await Promise.resolve()
    await Promise.resolve()

    expect(passenger.uiConfig.state).toBe('DRAFT')
    expect(passenger.availableActions).toEqual([
      'order_select_candidate',
      'order_cancel_by_client',
    ])
    expect(setOrderCardModal).toHaveBeenCalledWith({ isOpen: true, orderId: '42' })

    const navigationAdapter = { navigate: jest.fn(), go: jest.fn() }
    composition.navigationRuntime.attach(navigationAdapter)
    composition.navigationRuntime.navigate('passenger.order')
    expect(navigationAdapter.navigate).toHaveBeenCalledWith(
      '/passenger-order',
      { replace: undefined },
    )

    unmountPassenger()
    unmountMap()
    expect(composition.runtime.getState().status).toBe('stopped')
  })
})
