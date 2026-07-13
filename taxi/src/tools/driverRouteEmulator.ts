/**
 * Driver route emulator — a framework-agnostic, "dumb" route model.
 *
 * Scope of this module (tasks 1–3):
 *   1. Route model      — an ordered list of logical waypoints, the active
 *                         waypoint pointer, advancing to the next one once the
 *                         previous is reached.
 *   2. Driver movement  — moving along the road geometry, detecting waypoint
 *                         arrival, publishing an arrival notification.
 *   3. Waypoint types   — pickup / boarding / dropoff / custom.
 *
 * Design contract (agreed): this model contains NO business logic. It only
 *   - stores the logical route (a sequence of waypoints);
 *   - stores movement state and computes the current position;
 *   - builds the actual geometry through an injected `routeProvider`
 *     (it never knows whether OSRM / a way graph / anything else is used);
 *   - moves the driver and reports when a waypoint is reached.
 *
 * Everything business-level (when to change the route, whether a same-way
 * order may be taken, rebuild rules, passenger consent) is decided OUTSIDE —
 * by the UI / adapter now, by an FSM later.
 *
 * Later chunks built on top of this foundation:
 *   4. Modes (Strict/Realistic/Manual) gate how change requests are handled.
 *   5. Full mutation API — replaceRoute / appendWaypoint / insertWaypoint /
 *      removeWaypoint, all mode-governed; structural edits preserve travel
 *      progress by re-projecting the current position onto the new geometry.
 *   6. External event ingestion — `dispatch(event)` only RE-TRANSMITS world
 *      events (it never mutates the route); the activeOrders/readyOrders →
 *      events mapping lives in a separate adapter (driverOrderEventAdapter).
 */

export interface IGeoPoint {
  lat: number
  lng: number
}

export enum ERouteWaypointType {
  /** подача — the pickup location the driver drives to */
  Pickup = 'pickup',
  /** посадка — the passenger boards */
  Boarding = 'boarding',
  /** высадка — the passenger is dropped off */
  Dropoff = 'dropoff',
  /** произвольная — a free point for future scenarios */
  Custom = 'custom',
}

export interface IRouteWaypoint extends IGeoPoint {
  type: ERouteWaypointType
  orderId?: string
  meta?: Record<string, unknown>
}

/**
 * Injected geometry source. Given two logical points it returns the road
 * polyline between them. The model concatenates per-segment polylines into a
 * single route and moves along it. Keeping this as a dependency makes the
 * model independent of the concrete routing backend.
 */
export type RouteProvider = (from: IGeoPoint, to: IGeoPoint) => Promise<IGeoPoint[]>

/**
 * How the model reacts to a request to change an already-built route.
 * The model itself never decides WHICH rebuilds are valid — that stays with the
 * caller (UI/settings now, FSM later). The mode only governs the mechanics:
 *   - Strict     — the route is built once and is not changed until the current
 *                  task is finished; change requests are rejected.
 *   - Realistic  — change requests are applied immediately, no questions asked.
 *   - Manual     — a change request is not applied automatically; the model
 *                  publishes a notification and waits for an explicit decision
 *                  (keep / apply / append a point to the end) from outside.
 */
export enum ERouteEmulatorMode {
  Strict = 'strict',
  Realistic = 'realistic',
  Manual = 'manual',
}

/** A proposed change to the current route. No business meaning attached. */
export type RouteChangeRequest =
  | { kind: 'replace'; waypoints: IRouteWaypoint[]; reason?: string; source?: string }
  | { kind: 'append'; waypoint: IRouteWaypoint; reason?: string; source?: string }
  | { kind: 'insert'; index: number; waypoint: IRouteWaypoint; reason?: string; source?: string }
  | { kind: 'remove'; index: number; reason?: string; source?: string }

/** Metadata that any mutation entry accepts. Purely descriptive, no logic. */
export interface IRouteChangeMeta {
  reason?: string
  source?: string
}

/** Manual-mode actions offered to the user when a change is pending. */
export type EManualRouteAction = 'keep' | 'apply' | 'append'

/** The explicit decision the UI sends back in Manual mode. */
export type ManualRouteResolution =
  | { action: 'keep' }
  | { action: 'apply' }
  | { action: 'append'; waypoint: IRouteWaypoint }

