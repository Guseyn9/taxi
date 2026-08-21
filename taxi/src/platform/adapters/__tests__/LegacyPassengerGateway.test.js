import * as API from '../../../API'
import {
  LegacyPassengerGateway,
  PASSENGER_EVENTS,
} from '../LegacyPassengerGateway'

jest.mock('../../../API', () => ({
  geocode: jest.fn(),
  reverseGeocode: jest.fn(),
  getOrder: jest.fn(),
  getUser: jest.fn(),
  getUsers: jest.fn(),
  getCar: jest.fn(),
  getCars: jest.fn(),
  postDrive: jest.fn().mockResolvedValue({ b_id: '42' }),
  cancelDrive: jest.fn().mockResolvedValue({ status: 'ok' }),
  chooseCandidate: jest.fn(),
  releaseCandidateChoice: jest.fn(),
  setWaitingTime: jest.fn(),
  updateOrderCustomerPrice: jest.fn(),
  setOrderState: jest.fn(),
}))

jest.mock('../../platform-interface', () => ({
  PASSENGER_ACTIONS: {
    CreateOrder: 'order_create',
    CancelOrder: 'order_cancel_by_client',
    SelectCandidate: 'order_select_candidate',
    ReleaseCandidate: 'order_release_candidate',
    UpdateWaitingTime: 'order_update_waiting_time',
    UpdateCustomerPrice: 'order_update_customer_price',
    CompleteRide: 'order_complete_ride',
  },
  platformInterface: { runtime: {} },
}))

function createRuntime() {
  const handlers = []
  const listeners = []
  return {
    actions: [],
    refreshCount: 0,
    registerHandler: handler => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
    subscribe: listener => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    publish: event => listeners.slice().forEach(listener => listener(event)),
    dispatch: async function(action) {
      this.actions.push(action)
      for (const handler of handlers.slice())
        await handler(action)
      this.refreshCount += 1
    },
  }
}

describe('LegacyPassengerGateway', () => {
  beforeEach(() => jest.clearAllMocks())

  it('routes a Passenger command through PI and returns the legacy result', async() => {
    const runtime = createRuntime()
    const gateway = new LegacyPassengerGateway(runtime)
    const listener = jest.fn()
    runtime.subscribe(listener)

    await expect(gateway.createOrder({ b_start_address: 'A' }))
      .resolves.toEqual({ b_id: '42' })

    expect(runtime.actions[0]).toEqual(expect.objectContaining({
      type: 'order_create',
      payload: { args: [{ b_start_address: 'A' }] },
    }))
    expect(API.postDrive).toHaveBeenCalledWith({ b_start_address: 'A' })
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: PASSENGER_EVENTS.CommandCompleted,
      payload: {
        actionType: 'order_create',
        result: { b_id: '42' },
      },
    }))
    expect(runtime.refreshCount).toBe(1)
  })

  it('normalizes a failed command and publishes a correlated failure', async() => {
    API.cancelDrive.mockRejectedValueOnce(new Error('backend unavailable'))
    const runtime = createRuntime()
    const gateway = new LegacyPassengerGateway(runtime)
    const listener = jest.fn()
    runtime.subscribe(listener)

    await expect(gateway.cancelOrder('42')).rejects.toEqual(expect.objectContaining({
      message: 'backend unavailable',
    }))

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: PASSENGER_EVENTS.CommandFailed,
      payload: expect.objectContaining({
        actionType: 'order_cancel_by_client',
        message: 'backend unavailable',
      }),
    }))
  })

  it('maps complete ride to the legacy finished state', async() => {
    const runtime = createRuntime()
    const gateway = new LegacyPassengerGateway(runtime)

    await gateway.completeRide('42')

    expect(API.setOrderState).toHaveBeenCalledWith('42', 6)
  })
})
