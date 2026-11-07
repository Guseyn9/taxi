import type { Unsubscribe } from '../interaction-contract'
import { registerReadChannel } from '../../diagnostics/readChannels'

/** Schedule after settlement, so slow requests cannot accumulate. */
export function subscribeRecoveryPolling<T>(
  load: () => Promise<T | null>,
  listener: (snapshot: T) => void,
  intervalMs: number,
): Unsubscribe {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => undefined
  let stopped = false
  const health = registerReadChannel()
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => { timer = setTimeout(poll, intervalMs) }
  const poll = async() => {
    health.start()
    try {
      const snapshot = await load()
      if (!stopped) health.success()
      if (!stopped && snapshot) listener(snapshot)
    } catch { if (!stopped) health.failure() }
    finally { if (!stopped) schedule() }
  }
  schedule()
  return () => { stopped = true; clearTimeout(timer); health.dispose() }
}
