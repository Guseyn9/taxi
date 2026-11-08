import { backendGateway } from '../LegacyBackendGateway'
import {
  DRIVER_MAP_EVENTS,
  DriverMapGateway,
} from '../DriverMapGateway'
import {
  COMMAND_COMPLETION_FAILURE_KINDS,
  CommandStatusDriverCommandCompletionWaiter,
} from '../DriverCommandCompletionWaiter'
import { FsmCommandStatusTransport } from '../FsmCommandStatusTransport'
import { FsmTaxiCommandTransport } from '../FsmTaxiCommandTransport'

jest.mock('../LegacyBackendGateway', () => ({
  backendGateway: {
    arrivedVotingOrder: jest.fn().mockResolvedValue({ status: 'ok' }),
    cancelDrive: jest.fn().mockResolvedValue({ status: 'ok' }),
    confirmVotingCode: jest.fn().mockResolvedValue({ status: 'ok' }),
    makeRoutePoints: jest.fn(),
    reverseGeocode: jest.fn(),
    setOrderState: jest.fn().mockResolvedValue({ status: 'ok' }),
  },
}))

function createRuntime() {
  const handlers = []
  const listeners = []
  const runtimeListeners = []
  let snapshot = null
  return {
    registerHandler: handler => {
      handlers.push(handler)
      return () => handlers.splice(handlers.indexOf(handler), 1)
    },
    subscribe: listener => {
      listeners.push(listener)
      return () => listeners.splice(listeners.indexOf(listener), 1)
    },
    subscribeRuntime: listener => {
      runtimeListeners.push(listener)
      return () => runtimeListeners.splice(runtimeListeners.indexOf(listener), 1)
    },
    getSnapshot: () => snapshot,
    setSnapshot: nextSnapshot => {
      snapshot = nextSnapshot
      runtimeListeners.slice().forEach(listener => listener({ snapshot }))
    },
    publish: event => listeners.slice().forEach(listener => listener(event)),
    dispatch: async action => {
      for (const handler of handlers.slice())
        await handler(action)
    },
  }
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

it('uses only the legacy path when this individual FSM operation is disabled',async()=>{
 backendGateway.cancelDrive.mockClear()
 const transport={send:jest.fn(),supports:()=>false}
 const gateway=new DriverMapGateway(createRuntime(),transport)
 await gateway.cancel('42','fixture reason')
 expect(backendGateway.cancelDrive).toHaveBeenCalledWith('42','fixture reason')
 expect(transport.send).not.toHaveBeenCalled()
})

it('persists acceptance before notifying the UI and recovers by status lookup without another POST',async()=>{
 sessionStorage.clear()
 const owner={userId:'1420',service:'https://test.invalid',sessionId:'test-login'}
 const runtime=createRuntime(),transport={send:jest.fn().mockResolvedValue({accepted:true,duplicate:false,instanceId:912,status:'PENDING',intent:'ride_started'})}
 const waiter=new CommandStatusDriverCommandCompletionWaiter({getStatus:()=>new Promise(()=>{})},60000,100)
 const gateway=new DriverMapGateway(runtime,transport,1000,waiter,{scope:()=>owner,storage:sessionStorage})
 const unmount=gateway.mount(),events=[]
 gateway.subscribe(event=>{if(event.type===DRIVER_MAP_EVENTS.CommandAccepted)expect(JSON.parse(sessionStorage.getItem('taxi.driver.pending-commands.v1')).commands[0].instanceId).toBe(912)})
 const pending=gateway.start('42').catch(()=>{})
 await expect(gateway.start('42')).rejects.toMatchObject({code:'FSM_COMMAND_PENDING'})
 for(let i=0;i<12;i++)await Promise.resolve()
 expect(transport.send).toHaveBeenCalledTimes(1)
 unmount();waiter.cancelAll();await pending
 const restoredRuntime=createRuntime(),status=jest.fn().mockResolvedValue({instanceId:912,status:'COMPLETED'})
 const restored=new DriverMapGateway(restoredRuntime,transport,1000,new CommandStatusDriverCommandCompletionWaiter({getStatus:status},1000,100),{scope:()=>owner,storage:sessionStorage})
 restored.subscribe(event=>events.push(event));restored.setRecoveryIdentity(owner.userId)
 for(let i=0;i<12;i++)await Promise.resolve()
 expect(status).toHaveBeenCalledWith(912);expect(transport.send).toHaveBeenCalledTimes(1)
 expect(events.map(e=>e.type)).toEqual([DRIVER_MAP_EVENTS.RecoveryChecked])
 expect(sessionStorage.getItem('taxi.driver.pending-commands.v1')).toBeNull()
})
it('does not send a recoverable command without a bound login',async()=>{
 const transport={send:jest.fn()},waiter={supportsInstanceRecovery:true,captureBaseline:()=>({state:null}),wait:jest.fn(),cancelAll:jest.fn()}
 const gateway=new DriverMapGateway(createRuntime(),transport,1000,waiter,{scope:()=>null})
 await expect(gateway.start('42')).rejects.toMatchObject({code:'FSM_COMMAND_SESSION_CHANGED'})
 expect(transport.send).not.toHaveBeenCalled()
})

describe('DriverMapGateway', () => {
  beforeEach(() => jest.clearAllMocks())

  it('executes lifecycle mutations behind the contract and publishes success', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    const unmount = gateway.mount()
    gateway.subscribe(listener)

    await gateway.arrive('42', true)

    expect(backendGateway.setOrderState).toHaveBeenCalledWith('42', 4)
    expect(backendGateway.arrivedVotingOrder).toHaveBeenCalledWith('42')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Arrived,
      payload: { orderId: '42' },
    }))
    unmount()
  })

  it('normalizes backend rejection and publishes a failure event', async() => {
    backendGateway.setOrderState.mockResolvedValueOnce({
      status: 'error',
      message: 'wrong state',
    })
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await expect(gateway.start('42')).rejects.toEqual(expect.objectContaining({
      code: 'BACKEND_RESPONSE_ERROR',
      message: 'wrong state',
    }))

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Failed,
      payload: expect.objectContaining({
        actionType: 'driver.order.start',
        orderId: '42',
        code: 'BACKEND_RESPONSE_ERROR',
        message: 'wrong state',
      }),
    }))
  })

  it('confirms voting boarding and starts the order through one action', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.confirmBoarding('42', '1234')

    expect(backendGateway.confirmVotingCode).toHaveBeenCalledWith('42', '1234')
    expect(backendGateway.setOrderState).toHaveBeenCalledWith('42', 5, '1234')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.BoardingConfirmed,
      payload: { orderId: '42' },
    }))
  })

  it('routes presentation and application requests through events', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.openCard('42')
    await gateway.requestAreas([[1, 2], [3, 4]])

    expect(listener.mock.calls.map(([event]) => event.type)).toEqual([
      DRIVER_MAP_EVENTS.CardOpened,
      DRIVER_MAP_EVENTS.AreasRequested,
    ])
  })

  it('routes driver cancellation through the legacy PI boundary', async() => {
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.cancel('42', 'Vehicle issue')

    expect(backendGateway.cancelDrive).toHaveBeenCalledWith('42', 'Vehicle issue')
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Cancelled,
      payload: { orderId: '42' },
    }))
  })

  it('sends driver cancellation through Command API when it is configured', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 104,
      status: 'PENDING',
      intent: 'driver_cancel_requested',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: 'order_in_ride' }),
      wait: jest.fn().mockResolvedValue({ status: 'COMPLETED', instanceId: 104 }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(runtime, commandTransport, 60000, completionWaiter)
    gateway.mount()

    await gateway.cancel('42', 'Vehicle issue')

    expect(commandTransport.send).toHaveBeenCalledWith(
      '42',
      'driver_cancel_requested',
      { reason: 'Vehicle issue' },
      expect.objectContaining({ source: 'driver.interface' }),
    )
    expect(completionWaiter.wait).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'driver.order.cancel',
      orderId: '42',
      instanceId: 104,
    }))
    expect(backendGateway.cancelDrive).not.toHaveBeenCalled()
  })

  it('completes cancellation through POST, instance status lookup and Gateway event', async() => {
    const fetchRequest = jest.fn()
      .mockResolvedValueOnce(createResponse({
        accepted: true,
        duplicate: false,
        instanceId: 105,
        status: 'PENDING',
        intent: 'driver_cancel_requested',
      }, 202))
      .mockResolvedValueOnce(createResponse({
        instanceId: 105,
        status: 'COMPLETED',
      }))
    const commandTransport = new FsmTaxiCommandTransport({
      apiUrl: 'https://fsm.example.test',
    }, {
      fetch: fetchRequest,
      createId: () => 'cmd-cancel-105',
    })
    const statusTransport = new FsmCommandStatusTransport({
      apiUrl: 'https://fsm.example.test',
    }, { fetch: fetchRequest })
    const completionWaiter = new CommandStatusDriverCommandCompletionWaiter(statusTransport, 1000, 0)
    const runtime = createRuntime()
    const gateway = new DriverMapGateway(runtime, commandTransport, 1000, completionWaiter)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await gateway.cancel('42', 'Vehicle issue')

    expect(fetchRequest.mock.calls.map(([url]) => url)).toEqual([
      'https://fsm.example.test/api/commands/taxi/order/42',
      'https://fsm.example.test/api/commands/105',
    ])
    expect(JSON.parse(fetchRequest.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      commandId: 'cmd-cancel-105',
      intent: 'driver_cancel_requested',
      payload: { reason: 'Vehicle issue' },
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Cancelled,
      payload: { orderId: '42' },
    }))
    expect(backendGateway.cancelDrive).not.toHaveBeenCalled()
  })

  it('preserves STATUS_LOOKUP through Gateway rejection and failure event', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 106,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: null }),
      wait: jest.fn().mockResolvedValue({
        status: 'FAILED',
        instanceId: 106,
        errorCode: 'FSM_COMMAND_STATUS_HTTP_404',
        message: 'Command not found',
        failureKind: COMMAND_COMPLETION_FAILURE_KINDS.StatusLookup,
      }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(runtime, commandTransport, 1000, completionWaiter)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await expect(gateway.start('42')).rejects.toEqual(expect.objectContaining({
      code: 'FSM_COMMAND_STATUS_HTTP_404',
      details: expect.objectContaining({
        instanceId: 106,
        failureKind: COMMAND_COMPLETION_FAILURE_KINDS.StatusLookup,
      }),
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Failed,
      payload: expect.objectContaining({
        code: 'FSM_COMMAND_STATUS_HTTP_404',
        failureKind: COMMAND_COMPLETION_FAILURE_KINDS.StatusLookup,
      }),
    }))
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Started,
    }))
  })

  it('rejects waiter cancellation without publishing an action failure', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 107,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: null }),
      wait: jest.fn().mockResolvedValue({
        status: 'CANCELLED',
        instanceId: 107,
        errorCode: 'FSM_COMMAND_COMPLETION_CANCELLED',
        message: 'FSM command completion wait was cancelled',
      }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(runtime, commandTransport, 1000, completionWaiter)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    await expect(gateway.start('42')).rejects.toEqual(expect.objectContaining({
      code: 'FSM_COMMAND_COMPLETION_CANCELLED',
      details: expect.objectContaining({
        instanceId: 107,
        cancelled: true,
      }),
    }))
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.CommandAccepted,
    }))
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Failed,
    }))
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.Started,
    }))
  })

  it('publishes command accepted without claiming an asynchronous transition completed', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 100,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport)
    const listener = jest.fn()
    gateway.mount()
    gateway.subscribe(listener)

    let completed = false
    const completion = gateway.confirmBoarding('42', '1234')
      .then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(commandTransport.send).toHaveBeenCalledWith(
      '42',
      'driver.order.confirm_boarding',
      { boardingCode: '1234' },
      expect.objectContaining({
        source: 'driver.interface',
        correlationId: expect.any(String),
      }),
    )
    expect(backendGateway.confirmVotingCode).not.toHaveBeenCalled()
    expect(backendGateway.setOrderState).not.toHaveBeenCalled()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.CommandAccepted,
      payload: {
        actionType: 'driver.order.confirm_boarding',
        orderId: '42',
        instanceId: 100,
        status: 'PENDING',
        intent: 'ride_started',
        duplicate: false,
      },
    }))
    expect(listener).not.toHaveBeenCalledWith(expect.objectContaining({
      type: DRIVER_MAP_EVENTS.BoardingConfirmed,
    }))
    expect(completed).toBe(false)

    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              activeOrders: [{ orderId: 42, state: 'order_in_ride' }],
            },
          },
        },
      },
    })
    await completion
    expect(completed).toBe(true)
  })

  it('passes the accepted instanceId to the replaceable completion waiter', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 150,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const completionWaiter = {
      captureBaseline: jest.fn().mockReturnValue({ state: 'order_driver_arrived' }),
      wait: jest.fn().mockResolvedValue({ status: 'COMPLETED', instanceId: 150 }),
      fail: jest.fn(),
      cancelAll: jest.fn(),
    }
    const gateway = new DriverMapGateway(
      runtime,
      commandTransport,
      60000,
      completionWaiter,
    )
    gateway.mount()

    await gateway.start('42')

    expect(completionWaiter.captureBaseline).toHaveBeenCalledWith('42')
    expect(completionWaiter.wait).toHaveBeenCalledWith({
      actionType: 'driver.order.start',
      orderId: '42',
      instanceId: 150,
      baseline: { state: 'order_driver_arrived' },
    })
  })

  it('keeps finish pending until the completed state is visible in Snapshot', async() => {
    const runtime = createRuntime()
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 101,
      status: 'PENDING',
      intent: 'ride_finished',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport)
    gateway.mount()

    let completed = false
    const completion = gateway.finish('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              activeOrders: [{ orderId: 42, state: 'order_in_ride' }],
            },
          },
        },
      },
    })
    await Promise.resolve()
    expect(completed).toBe(false)

    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              historyOrders: [{ orderId: 42, state: 'order_completed' }],
            },
          },
        },
      },
    })
    await completion
    expect(completed).toBe(true)
  })

  it('does not complete a new command from a target state that existed before acceptance', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              activeOrders: [{ orderId: 42, state: 'order_in_ride' }],
            },
          },
        },
      },
    })
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: false,
      instanceId: 102,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport, 0)
    gateway.mount()

    let completed = false
    void gateway.start('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(completed).toBe(false)
  })

  it('does not treat an accepted duplicate as proof that its transition completed', async() => {
    const runtime = createRuntime()
    runtime.setSnapshot({
      state: {
        domainDriver: {
          snapshot: {
            driver: {
              activeOrders: [{ orderId: 42, state: 'order_in_ride' }],
            },
          },
        },
      },
    })
    const commandTransport = { send: jest.fn().mockResolvedValue({
      accepted: true,
      duplicate: true,
      instanceId: 103,
      status: 'PENDING',
      intent: 'ride_started',
    }) }
    const gateway = new DriverMapGateway(runtime, commandTransport, 0)
    gateway.mount()

    let completed = false
    void gateway.start('42').then(() => { completed = true })
    for (let index = 0; index < 4; index += 1)
      await Promise.resolve()

    expect(completed).toBe(false)
  })
})

