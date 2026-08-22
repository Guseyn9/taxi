import {
  COMMAND_COMPLETION_STATUSES,
  SnapshotDriverCommandCompletionWaiter,
} from '../DriverCommandCompletionWaiter'

function createRuntime() {
  const listeners = []
  let snapshot = null
  return {
    getSnapshot: () => snapshot,
    subscribeRuntime: listener => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    setSnapshot: nextSnapshot => {
      snapshot = nextSnapshot
      listeners.slice().forEach(listener => listener({ snapshot }))
    },
    listenerCount: () => listeners.length,
  }
}

function driverSnapshot(state) {
  return {
    state: {
      domainDriver: {
        snapshot: {
          driver: {
            activeOrders: [{ orderId: 42, state }],
          },
        },
      },
    },
  }
}

function request(waiter, instanceId = 100) {
  return {
    actionType: 'driver.order.start',
    orderId: '42',
    instanceId,
    baseline: waiter.captureBaseline('42'),
  }
}

describe('SnapshotDriverCommandCompletionWaiter', () => {
  it('completes from a new target Snapshot and cleans its subscription', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot(driverSnapshot('order_driver_arrived'))
    const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 0)

    const completion = waiter.wait(request(waiter))
    expect(runtime.listenerCount()).toBe(1)

    runtime.setSnapshot(driverSnapshot('order_in_ride'))

    await expect(completion).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Completed,
      instanceId: 100,
    })
    expect(runtime.listenerCount()).toBe(0)
  })

  it('reuses one pending completion path for the same instanceId', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot(driverSnapshot('order_driver_arrived'))
    const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 0)
    const completionRequest = request(waiter, 101)

    const first = waiter.wait(completionRequest)
    const duplicate = waiter.wait(completionRequest)

    expect(duplicate).toBe(first)
    expect(runtime.listenerCount()).toBe(1)

    runtime.setSnapshot(driverSnapshot('order_in_ride'))
    await expect(duplicate).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Completed,
      instanceId: 101,
    })
  })

  it('returns TIMEOUT and cleans the waiter when no transition is observed', async() => {
    jest.useFakeTimers()
    try {
      const runtime = createRuntime()
      runtime.setSnapshot(driverSnapshot('order_driver_arrived'))
      const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 50)
      const completion = waiter.wait(request(waiter, 102))

      jest.advanceTimersByTime(50)

      await expect(completion).resolves.toEqual(expect.objectContaining({
        status: COMMAND_COMPLETION_STATUSES.Timeout,
        instanceId: 102,
        errorCode: 'FSM_COMMAND_COMPLETION_TIMEOUT',
      }))
      expect(runtime.listenerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns FAILED when the completion source reports a terminal error', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot(driverSnapshot('order_driver_arrived'))
    const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 0)
    const completion = waiter.wait(request(waiter, 103))

    waiter.fail(103, 'INVALID_TRANSITION', 'Transition is not allowed')

    await expect(completion).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Failed,
      instanceId: 103,
      errorCode: 'INVALID_TRANSITION',
      message: 'Transition is not allowed',
    })
    expect(runtime.listenerCount()).toBe(0)
  })

  it('does not complete from a target state captured before the command', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot(driverSnapshot('order_in_ride'))
    const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 0)
    let completed = false

    void waiter.wait(request(waiter, 104)).then(() => { completed = true })
    runtime.setSnapshot(driverSnapshot('order_in_ride'))
    await Promise.resolve()

    expect(completed).toBe(false)
    waiter.cancelAll()
    expect(runtime.listenerCount()).toBe(0)
  })
})
