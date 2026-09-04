import { BackendInteractionError } from './backendError'

export const FSM_COMMAND_EXECUTION_STATUSES = {
  Pending: 'PENDING',
  Processing: 'PROCESSING',
  Completed: 'COMPLETED',
  Failed: 'FAILED',
} as const

export type FsmCommandExecutionStatus =
  typeof FSM_COMMAND_EXECUTION_STATUSES[keyof typeof FSM_COMMAND_EXECUTION_STATUSES]

export interface FsmCommandStatus {
  readonly instanceId: number
  readonly status: FsmCommandExecutionStatus
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly [key: string]: unknown
}

export interface CommandStatusTransport {
  getStatus(instanceId: number): Promise<FsmCommandStatus>
}

export interface FsmCommandStatusConfig {
  readonly apiUrl: string
  readonly apiToken?: string
}

export interface FsmCommandStatusDependencies {
  readonly fetch?: typeof fetch
}

export const FSM_COMMAND_STATUS_ENV = {
  ApiUrl: 'REACT_APP_FSM_API_URL',
  ApiToken: 'REACT_APP_FSM_API_TOKEN',
  Enabled: 'REACT_APP_FSM_COMMAND_STATUS_ENABLED',
  PollIntervalMs: 'REACT_APP_FSM_COMMAND_STATUS_POLL_MS',
} as const

/** HTTP adapter for the TASK-CORE-001 Command Completion contract. */
export class FsmCommandStatusTransport implements CommandStatusTransport {
  private readonly config: FsmCommandStatusConfig
  private readonly fetchRequest: typeof fetch

  constructor(
    config: FsmCommandStatusConfig,
    dependencies: FsmCommandStatusDependencies = {},
  ) {
    const apiUrl = config.apiUrl.trim()
    if (!apiUrl)
      throw new Error('FSM API URL is required')
    this.config = { ...config, apiUrl }
    this.fetchRequest = dependencies.fetch ?? fetch.bind(globalThis)
  }

  async getStatus(instanceId: number): Promise<FsmCommandStatus> {
    if (!Number.isInteger(instanceId) || instanceId <= 0)
      throw new Error('FSM command instanceId must be a positive integer')

    const response = await this.fetchRequest(
      `${trimTrailingSlash(this.config.apiUrl)}/api/commands/${instanceId}`,
      { method: 'GET', headers: this.headers() },
    )
    const details = await readResponseDetails(response)
    if (!response.ok) {
      throw new BackendInteractionError(
        `FSM_COMMAND_STATUS_HTTP_${response.status}`,
        getServerErrorMessage(details, `FSM Command Status failed with HTTP ${response.status}`),
        details,
      )
    }

    return validateCommandStatus(details, instanceId)
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (this.config.apiToken)
      headers.Authorization = `Bearer ${this.config.apiToken}`
    return headers
  }
}

export function createConfiguredFsmCommandStatusTransport(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FsmCommandStatusTransport | null {
  const apiUrl = env[FSM_COMMAND_STATUS_ENV.ApiUrl]?.trim()
  const enabled = env[FSM_COMMAND_STATUS_ENV.Enabled]?.trim().toLowerCase() === 'true'
  if (!apiUrl || !enabled)
    return null

  return new FsmCommandStatusTransport({
    apiUrl,
    apiToken: env[FSM_COMMAND_STATUS_ENV.ApiToken]?.trim() || undefined,
  })
}

export function configuredCommandStatusPollInterval(
  env: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const value = Number(env[FSM_COMMAND_STATUS_ENV.PollIntervalMs])
  return Number.isFinite(value) && value >= 0 ? value : 1000
}

function validateCommandStatus(details: unknown, expectedInstanceId: number): FsmCommandStatus {
  if (!details || typeof details !== 'object')
    throw protocolError(details, 'response body must be an object')

  const status = details as Partial<FsmCommandStatus>
  if (status.instanceId !== expectedInstanceId)
    throw protocolError(details, 'instanceId does not match the requested command')
  if (!Object.values(FSM_COMMAND_EXECUTION_STATUSES).includes(status.status as FsmCommandExecutionStatus))
    throw protocolError(details, `unsupported status ${String(status.status)}`)
  if (
    status.status === FSM_COMMAND_EXECUTION_STATUSES.Failed &&
    (typeof status.errorCode !== 'string' || !status.errorCode.trim())
  )
    throw protocolError(details, 'FAILED status requires errorCode')

  return status as FsmCommandStatus
}

function protocolError(details: unknown, reason: string): BackendInteractionError {
  return new BackendInteractionError(
    'FSM_COMMAND_STATUS_PROTOCOL_ERROR',
    `Invalid FSM Command Status response: ${reason}`,
    details,
  )
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
