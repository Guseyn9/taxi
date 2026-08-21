import {
  assertSuccessfulBackendResponse,
  BackendInteractionError,
  normalizeBackendError,
} from '../backendError'
import { TransportError } from '../../interaction-contract'

describe('backend error normalization', () => {
  it('normalizes transport failures into the Interaction Contract hierarchy', () => {
    const error = normalizeBackendError(new Error('network down'))

    expect(error).toBeInstanceOf(BackendInteractionError)
    expect(error).toBeInstanceOf(TransportError)
    expect(error.code).toBe('BACKEND_TRANSPORT_ERROR')
    expect(error.message).toBe('network down')
  })

  it('recognizes HTTP-200 backend error payloads', () => {
    expect(() => assertSuccessfulBackendResponse({
      code: '403',
      message: 'wrong user role',
    })).toThrow(expect.objectContaining({
      code: 'BACKEND_RESPONSE_ERROR',
      message: 'wrong user role',
    }))
  })
})