/** Outcome of a mode-governed change request. */
export type RouteChangeOutcome = 'applied' | 'rejected' | 'pending'

/**
 * External world events the model may be told about via `dispatch`. The model
 * NEVER interprets these — it only re-transmits them as an `external-event` so
 * an outside decision-maker (UI/adapter now, FSM later) can react by issuing
 * explicit mutation commands (setRoute/insertWaypoint/…). The names mirror the
 * order lifecycle the adapter-differ maps onto (see driverOrderEventAdapter).
 */
export enum EDriverExternalEventType {
  NewOrder = 'NEW_ORDER',
  OrderAccepted = 'ORDER_ACCEPTED',
  OrderCancelled = 'ORDER_CANCELLED',
  NewVotingOrder = 'NEW_VOTING_ORDER',
  VotingWon = 'VOTING_WON',
  NewAlongTheWayOrder = 'NEW_ALONG_THE_WAY_ORDER',
}

/**
 * A world event handed to the model. Kept domain-agnostic on purpose: the model
 * does not know about orders. `pickup`/`dropoff` carry optional geometry so the
 * consumer can build waypoints without re-reading the order; `payload` may carry
 * anything the adapter wants to pass through (e.g. the raw order).
 */
export interface IDriverExternalEvent {
  type: EDriverExternalEventType | string
  orderId?: string
  pickup?: IGeoPoint | null
  dropoff?: IGeoPoint | null
  payload?: Record<string, unknown>
}

/**
 * Actions the model offers to a human/dev when, in Manual mode, an external
 * event needs a decision. They are just identifiers — the model performs none
 * of them itself; whoever handles the notification calls the matching public
 * API (replaceRoute / appendWaypoint) or does nothing (keep / ignore).
 */
export enum EManualDecisionAction {
  /** Оставить маршрут — leave the current route untouched. */
  Keep = 'keep',
  /** Заменить маршрут — caller should call replaceRoute(...). */
  ReplaceRoute = 'replaceRoute',
  /** Добавить точку — caller should call appendWaypoint(...). */
  AppendPoint = 'appendPoint',
  /** Игнорировать — dismiss the event, do nothing. */
  Ignore = 'ignore',
}

/** Default set of actions attached to a manual-decision notification. */
export const DEFAULT_MANUAL_DECISION_ACTIONS: EManualDecisionAction[] = [
  EManualDecisionAction.Keep,
  EManualDecisionAction.ReplaceRoute,
  EManualDecisionAction.AppendPoint,
  EManualDecisionAction.Ignore,
]

/**
 * Notification payload published when a decision is required in Manual mode.
 * Mirrors the "MANUAL_DECISION_REQUIRED" shape: the original event plus the
 * list of offered actions. This is the architecture hook a dev UI subscribes to
 * later; the model itself never decides.
 */
export interface IManualDecisionRequest {
  originalEvent: IDriverExternalEvent
  actions: EManualDecisionAction[]
}

export type RouteEmulatorEvent =
  | { type: 'route-loading' }
  | { type: 'route-loaded' }
  | { type: 'route-error'; error: unknown }
  | { type: 'route-cleared' }
  | { type: 'tick'; position: IGeoPoint }
  | { type: 'waypoint-reached'; waypoint: IRouteWaypoint; index: number }
  | { type: 'finished' }
  | { type: 'resumed' }
  | { type: 'paused' }
  | { type: 'mode-changed'; mode: ERouteEmulatorMode }
  | { type: 'route-change-applied'; request: RouteChangeRequest }
  | { type: 'route-change-rejected'; request: RouteChangeRequest; reason: string }
  | { type: 'route-change-pending'; request: RouteChangeRequest; actions: EManualRouteAction[] }
  | { type: 'route-change-resolved'; resolution: ManualRouteResolution }
  | { type: 'external-event'; event: IDriverExternalEvent }
  | { type: 'manual-decision-required'; originalEvent: IDriverExternalEvent; actions: EManualDecisionAction[] }

