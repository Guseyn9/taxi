import {
  createConfiguredFsmTaxiCommandTransport,
  FsmTaxiCommandTransport,
} from '../FsmTaxiCommandTransport'

function createResponse(body, status = 202) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('FsmTaxiCommandTransport', () => {
  it('sends an authenticated idempotent intent envelope', async() => {
    const accepted = {
      accepted: true,
      duplicate: false,
      instanceId: 7,
      status: 'PENDING',
      intent: 'driver_arrived',
    }
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(accepted))
    const transport = new FsmTaxiCommandTransport({
      apiUrl: 'https://fsm.example.test/',
      apiToken: 'driver-token',
    }, {
      fetch: fetchRequest,
      createId: () => 'cmd-100',
    })

    await expect(transport.send(
      42,
      'driver.order.arrive',
      {},
      { source: 'driver.interface', correlationId: 'corr-100' },
    )).resolves.toEqual(accepted)

    expect(fetchRequest).toHaveBeenCalledWith(
      'https://fsm.example.test/api/commands/taxi/order/42',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer driver-token',
          'Idempotency-Key': 'cmd-100',
        }),
      }),
    )
    expect(JSON.parse(fetchRequest.mock.calls[0][1].body)).toEqual({
      schemaVersion: '1.0',
      commandId: 'cmd-100',
      correlationId: 'corr-100',
      intent: 'driver.order.arrive',
      payload: {},
    })
  })

  it('accepts a duplicate response and normalizes an HTTP error', async() => {
    const duplicate = {
      accepted: true,
      duplicate: true,
      instanceId: 7,
      status: 'PENDING',
      intent: 'driver_arrived',
    }
    const fetchRequest = jest.fn()
      .mockResolvedValueOnce(createResponse(duplicate, 200))
      .mockResolvedValueOnce(createResponse({ detail: 'Role cannot execute intent' }, 403))
    const transport = new FsmTaxiCommandTransport({
      apiUrl: 'https://fsm.example.test',
    }, {
      fetch: fetchRequest,
      createId: () => 'same-key',
    })

    await expect(transport.send(42, 'driver_arrived')).resolves.toEqual(duplicate)
    await expect(transport.send(42, 'cancel_requested')).rejects.toEqual(
      expect.objectContaining({
        code: 'FSM_COMMAND_HTTP_403',
        message: 'Role cannot execute intent',
      }),
    )
  })

  it('rejects malformed accepted responses and unexpected success statuses', async() => {
    const valid = {
      accepted: true,
      duplicate: false,
      instanceId: 7,
      status: 'PENDING',
      intent: 'driver_arrived',
    }
    const fetchRequest = jest.fn()
      .mockResolvedValueOnce(createResponse({}, 202))
      .mockResolvedValueOnce(createResponse(valid, 201))
    const transport = new FsmTaxiCommandTransport({
      apiUrl: 'https://fsm.example.test',
    }, {
      fetch: fetchRequest,
      createId: () => 'cmd-protocol-test',
    })

    await expect(transport.send(42, 'driver_arrived')).rejects.toEqual(
      expect.objectContaining({
        code: 'FSM_COMMAND_PROTOCOL_ERROR',
        message: expect.stringContaining('accepted must be true'),
      }),
    )
    await expect(transport.send(42, 'driver_arrived')).rejects.toEqual(
      expect.objectContaining({
        code: 'FSM_COMMAND_PROTOCOL_ERROR',
        message: expect.stringContaining('unexpected HTTP 201'),
      }),
    )
  })

  it('is configured only when the FSM API URL exists', () => {
    expect(createConfiguredFsmTaxiCommandTransport({})).toBeNull()
    expect(createConfiguredFsmTaxiCommandTransport({
      REACT_APP_FSM_API_URL: 'https://fsm.example.test',
    })).toBeInstanceOf(FsmTaxiCommandTransport)
  })
})
