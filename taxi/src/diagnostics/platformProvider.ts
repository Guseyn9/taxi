import { writeRawLog } from '../tools/rawLog'

export type SnapshotProviderKind = 'legacy-redux' | 'fsm-order' | 'fsm-driver'
let current: { snapshot: SnapshotProviderKind; driverLifecycle: 'legacy' | 'fsm'; passengerLifecycle: 'legacy' | 'fsm'; otherBusinessCommands: 'legacy'; completion: 'legacy-response' | 'snapshot' | 'command-status' } | null = null

/** Explicit migration evidence without identities, URLs, tokens or payloads. */
export function recordPlatformProvider(snapshot: SnapshotProviderKind): void {
  const fsm = Boolean(process.env.REACT_APP_FSM_API_URL?.trim())
  current = {
    snapshot,
    driverLifecycle: fsm ? 'fsm' : 'legacy',
    passengerLifecycle: fsm && process.env.REACT_APP_FSM_PASSENGER_ENABLED === 'true' ? 'fsm' : 'legacy',
    otherBusinessCommands: 'legacy',
    completion: !fsm ? 'legacy-response' : process.env.REACT_APP_FSM_COMMAND_STATUS_ENABLED?.trim().toLowerCase() === 'true' ? 'command-status' : 'snapshot',
  }
  writeRawLog('PLATFORM_PROVIDER', current)
}

export function getPlatformProviderDiagnostics() { return current ? { ...current } : null }