export interface IRouteEmulatorState {
  /** Logical route: the ordered waypoints. */
  waypoints: IRouteWaypoint[]
  /** Index of the next waypoint the driver is heading to. */
  activeIndex: number
  /** Current driver position on the built geometry (null until a route loads). */
  position: IGeoPoint | null
  /** Combined road polyline across all segments. */
  polyline: IGeoPoint[]
  /** Distance already travelled along the polyline, meters. */
  traveledMeters: number
  /** Total polyline length, meters. */
  totalMeters: number
  running: boolean
  /** Geometry build is in progress. */
  loading: boolean
  /** The last waypoint has been reached. */
  finished: boolean
  /** How change requests are handled. */
  mode: ERouteEmulatorMode
  /** In Manual mode, the change request awaiting an explicit decision. */
  pendingChange: RouteChangeRequest | null
  /** Current movement speed along the route, meters per second. */
  speedMps: number
}

export type RouteEmulatorListener = (event: RouteEmulatorEvent) => void

export interface IDriverRouteEmulatorOptions {
  routeProvider: RouteProvider
  /** How route changes are handled. Default Realistic. */
  mode?: ERouteEmulatorMode
  /** Driver speed along the route. Default 24 m/s (≈86 km/h), matches the old demo. */
  speedMps?: number
  /** Internal timer period used by resume(). Default 1000 ms. */
  tickIntervalMs?: number
  /**
   * How close (meters, along the route) counts as reaching a waypoint.
   * Arrival is detected by crossing the waypoint's cumulative route distance,
   * so this is only a small tolerance.
   */
  reachToleranceMeters?: number
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number
}

const DEFAULT_MODE = ERouteEmulatorMode.Realistic
const DEFAULT_SPEED_MPS = 24
const DEFAULT_TICK_INTERVAL_MS = 1000
const DEFAULT_REACH_TOLERANCE_METERS = 1
const EARTH_RADIUS_METERS = 6371000
const JOINT_DEDUP_METERS = 0.5

function toRad(value: number) {
  return value * Math.PI / 180
}

/** Great-circle distance in meters. */
export function haversineMeters(from: IGeoPoint, to: IGeoPoint): number {
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const deltaLat = toRad(to.lat - from.lat)
  const deltaLng = toRad(to.lng - from.lng)
  const a = Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function interpolate(from: IGeoPoint, to: IGeoPoint, ratio: number): IGeoPoint {
  const t = Math.max(0, Math.min(1, ratio))
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  }
}

function isFiniteGeoPoint(value: unknown): value is IGeoPoint {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Number.isFinite((value as IGeoPoint).lat) &&
    Number.isFinite((value as IGeoPoint).lng),
  )
}

export class DriverRouteEmulator {
  private readonly routeProvider: RouteProvider
  private speedMps: number
  private readonly tickIntervalMs: number
  private readonly reachToleranceMeters: number
  private readonly now: () => number

  private waypoints: IRouteWaypoint[] = []
  private activeIndex = 0
  private position: IGeoPoint | null = null
  private polyline: IGeoPoint[] = []
  /** Cumulative polyline length up to each polyline point. */
  private cumulative: number[] = []
  /** Cumulative route distance at which each waypoint sits on the polyline. */
  private waypointMeters: number[] = []
  private traveledMeters = 0
  private totalMeters = 0
  private running = false
  private loading = false
  private finished = false
  private mode: ERouteEmulatorMode
  private pendingChange: RouteChangeRequest | null = null

  /** Guards against stale async geometry builds when the route is replaced. */
  private buildToken = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private lastTickAt: number | null = null
  private readonly listeners = new Set<RouteEmulatorListener>()

  constructor(options: IDriverRouteEmulatorOptions) {
    this.routeProvider = options.routeProvider
    this.speedMps = options.speedMps ?? DEFAULT_SPEED_MPS
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS
    this.reachToleranceMeters = options.reachToleranceMeters ?? DEFAULT_REACH_TOLERANCE_METERS
    this.now = options.now ?? (() => Date.now())
    this.mode = options.mode ?? DEFAULT_MODE
  }

  // --- Subscription -------------------------------------------------------

  /** Subscribe to emulator events. Returns an unsubscribe function. */
  subscribe(listener: RouteEmulatorListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: RouteEmulatorEvent) {
    this.listeners.forEach(listener => {
      try {
        listener(event)
      } catch (error) {
        console.error('[DriverRouteEmulator] listener error', error)
      }
    })
  }

  // --- External events ----------------------------------------------------

