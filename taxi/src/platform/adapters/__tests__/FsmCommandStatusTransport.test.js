import {
  createConfiguredFsmCommandStatusTransport,
  FsmCommandStatusTransport,
} from '../FsmCommandStatusTransport'

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  }
}

describe('FsmCommandStatusTransport', () => {
  it('loads one authenticated command execution by instanceId', async() => {
    const payload = { instanceId: 7, status: 'PROCESSING' }
    const fetchRequest = jest.fn().mockResolvedValue(createResponse(payload))
    const transport = new FsmCommandStatusTransport({
      apiUrl: 'https://fsm.example.test/',
      apiToken: 'driver-token',
    }, { fetch: fetchRequest })

    await expect(transport.getStatus(7)).resolves.toEqual(payload)
    expect(fetchRequest).toHaveBeenCalledWith(
      'https://fsm.example.test/api/commands/7',
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer driver-token',
        },
      },
    )
  })

  it('normalizes HTTP errors and validates terminal responses', async() => {
    const fetchRequest = jest.fn()
      .mockResolvedValueOnce(createResponse({ detail: 'Command not found' }, 404))
      .mockResolvedValueOnce(createResponse({ instanceId: 7, status: 'FAILED' }))
      .mockResolvedValueOnce(createResponse({ instanceId: 8, status: 'COMPLETED' }))
    const transport = new FsmCommandStatusTransport({
      apiUrl: 'https://fsm.example.test',
    }, { fetch: fetchRequest })

    await expect(transport.getStatus(7)).rejects.toEqual(expect.objectContaining({
      code: 'FSM_COMMAND_STATUS_HTTP_404',
      message: 'Command not found',
    }))
    await expect(transport.getStatus(7)).rejects.toEqual(expect.objectContaining({
      code: 'FSM_COMMAND_STATUS_PROTOCOL_ERROR',
      message: expect.stringContaining('requires errorCode'),
    }))
    await expect(transport.getStatus(7)).rejects.toEqual(expect.objectContaining({
      code: 'FSM_COMMAND_STATUS_PROTOCOL_ERROR',
      message: expect.stringContaining('instanceId'),
    }))
  })

  it('requires an explicit rollout flag in addition to the shared FSM API URL', () => {
    expect(createConfiguredFsmCommandStatusTransport({})).toBeNull()
    expect(createConfiguredFsmCommandStatusTransport({
      REACT_APP_FSM_API_URL: 'https://fsm.example.test',
    })).toBeNull()
    expect(createConfiguredFsmCommandStatusTransport({
      REACT_APP_FSM_API_URL: 'https://fsm.example.test',
      REACT_APP_FSM_COMMAND_STATUS_ENABLED: 'true',
    })).toBeInstanceOf(FsmCommandStatusTransport)
  })
})
