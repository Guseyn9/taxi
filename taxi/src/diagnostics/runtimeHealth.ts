import { writeRawLog } from '../tools/rawLog'

const CHECKPOINT_KEY = 'taxi_runtime_health_v1'
const CHECKPOINT_MS = 15000
const resources = new Map<string, number>()
let emitHealth: ((event: string, detail?: Record<string, unknown>) => void) | undefined
let activeStop: (() => void) | undefined

export function runtimeResourceCounts() { return Object.fromEntries(resources) }

/** Count owned resources, without retaining the map, renderer, canvas or order. */
export function trackRuntimeResource(kind: 'map-renderer') {
  resources.set(kind, (resources.get(kind) || 0) + 1)
  emitHealth?.('runtime.resource.acquired', { kind })
  let released = false
  return () => {
    if (released) return
    released = true
    resources.set(kind, Math.max(0, (resources.get(kind) || 0) - 1))
    emitHealth?.('runtime.resource.released', { kind })
  }
}

export function recordRuntimeHealth(event: string, detail?: Record<string, unknown>) {
  emitHealth?.(event, detail)
}

function errorSummary(value: unknown) {
  const item = value as { name?: unknown; message?: unknown; stack?: unknown } | null
  return {
    name: String(item?.name || 'Error').slice(0, 100),
    message: String(item?.message || (typeof value === 'string' ? value : 'No error message')).slice(0, 800),
    stack: typeof item?.stack === 'string' ? item.stack.slice(0, 1800) : undefined,
  }
}

/** Local diagnostics only. An unfinished checkpoint is evidence, not a crash verdict. */
export function startRuntimeHealth() {
  if (activeStop) return activeStop
  let previous: any
  try { previous = JSON.parse(sessionStorage.getItem(CHECKPOINT_KEY) || 'null') } catch (_) {}
  let state = document.visibilityState === 'hidden' ? 'hidden' : 'active'
  let lastEvent = 'runtime.started'
  const snapshot = () => {
    const memory = (performance as any).memory
    return {
      at: Date.now(), state, lastEvent, visibility: document.visibilityState,
      resources: runtimeResourceCounts(),
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: devicePixelRatio },
      heapBytes: Number.isFinite(memory?.usedJSHeapSize) ? memory.usedJSHeapSize : null,
    }
  }
  const persist = () => {
    try { sessionStorage.setItem(CHECKPOINT_KEY, JSON.stringify(snapshot())) } catch (_) {}
  }
  const record = (event: string, detail: Record<string, unknown> = {}) => {
    lastEvent = event
    writeRawLog(event, { ...detail, health: snapshot() })
    persist()
  }
  emitHealth = record
  if (previous?.state === 'active') record('runtime.previous_active_session', {
    previous: { at: previous.at, lastEvent: previous.lastEvent, resources: previous.resources },
  })
  record('runtime.started')
  const onError = (event: ErrorEvent) => {
    if (event.error || event.message) record('runtime.error', {
      ...errorSummary(event.error || event.message), line: event.lineno, column: event.colno,
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => record('runtime.unhandled_rejection', errorSummary(event.reason))
  const onVisibility = () => { state = document.visibilityState === 'hidden' ? 'hidden' : 'active'; persist() }
  const onHide = () => { state = 'pagehide'; persist() }
  const onShow = () => { state = document.visibilityState === 'hidden' ? 'hidden' : 'active'; persist() }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onHide)
  window.addEventListener('pageshow', onShow)
  // One small checkpoint; never append a heartbeat to the multi-megabyte RAW log.
  const timer = window.setInterval(() => { if (state === 'active') persist() }, CHECKPOINT_MS)
  activeStop = () => {
    window.clearInterval(timer)
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onHide)
    window.removeEventListener('pageshow', onShow)
    state = 'stopped'; persist(); emitHealth = undefined; activeStop = undefined
  }
  return activeStop
}