  /**
   * Ingest a world event. Per the design contract the model does NOT interpret
   * it and never mutates the route in response — it only re-transmits the event
   * as an `external-event` so an outside decision-maker (UI/adapter now, FSM
   * later) can react by issuing explicit mutation commands.
   *
   * In Manual mode it additionally publishes a `manual-decision-required`
   * notification (the event + the offered actions) so a dev UI can ask a human
   * what to do. The model still decides nothing: the actions are identifiers the
   * subscriber acts on by calling the public API. No UI is wired here yet — this
   * is only the architecture hook.
   */
  dispatch(event: IDriverExternalEvent) {
    this.emit({ type: 'external-event', event })

    if (this.mode === ERouteEmulatorMode.Manual)
      this.emit({
        type: 'manual-decision-required',
        originalEvent: event,
        actions: DEFAULT_MANUAL_DECISION_ACTIONS.slice(),
      })
  }

  /**
   * Convenience subscription for the manual-decision notifications only. Returns
   * an unsubscribe function, like `subscribe`. The dev UI (built later) listens
   * here to render the "event received → choose an action" prompt.
   */
  onDecisionRequired(listener: (decision: IManualDecisionRequest) => void): () => void {
    return this.subscribe(event => {
      if (event.type === 'manual-decision-required')
        listener({ originalEvent: event.originalEvent, actions: event.actions })
    })
  }

  getState(): IRouteEmulatorState {
    return {
      waypoints: this.waypoints.slice(),
      activeIndex: this.activeIndex,
      position: this.position ? { ...this.position } : null,
      polyline: this.polyline.slice(),
      traveledMeters: this.traveledMeters,
      totalMeters: this.totalMeters,
      running: this.running,
      loading: this.loading,
      finished: this.finished,
      mode: this.mode,
      pendingChange: this.pendingChange ? { ...this.pendingChange } : null,
      speedMps: this.speedMps,
    }
  }

  // --- Control API (final form for an external driver / FSM) --------------

  /** The waypoint the driver is currently heading to, or null when finished. */
  getActiveWaypoint(): IRouteWaypoint | null {
    const waypoint = this.waypoints[this.activeIndex]
    return waypoint ? { ...waypoint } : null
  }

  getSpeed(): number {
    return this.speedMps
  }

  /**
   * Change the movement speed at runtime (meters per second). Non-positive or
   * non-finite values are ignored. Takes effect on the next step/tick; travel
   * progress so far is preserved.
   */
  setSpeed(speedMps: number) {
    if (!Number.isFinite(speedMps) || speedMps <= 0)
      return
    this.speedMps = speedMps
  }

  // --- Modes --------------------------------------------------------------

  getMode(): ERouteEmulatorMode {
    return this.mode
  }

  /**
   * Switch mode. Switching away from Manual drops any change still awaiting a
   * decision (it becomes the new mode's responsibility to re-request).
   */
  setMode(mode: ERouteEmulatorMode) {
    if (mode === this.mode)
      return
    this.mode = mode
    if (mode !== ERouteEmulatorMode.Manual)
      this.pendingChange = null
    this.emit({ type: 'mode-changed', mode })
  }

  // --- Route loading ------------------------------------------------------

  /**
   * Load a fresh logical route. Movement state is reset and the geometry is
   * (re)built through the injected routeProvider. This is the only mutation
   * entry implemented in this foundation chunk; replaceRoute/appendPoint/… and
   * the mode-aware guards come later.
   */
  async setRoute(waypoints: IRouteWaypoint[]): Promise<void> {
    const safe = (waypoints || []).filter(isFiniteGeoPoint)
    const token = ++this.buildToken

    this.waypoints = safe.map(point => ({ ...point }))
    this.activeIndex = 0
    this.position = safe.length ? { lat: safe[0].lat, lng: safe[0].lng } : null
    this.polyline = []
    this.cumulative = []
    this.waypointMeters = []
    this.traveledMeters = 0
    this.totalMeters = 0
    this.finished = false
    this.lastTickAt = null

    if (safe.length < 2) {
      // Nothing to travel along; a single point is a valid (already-arrived) route.
      this.finished = safe.length <= 1
      this.emit({ type: 'route-cleared' })
      return
    }

    this.loading = true
    this.emit({ type: 'route-loading' })

    try {
      const built = await this.buildGeometry(safe)
      if (token !== this.buildToken)
        return // a newer setRoute superseded this build

      this.polyline = built.polyline
      this.cumulative = built.cumulative
      this.waypointMeters = built.waypointMeters
      this.totalMeters = built.cumulative[built.cumulative.length - 1] || 0
      this.position = this.polyline.length ? { ...this.polyline[0] } : this.position
      this.activeIndex = 1
      this.loading = false
      this.emit({ type: 'route-loaded' })
    } catch (error) {
      if (token !== this.buildToken)
        return
      this.loading = false
      this.emit({ type: 'route-error', error })
    }
  }

