import type { Unsubscribe } from '../interaction-contract'

/** Schedule after settlement, so slow requests cannot accumulate. */
export function subscribeRecoveryPolling<T>(
  load: () => Promise<T | null>,
  listener: (snapshot: T) => void,
  intervalMs: number,
): Unsubscribe {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return () => undefined
  let stopped = false
  let timer: ReturnType<typeof setTimeout>
  const schedule = () => { timer = setTimeout(poll, intervalMs) }
  const poll = async() => {
    try {
      const snapshot = await load()
      if (!stopped && snapshot) listener(snapshot)
    } catch { /* Keep recovery alive after a transient network failure. */ }
    finally { if (!stopped) schedule() }
  }
  schedule()
  return () => { stopped = true; clearTimeout(timer) }
}
