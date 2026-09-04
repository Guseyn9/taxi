import {
  COMMAND_COMPLETION_FAILURE_KINDS,
  CommandStatusDriverCommandCompletionWaiter,
  COMMAND_COMPLETION_STATUSES,
  SnapshotDriverCommandCompletionWaiter,
} from '../DriverCommandCompletionWaiter'
import { BackendInteractionError } from '../backendError'

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
      failureKind: COMMAND_COMPLETION_FAILURE_KINDS.Execution,
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

  it.each(['order_cancelled', 'ride_interrupted'])(
    'completes driver cancellation from %s',
    async state => {
      const runtime = createRuntime()
      runtime.setSnapshot(driverSnapshot('order_in_ride'))
      const waiter = new SnapshotDriverCommandCompletionWaiter(runtime, 0)
      const completion = waiter.wait({
        actionType: 'driver.order.cancel',
        orderId: '42',
        instanceId: 105,
        baseline: waiter.captureBaseline('42'),
      })

      runtime.setSnapshot(driverSnapshot(state))

      await expect(completion).resolves.toEqual({
        status: COMMAND_COMPLETION_STATUSES.Completed,
        instanceId: 105,
      })
    },
  )
})

describe('CommandStatusDriverCommandCompletionWaiter', () => {
  const statusRequest = (waiter, instanceId = 200) => ({
    actionType: 'driver.order.start',
    orderId: '42',
    instanceId,
    baseline: waiter.captureBaseline('42'),
  })

  it('polls PENDING/PROCESSING until the execution is COMPLETED', async() => {
    const transport = {
      getStatus: jest.fn()
        .mockResolvedValueOnce({ instanceId: 200, status: 'PENDING' })
        .mockResolvedValueOnce({ instanceId: 200, status: 'PROCESSING' })
        .mockResolvedValueOnce({ instanceId: 200, status: 'COMPLETED' }),
    }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 1000, 1)

    await expect(waiter.wait(statusRequest(waiter))).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Completed,
      instanceId: 200,
    })
    expect(transport.getStatus).toHaveBeenCalledTimes(3)
  })

  it('returns the server FAILED code and message', async() => {
    const transport = { getStatus: jest.fn().mockResolvedValue({
      instanceId: 201,
      status: 'FAILED',
      errorCode: 'INVALID_TRANSITION',
      errorMessage: 'Transition is not allowed',
    }) }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 1000, 10)

    await expect(waiter.wait(statusRequest(waiter, 201))).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Failed,
      instanceId: 201,
      errorCode: 'INVALID_TRANSITION',
      message: 'Transition is not allowed',
      failureKind: COMMAND_COMPLETION_FAILURE_KINDS.Execution,
    })
  })

  it('reuses the same waiter for a duplicate instanceId', async() => {
    const transport = { getStatus: jest.fn().mockResolvedValue({
      instanceId: 202,
      status: 'COMPLETED',
    }) }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 1000, 10)
    const command = statusRequest(waiter, 202)

    const first = waiter.wait(command)
    const duplicate = waiter.wait(command)

    expect(duplicate).toBe(first)
    await expect(duplicate).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Completed,
      instanceId: 202,
    })
    expect(transport.getStatus).toHaveBeenCalledTimes(1)
  })

  it('reports a normative unknown-instance 404 as a status lookup failure', async() => {
    const error = new BackendInteractionError(
      'FSM_COMMAND_STATUS_HTTP_404',
      'Command not found',
      { detail: 'Command not found' },
    )
    const transport = { getStatus: jest.fn().mockRejectedValue(error) }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 1000, 10)

    await expect(waiter.wait(statusRequest(waiter, 203))).resolves.toEqual(expect.objectContaining({
      status: COMMAND_COMPLETION_STATUSES.Failed,
      instanceId: 203,
      errorCode: 'FSM_COMMAND_STATUS_HTTP_404',
      failureKind: COMMAND_COMPLETION_FAILURE_KINDS.StatusLookup,
    }))
  })

  it('retries a temporary 5xx status lookup error', async() => {
    const error = new BackendInteractionError(
      'FSM_COMMAND_STATUS_HTTP_503',
      'Service unavailable',
    )
    const transport = { getStatus: jest.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ instanceId: 204, status: 'COMPLETED' }) }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 1000, 0)

    await expect(waiter.wait(statusRequest(waiter, 204))).resolves.toEqual({
      status: COMMAND_COMPLETION_STATUSES.Completed,
      instanceId: 204,
    })
    expect(transport.getStatus).toHaveBeenCalledTimes(2)
  })

  it('returns TIMEOUT when Command Status remains non-terminal', async() => {
    const transport = { getStatus: jest.fn().mockResolvedValue({
      instanceId: 205,
      status: 'PENDING',
    }) }
    const waiter = new CommandStatusDriverCommandCompletionWaiter(transport, 15, 1)

    await expect(waiter.wait(statusRequest(waiter, 205))).resolves.toEqual(expect.objectContaining({
      status: COMMAND_COMPLETION_STATUSES.Timeout,
      instanceId: 205,
      errorCode: 'FSM_COMMAND_COMPLETION_TIMEOUT',
    }))
    expect(transport.getStatus.mock.calls.length).toBeGreaterThan(1)
  })
})