  /** Clear the route and stop movement. */
  clearRoute() {
    this.buildToken++
    this.pause()
    this.waypoints = []
    this.activeIndex = 0
    this.position = null
    this.polyline = []
    this.cumulative = []
    this.waypointMeters = []
    this.traveledMeters = 0
    this.totalMeters = 0
    this.loading = false
    this.finished = false
    this.lastTickAt = null
    this.emit({ type: 'route-cleared' })
  }

  // --- Route changes (mode-governed) --------------------------------------

  /** A task is currently active while a route exists and is not finished. */
  private hasActiveTask(): boolean {
    return this.waypoints.length > 0 && !this.finished
  }

  /**
   * Replace the current route with a new set of waypoints. Governed by the
   * mode. In Realistic it applies at once; in Strict it is rejected while a
   * task is active; in Manual it is deferred for an explicit decision.
   */
  replaceRoute(waypoints: IRouteWaypoint[], meta?: IRouteChangeMeta): RouteChangeOutcome {
    return this.governRouteChange(
      { kind: 'replace', waypoints, reason: meta?.reason, source: meta?.source },
    )
  }

  /**
   * Append a waypoint to the end of the current route, preserving travelled
   * progress. Governed by the mode, like replaceRoute.
   */
  appendWaypoint(waypoint: IRouteWaypoint, meta?: IRouteChangeMeta): RouteChangeOutcome {
    return this.governRouteChange(
      { kind: 'append', waypoint, reason: meta?.reason, source: meta?.source },
    )
  }

  /**
   * Insert a waypoint at the given index (clamped to [0, length]). The geometry
   * is rebuilt and travel progress is preserved by re-projecting the current
   * position onto the new polyline, so the driver never teleports back to the
   * start. Governed by the mode, like replaceRoute. Inserting at the end is
   * equivalent to appendWaypoint (kept separate so append can extend geometry
   * incrementally without a full rebuild).
   */
  insertWaypoint(index: number, waypoint: IRouteWaypoint, meta?: IRouteChangeMeta): RouteChangeOutcome {
    return this.governRouteChange(
      { kind: 'insert', index, waypoint, reason: meta?.reason, source: meta?.source },
    )
  }

  /**
   * Remove the waypoint at the given index. The geometry is rebuilt and travel
   * progress is preserved by re-projection. Out-of-range indices are ignored.
   * Governed by the mode, like replaceRoute.
   */
  removeWaypoint(index: number, meta?: IRouteChangeMeta): RouteChangeOutcome {
    return this.governRouteChange(
      { kind: 'remove', index, reason: meta?.reason, source: meta?.source },
    )
  }

  private governRouteChange(request: RouteChangeRequest): RouteChangeOutcome {
    if (this.mode === ERouteEmulatorMode.Manual) {
      this.pendingChange = request
      this.emit({ type: 'route-change-pending', request, actions: ['keep', 'apply', 'append'] })
      return 'pending'
    }

    if (this.mode === ERouteEmulatorMode.Strict && this.hasActiveTask()) {
      this.emit({ type: 'route-change-rejected', request, reason: 'strict-locked' })
      return 'rejected'
    }

    // Realistic, or Strict with no active task (starting/extending after finish).
    this.applyRouteChange(request)
    return 'applied'
  }

  private applyRouteChange(request: RouteChangeRequest) {
    const done = () => this.emit({ type: 'route-change-applied', request })
    switch (request.kind) {
      case 'replace':
        void this.setRoute(request.waypoints).then(done)
        break
      case 'append':
        void this.appendWaypointInternal(request.waypoint).then(done)
        break
      case 'insert':
        void this.insertWaypointInternal(request.index, request.waypoint).then(done)
        break
      case 'remove':
        void this.removeWaypointInternal(request.index).then(done)
        break
    }
  }

