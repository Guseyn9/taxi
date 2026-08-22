import { TransportError } from '../interaction-contract'

export const BACKEND_ERROR_CODES = {
  Response: 'BACKEND_RESPONSE_ERROR',
  Transport: 'BACKEND_TRANSPORT_ERROR',
} as const

export class BackendInteractionError extends TransportError {
  readonly code: string
  readonly details: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.code = code
    this.details = details
  }
}

export function normalizeBackendError(error: unknown): BackendInteractionError {
  if (error instanceof BackendInteractionError)
    return error

  const candidate = error as {
    readonly message?: unknown
    readonly status?: unknown
    readonly code?: unknown
    readonly response?: { readonly data?: unknown }
  } | null
  const details = candidate?.response?.data ?? error
  const message = String(candidate?.message || 'Backend request failed')
  return new BackendInteractionError(BACKEND_ERROR_CODES.Transport, message, details)
}

export function assertSuccessfulBackendResponse<T>(response: T): T {
  const candidate = response as {
    readonly status?: unknown
    readonly code?: unknown
    readonly message?: unknown
  } | null
  const statusFailed = candidate?.status === 'error'
  const code = candidate?.code
  const codeFailed = code !== undefined && code !== null && String(code) !== '200'

  if (statusFailed || codeFailed) {
    throw new BackendInteractionError(
      BACKEND_ERROR_CODES.Response,
      String(candidate?.message || 'Backend rejected the request'),
      response,
    )
  }

  return response
}
