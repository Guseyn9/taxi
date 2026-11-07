/** Read-only health channels: no credentials, payloads or command retries. */
export interface ReadChannelHealth { failed: boolean; pending: boolean; updatedAt: number; failures: number }
const channels = new Map<symbol, ReadChannelHealth>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(listener => { try { listener() } catch { /* Diagnostics cannot interrupt a request. */ } })
export const readChannels = () => Array.from(channels.values())
export const subscribeReadChannels = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function registerReadChannel() {
  const id = Symbol('read')
  channels.set(id, { failed: false, pending: false, updatedAt: 0, failures: 0 })
  const update = (patch: Partial<ReadChannelHealth>) => { const prior = channels.get(id); if (prior) { channels.set(id, { ...prior, ...patch }); emit() } }
  return {
    start: () => update({ pending: true }),
    success: () => update({ failed: false, pending: false, updatedAt: Date.now(), failures: 0 }),
    failure: () => update({ failed: true, pending: false, failures: (channels.get(id)?.failures || 0) + 1 }),
    dispose: () => { channels.delete(id); emit() },
  }
}