  /**
   * Resolve the change awaiting a decision in Manual mode. `keep` discards it,
   * `apply` performs the pending request, `append` adds the supplied point to
   * the end instead. No-op when nothing is pending.
   */
  resolveManualChange(resolution: ManualRouteResolution) {
    const pending = this.pendingChange
    this.pendingChange = null
    if (!pending)
      return

    if (resolution.action === 'apply')
      this.applyRouteChange(pending)
    else if (resolution.action === 'append')
      this.applyRouteChange({ kind: 'append', waypoint: resolution.waypoint })

    this.emit({ type: 'route-change-resolved', resolution })
  }

  /**
   * Incrementally extend the built geometry with one more waypoint without
   * resetting travel progress (the passed part of the route is untouched).
   */
  private async appendWaypointInternal(waypoint: IRouteWaypoint): Promise<void> {
    if (!isFiniteGeoPoint(waypoint))
      return

    const next: IRouteWaypoint = { ...waypoint }

    // No geometry yet (empty or single-point route): fall back to a full build.
    if (this.waypoints.length < 1 || this.polyline.length < 1) {
      await this.setRoute([...this.waypoints, next])
      return
    }

    const token = ++this.buildToken
    const from = this.waypoints[this.waypoints.length - 1]

    let segment = await this.routeProvider(
      { lat: from.lat, lng: from.lng },
      { lat: next.lat, lng: next.lng },
    ).catch(() => [] as IGeoPoint[])

    if (token !== this.buildToken)
      return // superseded by a newer change/build

    segment = (segment || []).filter(isFiniteGeoPoint)
    if (segment.length < 2)
      segment = [{ lat: from.lat, lng: from.lng }, { lat: next.lat, lng: next.lng }]

    const tail = this.polyline[this.polyline.length - 1]
    const startIndex = haversineMeters(tail, segment[0]) <= JOINT_DEDUP_METERS ? 1 : 0
    for (let s = startIndex; s < segment.length; s += 1)
      this.polyline.push(segment[s])

    this.waypoints.push(next)
    this.cumulative = getCumulativeDistances(this.polyline)
    this.totalMeters = this.cumulative[this.cumulative.length - 1] || 0
    this.waypointMeters.push(this.totalMeters)
    this.finished = false
    this.emit({ type: 'route-loaded' })
  }

  /** Insert a waypoint into the logical list and rebuild, keeping progress. */
  private async insertWaypointInternal(index: number, waypoint: IRouteWaypoint): Promise<void> {
    if (!isFiniteGeoPoint(waypoint))
      return

    const clamped = Math.max(0, Math.min(Math.trunc(index), this.waypoints.length))
    const next = this.waypoints.slice()
    next.splice(clamped, 0, { ...waypoint })
    await this.rebuildPreservingProgress(next)
  }

  /** Remove a waypoint from the logical list and rebuild, keeping progress. */
  private async removeWaypointInternal(index: number): Promise<void> {
    const target = Math.trunc(index)
    if (target < 0 || target >= this.waypoints.length)
      return

    const next = this.waypoints.slice()
    next.splice(target, 1)
    await this.rebuildPreservingProgress(next)
  }

  /**
   * Rebuild the geometry from a new logical waypoint list while keeping the
   * driver where it is: the previous position is re-projected onto the fresh
   * polyline to derive traveledMeters, and the active-waypoint pointer is
   * recomputed from that distance. Structural edits (insert/remove) thus never
   * teleport the marker back to the start. A list shorter than two points is
   * treated as a degenerate (already-arrived / empty) route, mirroring setRoute.
   */
  private async rebuildPreservingProgress(waypoints: IRouteWaypoint[]): Promise<void> {
    const safe = (waypoints || []).filter(isFiniteGeoPoint).map(point => ({ ...point }))
    const prevPosition = this.position
    const token = ++this.buildToken

    if (safe.length < 2) {
      this.waypoints = safe
      this.activeIndex = 0
      this.position = safe.length ? { lat: safe[0].lat, lng: safe[0].lng } : null
      this.polyline = []
      this.cumulative = []
      this.waypointMeters = []
      this.traveledMeters = 0
      this.totalMeters = 0
      this.finished = safe.length <= 1
      this.lastTickAt = null
      this.emit({ type: 'route-cleared' })
      return
    }

    this.loading = true
    this.emit({ type: 'route-loading' })

    try {
      const built = await this.buildGeometry(safe)
      if (token !== this.buildToken)
        return // superseded by a newer change/build

      this.waypoints = safe
      this.polyline = built.polyline
      this.cumulative = built.cumulative
      this.waypointMeters = built.waypointMeters
      this.totalMeters = built.cumulative[built.cumulative.length - 1] || 0
      this.loading = false

      this.traveledMeters = prevPosition && this.polyline.length > 1 ?
        Math.min(this.totalMeters, projectDistance(this.polyline, this.cumulative, prevPosition)) :
        0
      this.position = pointAtDistance(this.polyline, this.cumulative, this.traveledMeters)
      this.activeIndex = this.computeActiveIndex()
      this.finished = this.traveledMeters >= this.totalMeters - this.reachToleranceMeters
      this.emit({ type: 'route-loaded' })
    } catch (error) {
      if (token !== this.buildToken)
        return
      this.loading = false
      this.emit({ type: 'route-error', error })
    }
  }

