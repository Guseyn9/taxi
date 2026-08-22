import type { InteractionMetadata } from '../interaction-contract'
import { BackendInteractionError } from './backendError'

export interface TaxiCommandTransport {
  send(
    orderId: number | string,
    intent: string,
    payload?: Readonly<Record<string, unknown>>,
    metadata?: InteractionMetadata,
  ): Promise<FsmCommandAccepted>
}

export interface FsmCommandAccepted {
  readonly accepted: boolean
  readonly duplicate: boolean
  readonly instanceId: number
  readonly status: string
  readonly intent: string
  readonly commandId?: string | null
  readonly correlationId?: string | null
  readonly [key: string]: unknown
}

export interface FsmTaxiCommandConfig {
  readonly apiUrl: string
  readonly apiToken?: string
}

export interface FsmTaxiCommandDependencies {
  readonly fetch?: typeof fetch
  readonly createId?: () => string
}

export const FSM_COMMAND_ENV = {
  ApiUrl: 'REACT_APP_FSM_API_URL',
  ApiToken: 'REACT_APP_FSM_API_TOKEN',
} as const

/** HTTP adapter for POST /api/commands/taxi/order/{orderId}. */
export class FsmTaxiCommandTransport implements TaxiCommandTransport {
  private readonly config: FsmTaxiCommandConfig
  private readonly fetchRequest: typeof fetch
  private readonly createId: () => string

  constructor(
    config: FsmTaxiCommandConfig,
    dependencies: FsmTaxiCommandDependencies = {},
  ) {
    const apiUrl = config.apiUrl.trim()
    if (!apiUrl)
      throw new Error('FSM API URL is required')
    this.config = { ...config, apiUrl }
    this.fetchRequest = dependencies.fetch ?? fetch.bind(globalThis)
    this.createId = dependencies.createId ?? createCommandId
  }

  async send(
    orderId: number | string,
    intent: string,
    payload: Readonly<Record<string, unknown>> = {},
    metadata?: InteractionMetadata,
  ): Promise<FsmCommandAccepted> {
    const normalizedOrderId = String(orderId).trim()
    if (!normalizedOrderId)
      throw new Error('FSM command orderId is required')

    const commandId = this.createId()
    const correlationId = metadata?.correlationId || commandId
    const response = await this.fetchRequest(
      `${trimTrailingSlash(this.config.apiUrl)}/api/commands/taxi/order/${encodeURIComponent(normalizedOrderId)}`,
      {
        method: 'POST',
        headers: this.headers(commandId),
        body: JSON.stringify({
          schemaVersion: '1.0',
          commandId,
          correlationId,
          intent,
          payload,
        }),
      },
    )
    const details = await readResponseDetails(response)
    if (!response.ok) {
      throw new BackendInteractionError(
        `FSM_COMMAND_HTTP_${response.status}`,
        getServerErrorMessage(details, `FSM Command failed with HTTP ${response.status}`),
        details,
      )
    }

    if (response.status !== 200 && response.status !== 202) {
      throw new BackendInteractionError(
        'FSM_COMMAND_PROTOCOL_ERROR',
        `FSM Command returned unexpected HTTP ${response.status}; expected 202 or duplicate 200`,
        details,
      )
    }

    return validateAcceptedCommand(details, response.status)
  }

  private headers(idempotencyKey: string): HeadersInit {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    }
    if (this.config.apiToken)
      headers.Authorization = `Bearer ${this.config.apiToken}`
    return headers
  }
}

export function createConfiguredFsmTaxiCommandTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FsmTaxiCommandTransport | null {
  const apiUrl = env[FSM_COMMAND_ENV.ApiUrl]?.trim()
  if (!apiUrl)
    return null

  return new FsmTaxiCommandTransport({
    apiUrl,
    apiToken: env[FSM_COMMAND_ENV.ApiToken]?.trim() || undefined,
  })
}

function createCommandId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto)
  if (randomUuid)
    return `cmd-${randomUuid()}`
  return `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

async function readResponseDetails(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    try {
      return await response.text()
    } catch {
      return null
    }
  }
}

function getServerErrorMessage(details: unknown, fallback: string): string {
  if (typeof details === 'string' && details.trim())
    return details
  if (details && typeof details === 'object') {
    const value = details as { detail?: unknown, message?: unknown }
    if (typeof value.detail === 'string' && value.detail.trim())
      return value.detail
    if (typeof value.message === 'string' && value.message.trim())
      return value.message
  }
  return fallback
}

function validateAcceptedCommand(details: unknown, httpStatus: number): FsmCommandAccepted {
  if (!details || typeof details !== 'object')
    throw invalidAcceptedCommand(details, 'response body must be an object')

  const accepted = details as Partial<FsmCommandAccepted>
  if (accepted.accepted !== true)
    throw invalidAcceptedCommand(details, 'accepted must be true')
  if (typeof accepted.duplicate !== 'boolean')
    throw invalidAcceptedCommand(details, 'duplicate must be boolean')
  if (!Number.isInteger(accepted.instanceId) || Number(accepted.instanceId) <= 0)
    throw invalidAcceptedCommand(details, 'instanceId must be a positive integer')
  if (typeof accepted.status !== 'string' || !accepted.status.trim())
    throw invalidAcceptedCommand(details, 'status must be a non-empty string')
  if (typeof accepted.intent !== 'string' || !accepted.intent.trim())
    throw invalidAcceptedCommand(details, 'intent must be a non-empty string')
  if (httpStatus === 200 && !accepted.duplicate)
    throw invalidAcceptedCommand(details, 'HTTP 200 is reserved for duplicate commands')
  if (httpStatus === 202 && accepted.duplicate)
    throw invalidAcceptedCommand(details, 'new HTTP 202 command cannot be marked duplicate')

  return accepted as FsmCommandAccepted
}

function invalidAcceptedCommand(details: unknown, reason: string): BackendInteractionError {
  return new BackendInteractionError(
    'FSM_COMMAND_PROTOCOL_ERROR',
    `Invalid FSM Command Accepted response: ${reason}`,
    details,
  )
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
