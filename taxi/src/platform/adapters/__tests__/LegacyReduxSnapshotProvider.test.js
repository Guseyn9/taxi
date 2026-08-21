import { LegacyReduxSnapshotProvider } from '../LegacyReduxSnapshotProvider'

jest.mock('../../../state/orders', () => ({
  ordersSelectors: {
    activeOrders: state => state.activeOrders,
    readyOrders: state => state.readyOrders,
    historyOrders: state => state.historyOrders,
  },
}))

jest.mock('../../../state/user', () => ({
  userSelectors: {
    user: state => state.user,
  },
}))

jest.mock('../../../state/clientOrder', () => ({
  clientOrderSelectors: {
    selectedOrder: state => state.selectedOrder,
  },
}))

jest.mock('../../platform-interface/surfaces/passenger', () => ({
  PASSENGER_ACTIONS: {
    CreateOrder: 'order_create',
    CancelOrder: 'order_cancel_by_client',
    SelectCandidate: 'order_select_candidate',
    AcceptOffer: 'order_select_offer',
    OpenChat: 'order_open_chat',
    ConfirmBoarding: 'order_confirm_boarding',
    CreateIncident: 'order_create_incident',
    RateOrder: 'order_rate',
  },
  resolvePassengerUiConfig: ({ selectedOrder }) => ({
    state: selectedOrder?.uiState ?? 'DRAFT',
  }),
}))

function createStore(initialState) {
  let state = initialState
  const listeners = []
  return {
    getState: () => state,
    subscribe: listener => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    update: nextState => {
      state = nextState
      listeners.slice().forEach(listener => listener())
    },
  }
}

describe('LegacyReduxSnapshotProvider', () => {
  it('bootstraps available actions and publishes changed passenger state', async() => {
    const store = createStore({
      activeOrders: [],
      readyOrders: [],
      historyOrders: [],
      selectedOrder: null,
      user: null,
    })
    const provider = new LegacyReduxSnapshotProvider(store)
    const initial = await provider.load()

    expect(initial.availableActions).toEqual(['order_create'])
    expect(initial.state.passenger.uiState).toBe('DRAFT')

    const listener = jest.fn()
    const unsubscribe = provider.subscribe(listener)
    store.update({
      activeOrders: [{ b_id: '42', b_state: 1, drivers: [], uiState: 'SEARCHING_DRIVER' }],
      readyOrders: [{ b_id: '43' }],
      historyOrders: [{ b_id: '41' }],
      selectedOrder: '42',
      user: { u_id: '7' },
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].availableActions).toEqual(['order_cancel_by_client'])
    expect(listener.mock.calls[0][0].state.passenger.selectedOrderId).toBe('42')
    expect(listener.mock.calls[0][0].state.driver.readyOrders).toEqual([{ b_id: '43' }])

    unsubscribe()
  })

  it('does not publish when relevant state did not change', async() => {
    const state = {
      activeOrders: [],
      readyOrders: [],
      historyOrders: [],
      selectedOrder: null,
      user: null,
    }
    const store = createStore(state)
    const provider = new LegacyReduxSnapshotProvider(store)
    await provider.load()
    const listener = jest.fn()
    provider.subscribe(listener)

    store.update(state)

    expect(listener).not.toHaveBeenCalled()
  })
})