  /** First not-yet-reached waypoint given the current travelled distance. */
  private computeActiveIndex(): number {
    let index = 1
    while (
      index < this.waypoints.length &&
      this.traveledMeters >= this.waypointMeters[index] - this.reachToleranceMeters
    )
      index += 1
    return Math.min(index, this.waypoints.length)
  }

  private async buildGeometry(waypoints: IRouteWaypoint[]): Promise<{
    polyline: IGeoPoint[]
    cumulative: number[]
    waypointMeters: number[]
  }> {
    const polyline: IGeoPoint[] = []
    const waypointMeters: number[] = [0]

    for (let i = 1; i < waypoints.length; i += 1) {
      const from = waypoints[i - 1]
      const to = waypoints[i]

      let segment = await this.routeProvider(
        { lat: from.lat, lng: from.lng },
        { lat: to.lat, lng: to.lng },
      ).catch(() => [] as IGeoPoint[])

      segment = (segment || []).filter(isFiniteGeoPoint)
      if (segment.length < 2)
        segment = [{ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }]

      // Drop the joint point shared with the previous segment's tail.
      let startIndex = 0
      if (polyline.length) {
        const tail = polyline[polyline.length - 1]
        if (haversineMeters(tail, segment[0]) <= JOINT_DEDUP_METERS)
          startIndex = 1
      }
      for (let s = startIndex; s < segment.length; s += 1)
        polyline.push(segment[s])

      // Waypoint i sits at the end of segment i-1 → current total polyline length.
      waypointMeters[i] = getPolylineLength(polyline)
    }

    return {
      polyline,
      cumulative: getCumulativeDistances(polyline),
      waypointMeters,
    }
  }

  // --- Movement lifecycle -------------------------------------------------

  /** Start the internal timer that advances movement on each tick. */
  resume() {
    if (this.running)
      return
    this.running = true
    this.lastTickAt = this.now()

    if (typeof setInterval === 'function') {
      this.timer = setInterval(() => {
        const now = this.now()
        const deltaMs = this.lastTickAt === null ? this.tickIntervalMs : now - this.lastTickAt
        this.lastTickAt = now
        this.step(deltaMs)
      }, this.tickIntervalMs)
    }

    this.emit({ type: 'resumed' })
  }