it('bounds a lost map event even when dispatch resolves and never repeats the action', async()=>{
 jest.useFakeTimers()
 try{
  const runtime=createRuntime();runtime.dispatch=jest.fn().mockResolvedValue(undefined)
  const gateway=new DriverMapGateway(runtime,null,25)
  const pending=gateway.openCard('42');const rejected=expect(pending).rejects.toEqual(expect.objectContaining({code:'DRIVER_EVENT_TIMEOUT'}))
  await Promise.resolve();jest.advanceTimersByTime(25);await rejected
  expect(runtime.dispatch).toHaveBeenCalledTimes(1)
 }finally{jest.useRealTimers()}
})
it('continues waiting for an accepted command after the map unmounts',async()=>{
 const runtime=createRuntime();let finish
 const waiter={captureBaseline:jest.fn(()=>({state:null})),wait:jest.fn(()=>new Promise(resolve=>{finish=resolve})),fail:jest.fn(),cancelAll:jest.fn()}
 const transport={send:jest.fn().mockResolvedValue({accepted:true,duplicate:false,instanceId:911,status:'PENDING',intent:'ride_started'})}
 const gateway=new DriverMapGateway(runtime,transport,1000,waiter),unmount=gateway.mount()
 const pending=gateway.start('42')
 for(let i=0;i<12;i++)await Promise.resolve()
 expect(waiter.wait).toHaveBeenCalledTimes(1);unmount();expect(waiter.cancelAll).not.toHaveBeenCalled()
 finish({status:'COMPLETED',instanceId:911});await expect(pending).resolves.toBeUndefined()
})