  /** Stop the internal timer. Movement state is preserved. */
  pause() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (!this.running)
      return
    this.running = false
    this.lastTickAt = null
    this.emit({ type: 'paused' })
  }

  /**
   * Advance movement by `deltaMs`. Pure movement math — deterministic for a
   * given delta and current state, so it can be driven by the internal timer
   * or called directly (tests, external game loop) without behaviour change.
   */
  step(deltaMs: number) {
    if (this.finished || this.polyline.length < 2 || this.totalMeters <= 0)
      return

    const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0
    if (delta <= 0)
      return

    const advance = this.speedMps * (delta / 1000)
    if (advance <= 0)
      return

    this.traveledMeters = Math.min(this.totalMeters, this.traveledMeters + advance)
    this.position = pointAtDistance(this.polyline, this.cumulative, this.traveledMeters)
    this.emit({ type: 'tick', position: { ...this.position } })

    this.checkWaypointArrivals()

    if (this.traveledMeters >= this.totalMeters - this.reachToleranceMeters && !this.finished) {
      this.finished = true
      this.pause()
      this.emit({ type: 'finished' })
    }
  }

  private checkWaypointArrivals() {
    while (
      this.activeIndex < this.waypoints.length &&
      this.traveledMeters >= this.waypointMeters[this.activeIndex] - this.reachToleranceMeters
    ) {
      const index = this.activeIndex
      this.activeIndex += 1
      this.emit({ type: 'waypoint-reached', waypoint: { ...this.waypoints[index] }, index })
    }
  }

  /**
   * Restore progress along the current route without advancing the clock. Used to
   * re-hydrate the marker at its previous distance after the owning view remounts
   * (a fresh setRoute otherwise resets traveledMeters to 0). Recomputes the active
   * waypoint pointer and finished flag; emits a tick so subscribers resync. No
   * waypoint-reached events are replayed — this is a silent seek, not travel.
   */
  seek(meters: number) {
    if (this.polyline.length < 2 || this.totalMeters <= 0)
      return

    this.traveledMeters = Math.max(0, Math.min(this.totalMeters, Number.isFinite(meters) ? meters : 0))
    this.position = pointAtDistance(this.polyline, this.cumulative, this.traveledMeters)

    this.activeIndex = 0
    while (
      this.activeIndex < this.waypoints.length &&
      this.traveledMeters >= this.waypointMeters[this.activeIndex] - this.reachToleranceMeters
    )
      this.activeIndex += 1

    this.finished = this.traveledMeters >= this.totalMeters - this.reachToleranceMeters
    this.emit({ type: 'tick', position: { ...this.position } })
  }

  /** Release timers and listeners. */
  destroy() {
    this.pause()
    this.buildToken++
    this.listeners.clear()
  }
}

function getPolylineLength(points: IGeoPoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1)
    total += Math.max(0, haversineMeters(points[i - 1], points[i]))
  return total
}

function getCumulativeDistances(points: IGeoPoint[]): number[] {
  const cumulative = points.length ? [0] : []
  for (let i = 1; i < points.length; i += 1)
    cumulative[i] = cumulative[i - 1] + Math.max(0, haversineMeters(points[i - 1], points[i]))
  return cumulative
}

function pointAtDistance(
  points: IGeoPoint[],
  cumulative: number[],
  distanceMeters: number,
): IGeoPoint {
  if (!points.length)
    return { lat: 0, lng: 0 }
  if (points.length === 1)
    return { ...points[0] }

  const total = cumulative[cumulative.length - 1] || 0
  const target = Math.max(0, Math.min(distanceMeters, total))

  for (let i = 1; i < points.length; i += 1) {
    if (cumulative[i] >= target) {
      const segmentMeters = cumulative[i] - cumulative[i - 1]
      const ratio = segmentMeters > 0 ? (target - cumulative[i - 1]) / segmentMeters : 0
      return interpolate(points[i - 1], points[i], ratio)
    }
  }

  return { ...points[points.length - 1] }
}

/**
 * Project a position onto one polyline segment using a local equirectangular
 * approximation (good enough at street scale), returning the closest point and
 * how far along the segment it sits (meters). Used to preserve travel progress
 * across structural route edits without teleporting the marker.
 */
function projectOnSegment(a: IGeoPoint, b: IGeoPoint, p: IGeoPoint): { point: IGeoPoint; along: number } {
  const cosLat = Math.cos(toRad(a.lat))
  const bx = (b.lng - a.lng) * cosLat
  const by = b.lat - a.lat
  const px = (p.lng - a.lng) * cosLat
  const py = p.lat - a.lat
  const lenSq = bx * bx + by * by
  const t = lenSq > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / lenSq)) : 0
  const point = interpolate(a, b, t)
  return { point, along: haversineMeters(a, point) }
}

/** Arc length (meters) of the polyline point nearest to `position`. */
function projectDistance(points: IGeoPoint[], cumulative: number[], position: IGeoPoint): number {
  if (points.length < 2)
    return 0

  let bestDistance = Infinity
  let bestArcLength = 0
  for (let i = 1; i < points.length; i += 1) {
    const projection = projectOnSegment(points[i - 1], points[i], position)
    const distance = haversineMeters(projection.point, position)
    if (distance < bestDistance) {
      bestDistance = distance
      bestArcLength = cumulative[i - 1] + projection.along
    }
  }
  return bestArcLength
}
