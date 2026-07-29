import {
  DriverRouteEmulator,
  DEFAULT_MANUAL_DECISION_ACTIONS,
  EDriverExternalEventType,
  EManualDecisionAction,
  ERouteEmulatorMode,
  ERouteWaypointType,
  IGeoPoint,
  IManualDecisionRequest,
  IRouteWaypoint,
  RouteEmulatorEvent,
  RouteProvider,
} from './driverRouteEmulator'

/**
 * Straight-line provider: densifies the segment between two points so the
 * model has a real polyline to travel along. Keeps tests deterministic
 * (no network, no timers).
 */
const straightLineProvider = (steps = 20): RouteProvider => (from, to) => {
  const points: IGeoPoint[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    points.push({
      lat: from.lat + (to.lat - from.lat) * t,
      lng: from.lng + (to.lng - from.lng) * t,
    })
  }
  return Promise.resolve(points)
}

const waypoint = (
  lat: number,
  lng: number,
  type = ERouteWaypointType.Custom,
): IRouteWaypoint => ({ lat, lng, type })

describe('DriverRouteEmulator', () => {
  it('builds geometry from waypoints via the injected provider', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    await emulator.setRoute([
      waypoint(47.22, 39.63, ERouteWaypointType.Pickup),
      waypoint(47.23, 39.64, ERouteWaypointType.Dropoff),
    ])

    const state = emulator.getState()
    expect(state.loading).toBe(false)
    expect(state.polyline.length).toBeGreaterThan(2)
    expect(state.totalMeters).toBeGreaterThan(0)
    expect(state.activeIndex).toBe(1)
    expect(state.position).toEqual({ lat: 47.22, lng: 39.63 })
    emulator.destroy()
  })

  it('moves along the route and reaches waypoints in order, then finishes', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 50,
    })

    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(event => events.push(event))

    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.21, 39.61, ERouteWaypointType.Boarding),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    // Advance in 1s ticks well beyond the total route length.
    for (let i = 0; i < 200 && !emulator.getState().finished; i += 1)
      emulator.step(1000)

    const reached = events.filter(e => e.type === 'waypoint-reached') as Array<
      Extract<RouteEmulatorEvent, { type: 'waypoint-reached' }>
    >

    expect(reached.map(e => e.index)).toEqual([1, 2])
    expect(reached[0].waypoint.type).toBe(ERouteWaypointType.Boarding)
    expect(reached[1].waypoint.type).toBe(ERouteWaypointType.Dropoff)
    expect(events.some(e => e.type === 'finished')).toBe(true)
    expect(emulator.getState().finished).toBe(true)
    emulator.destroy()
  })

  it('seek restores travelled distance without replaying waypoint-reached events', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 50,
    })

    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    // Drive partway and remember how far we got.
    for (let i = 0; i < 5; i += 1)
      emulator.step(1000)
    const travelled = emulator.getState().traveledMeters
    const position = emulator.getState().position
    expect(travelled).toBeGreaterThan(0)

    // A fresh setRoute resets progress to 0 (what happens on a view remount).
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])
    expect(emulator.getState().traveledMeters).toBe(0)

    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(event => events.push(event))
    emulator.seek(travelled)

    const restored = emulator.getState()
    expect(restored.traveledMeters).toBeCloseTo(travelled, 3)
    expect(restored.position?.lat).toBeCloseTo(position!.lat, 5)
    expect(restored.position?.lng).toBeCloseTo(position!.lng, 5)
    expect(restored.finished).toBe(false)
    expect(events.some(e => e.type === 'tick')).toBe(true)
    expect(events.some(e => e.type === 'waypoint-reached')).toBe(false)
    emulator.destroy()
  })

  it('does not move before enough distance is covered and emits tick on movement', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 10,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60),
      waypoint(47.30, 39.70),
    ])

    const start = emulator.getState().position!
    let ticks = 0
    emulator.subscribe(event => {
      if (event.type === 'tick') ticks += 1
    })

    emulator.step(1000)
    const moved = emulator.getState().position!

    expect(ticks).toBe(1)
    expect(moved).not.toEqual(start)
    expect(emulator.getState().traveledMeters).toBeGreaterThan(0)
    emulator.destroy()
  })

  it('treats a single-waypoint route as already finished', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    await emulator.setRoute([waypoint(47.20, 39.60, ERouteWaypointType.Pickup)])

    const state = emulator.getState()
    expect(state.finished).toBe(true)
    expect(state.polyline.length).toBe(0)
    expect(state.position).toEqual({ lat: 47.20, lng: 39.60 })
    emulator.destroy()
  })

  it('ignores a stale build when the route is replaced mid-build', async () => {
    const pending: Array<(points: IGeoPoint[]) => void> = []
    let useSlow = true
    const fast = straightLineProvider()
    const provider: RouteProvider = (from, to) => {
      if (useSlow)
        return new Promise<IGeoPoint[]>(resolve => pending.push(resolve))
      return fast(from, to)
    }

    const emulator = new DriverRouteEmulator({ routeProvider: provider })

    // First (slow) build starts but does not resolve yet.
    const firstBuild = emulator.setRoute([waypoint(47.2, 39.6), waypoint(47.3, 39.7)])
    expect(emulator.getState().loading).toBe(true)

    // Replace with a fast build that completes immediately.
    useSlow = false
    await emulator.setRoute([waypoint(0, 0), waypoint(0.02, 0.02)])
    const afterFast = emulator.getState()
    expect(afterFast.loading).toBe(false)
    expect(afterFast.polyline[0]).toEqual({ lat: 0, lng: 0 })

    // Resolving the stale first build must not overwrite the current state.
    pending.forEach(resolve => resolve([
      { lat: 47.2, lng: 39.6 },
      { lat: 47.3, lng: 39.7 },
    ]))
    await firstBuild
    expect(emulator.getState().polyline[0]).toEqual({ lat: 0, lng: 0 })
    emulator.destroy()
  })
})

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

async function withActiveRoute(mode: ERouteEmulatorMode) {
  const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider(), mode })
  await emulator.setRoute([
    waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
    waypoint(47.21, 39.61, ERouteWaypointType.Dropoff),
  ])
  return emulator
}

describe('DriverRouteEmulator modes', () => {
  it('defaults to Realistic', () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    expect(emulator.getMode()).toBe(ERouteEmulatorMode.Realistic)
    emulator.destroy()
  })

  it('Strict rejects route changes while a task is active', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Strict)
    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(e => events.push(e))

    const outcome = emulator.replaceRoute([waypoint(0, 0), waypoint(0.02, 0.02)])
    await flush()

    expect(outcome).toBe('rejected')
    expect(events.some(e => e.type === 'route-change-rejected')).toBe(true)
    // Route is untouched.
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 47.20, lng: 39.60 })
    emulator.destroy()
  })

  it('Strict allows a change once the task is finished', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Strict,
      speedMps: 100,
    })
    await emulator.setRoute([waypoint(47.20, 39.60), waypoint(47.205, 39.605)])
    for (let i = 0; i < 200 && !emulator.getState().finished; i += 1)
      emulator.step(1000)
    expect(emulator.getState().finished).toBe(true)

    const outcome = emulator.replaceRoute([waypoint(0, 0), waypoint(0.02, 0.02)])
    await flush()
    expect(outcome).toBe('applied')
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 0, lng: 0 })
    emulator.destroy()
  })

  it('Realistic applies route changes immediately', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Realistic)
    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(e => events.push(e))

    const outcome = emulator.replaceRoute([waypoint(1, 1), waypoint(1.02, 1.02)])
    await flush()

    expect(outcome).toBe('applied')
    expect(events.some(e => e.type === 'route-change-applied')).toBe(true)
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 1, lng: 1 })
    emulator.destroy()
  })

  it('Realistic append extends the route preserving travel progress', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Realistic,
      speedMps: 30,
    })
    await emulator.setRoute([waypoint(47.20, 39.60), waypoint(47.21, 39.61)])
    emulator.step(1000)
    const traveledBefore = emulator.getState().traveledMeters
    const totalBefore = emulator.getState().totalMeters
    expect(traveledBefore).toBeGreaterThan(0)

    emulator.appendWaypoint(waypoint(47.22, 39.62, ERouteWaypointType.Dropoff))
    await flush()

    const state = emulator.getState()
    expect(state.waypoints.length).toBe(3)
    expect(state.totalMeters).toBeGreaterThan(totalBefore)
    // Progress is preserved (no teleport back to start).
    expect(state.traveledMeters).toBeCloseTo(traveledBefore, 5)
    expect(state.finished).toBe(false)
    emulator.destroy()
  })

  it('Manual defers a change and applies it only on explicit apply', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Manual)
    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(e => events.push(e))

    const outcome = emulator.replaceRoute([waypoint(2, 2), waypoint(2.02, 2.02)])
    await flush()

    expect(outcome).toBe('pending')
    expect(events.some(e => e.type === 'route-change-pending')).toBe(true)
    // Not applied yet.
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 47.20, lng: 39.60 })
    expect(emulator.getState().pendingChange).toMatchObject({ kind: 'replace' })

    emulator.resolveManualChange({ action: 'apply' })
    await flush()
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 2, lng: 2 })
    expect(emulator.getState().pendingChange).toBeNull()
    emulator.destroy()
  })

  it('Manual keep discards the pending change', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Manual)
    emulator.replaceRoute([waypoint(3, 3), waypoint(3.02, 3.02)])
    await flush()

    emulator.resolveManualChange({ action: 'keep' })
    await flush()
    expect(emulator.getState().waypoints[0]).toMatchObject({ lat: 47.20, lng: 39.60 })
    expect(emulator.getState().pendingChange).toBeNull()
    emulator.destroy()
  })

  it('Manual append-to-end adds the chosen point regardless of the pending request', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Manual)
    // A replace was suggested, but the user chooses to append a point instead.
    emulator.replaceRoute([waypoint(4, 4), waypoint(4.02, 4.02)])
    await flush()

    emulator.resolveManualChange({
      action: 'append',
      waypoint: waypoint(47.22, 39.62, ERouteWaypointType.Custom),
    })
    await flush()

    const state = emulator.getState()
    expect(state.waypoints.length).toBe(3)
    expect(state.waypoints[2]).toMatchObject({ lat: 47.22, lng: 39.62 })
    // The suggested replace was NOT applied.
    expect(state.waypoints[0]).toMatchObject({ lat: 47.20, lng: 39.60 })
    emulator.destroy()
  })

  it('switching away from Manual drops a pending change', async () => {
    const emulator = await withActiveRoute(ERouteEmulatorMode.Manual)
    emulator.replaceRoute([waypoint(5, 5), waypoint(5.02, 5.02)])
    await flush()
    expect(emulator.getState().pendingChange).not.toBeNull()

    emulator.setMode(ERouteEmulatorMode.Realistic)
    expect(emulator.getState().pendingChange).toBeNull()
    expect(emulator.getMode()).toBe(ERouteEmulatorMode.Realistic)
    emulator.destroy()
  })
})

describe('DriverRouteEmulator mutation API (insert/remove)', () => {
  it('insertWaypoint adds a middle point and preserves travel progress', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 30,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])
    emulator.step(1000)
    const traveledBefore = emulator.getState().traveledMeters
    expect(traveledBefore).toBeGreaterThan(0)

    // Insert the collinear midpoint: total length is unchanged, so progress is
    // preserved (the marker must not teleport back to the start).
    const outcome = emulator.insertWaypoint(1, waypoint(47.21, 39.61, ERouteWaypointType.Boarding))
    await flush()

    const state = emulator.getState()
    expect(outcome).toBe('applied')
    expect(state.waypoints.length).toBe(3)
    expect(state.waypoints[1].type).toBe(ERouteWaypointType.Boarding)
    expect(state.traveledMeters).toBeCloseTo(traveledBefore, 0)
    expect(state.position).not.toEqual({ lat: 47.20, lng: 39.60 })
    emulator.destroy()
  })

  it('insertWaypoint clamps an out-of-range index to the end', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    await emulator.setRoute([waypoint(47.20, 39.60), waypoint(47.21, 39.61)])

    emulator.insertWaypoint(99, waypoint(47.22, 39.62, ERouteWaypointType.Custom))
    await flush()

    const state = emulator.getState()
    expect(state.waypoints.length).toBe(3)
    expect(state.waypoints[2]).toMatchObject({ lat: 47.22, lng: 39.62 })
    emulator.destroy()
  })

  it('removeWaypoint drops a waypoint and keeps travel progress', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 20,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.21, 39.61, ERouteWaypointType.Boarding),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])
    emulator.step(1000)
    const traveledBefore = emulator.getState().traveledMeters
    expect(traveledBefore).toBeGreaterThan(0)

    const outcome = emulator.removeWaypoint(1)
    await flush()

    const state = emulator.getState()
    expect(outcome).toBe('applied')
    expect(state.waypoints.length).toBe(2)
    expect(state.waypoints.map(point => point.type)).toEqual([
      ERouteWaypointType.Pickup,
      ERouteWaypointType.Dropoff,
    ])
    expect(state.traveledMeters).toBeCloseTo(traveledBefore, 0)
    emulator.destroy()
  })

  it('removeWaypoint ignores an out-of-range index', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    await emulator.setRoute([
      waypoint(47.20, 39.60),
      waypoint(47.21, 39.61),
      waypoint(47.22, 39.62),
    ])

    emulator.removeWaypoint(9)
    await flush()
    expect(emulator.getState().waypoints.length).toBe(3)
    emulator.destroy()
  })

  it('Strict rejects insert/remove while a task is active', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Strict,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    expect(emulator.insertWaypoint(1, waypoint(47.21, 39.61))).toBe('rejected')
    expect(emulator.removeWaypoint(0)).toBe('rejected')
    await flush()
    expect(emulator.getState().waypoints.length).toBe(2)
    emulator.destroy()
  })

  it('Manual defers an insert and applies it on explicit apply', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Manual,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    const outcome = emulator.insertWaypoint(1, waypoint(47.21, 39.61, ERouteWaypointType.Boarding))
    await flush()
    expect(outcome).toBe('pending')
    expect(emulator.getState().waypoints.length).toBe(2)
    expect(emulator.getState().pendingChange).toMatchObject({ kind: 'insert', index: 1 })

    emulator.resolveManualChange({ action: 'apply' })
    await flush()
    const state = emulator.getState()
    expect(state.waypoints.length).toBe(3)
    expect(state.waypoints[1].type).toBe(ERouteWaypointType.Boarding)
    expect(state.pendingChange).toBeNull()
    emulator.destroy()
  })
})

describe('DriverRouteEmulator control API (task 7)', () => {
  it('exposes the active waypoint and advances it as waypoints are reached', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 60,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.21, 39.61, ERouteWaypointType.Boarding),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    // Heading to the first not-yet-reached waypoint.
    expect(emulator.getActiveWaypoint()?.type).toBe(ERouteWaypointType.Boarding)

    for (let i = 0; i < 200 && !emulator.getState().finished; i += 1)
      emulator.step(1000)

    // Route finished: nothing left to head to.
    expect(emulator.getActiveWaypoint()).toBeNull()
    emulator.destroy()
  })

  it('changes speed at runtime and reflects it in state', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 10,
    })
    await emulator.setRoute([waypoint(47.20, 39.60), waypoint(47.60, 40.00)])

    emulator.step(1000)
    const slowTravel = emulator.getState().traveledMeters

    emulator.setSpeed(40)
    expect(emulator.getSpeed()).toBe(40)
    expect(emulator.getState().speedMps).toBe(40)

    emulator.step(1000)
    const fastTravel = emulator.getState().traveledMeters - slowTravel
    // The faster leg covered more ground in the same 1s tick.
    expect(fastTravel).toBeGreaterThan(slowTravel)
    emulator.destroy()
  })

  it('ignores invalid speed values', () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider(), speedMps: 24 })
    emulator.setSpeed(0)
    emulator.setSpeed(-5)
    emulator.setSpeed(Number.NaN)
    expect(emulator.getSpeed()).toBe(24)
    emulator.destroy()
  })
})

describe('DriverRouteEmulator external events (dispatch)', () => {
  it('re-transmits external events without touching the route', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(event => events.push(event))
    const waypointsBefore = emulator.getState().waypoints.length

    emulator.dispatch({
      type: EDriverExternalEventType.NewOrder,
      orderId: 'order-1',
      pickup: { lat: 47.25, lng: 39.65 },
    })

    const external = events.filter(event => event.type === 'external-event') as Array<
      Extract<RouteEmulatorEvent, { type: 'external-event' }>
    >
    expect(external.length).toBe(1)
    expect(external[0].event.type).toBe(EDriverExternalEventType.NewOrder)
    expect(external[0].event.orderId).toBe('order-1')
    // The model must NOT mutate the route in response to an event.
    expect(emulator.getState().waypoints.length).toBe(waypointsBefore)
    emulator.destroy()
  })

  it('does not request a manual decision in Realistic mode', () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(event => events.push(event))

    emulator.dispatch({ type: EDriverExternalEventType.NewOrder, orderId: 'order-1' })

    expect(events.some(event => event.type === 'external-event')).toBe(true)
    expect(events.some(event => event.type === 'manual-decision-required')).toBe(false)
    emulator.destroy()
  })

  it('publishes MANUAL_DECISION_REQUIRED in Manual mode with the original event and offered actions', () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Manual,
    })
    const events: RouteEmulatorEvent[] = []
    emulator.subscribe(event => events.push(event))

    const originalEvent = { type: EDriverExternalEventType.NewOrder, orderId: 'order-1' }
    emulator.dispatch(originalEvent)

    // The event is still re-transmitted; the decision notification is additional.
    expect(events.some(event => event.type === 'external-event')).toBe(true)
    const decision = events.find(event => event.type === 'manual-decision-required') as
      Extract<RouteEmulatorEvent, { type: 'manual-decision-required' }> | undefined
    expect(decision).toBeDefined()
    expect(decision?.originalEvent.orderId).toBe('order-1')
    expect(decision?.actions).toEqual(DEFAULT_MANUAL_DECISION_ACTIONS)
    // The model decides nothing on its own — the route is untouched.
    expect(emulator.getState().waypoints.length).toBe(0)
    emulator.destroy()
  })

  it('onDecisionRequired delivers only the manual-decision notifications', () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Manual,
    })
    const decisions: IManualDecisionRequest[] = []
    const unsubscribe = emulator.onDecisionRequired(decision => decisions.push(decision))

    emulator.dispatch({ type: EDriverExternalEventType.NewVotingOrder, orderId: 'vote-1' })

    expect(decisions.length).toBe(1)
    expect(decisions[0].originalEvent.type).toBe(EDriverExternalEventType.NewVotingOrder)
    expect(decisions[0].actions).toContain(EManualDecisionAction.ReplaceRoute)
    expect(decisions[0].actions).toContain(EManualDecisionAction.AppendPoint)

    unsubscribe()
    emulator.dispatch({ type: EDriverExternalEventType.NewOrder, orderId: 'order-2' })
    expect(decisions.length).toBe(1)
    emulator.destroy()
  })
})

describe('DriverRouteEmulator voting and along-the-way orders (tasks 9-10)', () => {
  const externalTypes = (emulator: DriverRouteEmulator) => {
    const seen: string[] = []
    emulator.subscribe(event => {
      if (event.type === 'external-event')
        seen.push(String(event.event.type))
    })
    return seen
  }

  it('runs the voting flow entirely through dispatch + the change API (the model decides nothing)', async () => {
    const emulator = new DriverRouteEmulator({ routeProvider: straightLineProvider() })
    const seen = externalTypes(emulator)

    // A voting order appears — the model just re-transmits it.
    emulator.dispatch({
      type: EDriverExternalEventType.NewVotingOrder,
      orderId: 'v1',
      pickup: { lat: 47.20, lng: 39.60 },
    })
    // Route is untouched until an outside caller (FSM stand-in) acts.
    expect(emulator.getState().waypoints.length).toBe(0)

    // FSM decides: only heading to pickup for now.
    emulator.replaceRoute([waypoint(47.20, 39.60, ERouteWaypointType.Pickup)])
    await flush()
    expect(emulator.getState().waypoints.map(point => point.type)).toEqual([ERouteWaypointType.Pickup])

    // The driver won the vote — now there is a destination.
    emulator.dispatch({
      type: EDriverExternalEventType.VotingWon,
      orderId: 'v1',
      dropoff: { lat: 47.22, lng: 39.62 },
    })
    emulator.appendWaypoint(waypoint(47.22, 39.62, ERouteWaypointType.Dropoff))
    await flush()

    expect(emulator.getState().waypoints.map(point => point.type)).toEqual([
      ERouteWaypointType.Pickup,
      ERouteWaypointType.Dropoff,
    ])
    expect(seen).toEqual([
      EDriverExternalEventType.NewVotingOrder,
      EDriverExternalEventType.VotingWon,
    ])
    emulator.destroy()
  })

  it('routes voting events through the mode handler: Strict rejects a change while active', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Strict,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.22, 39.62, ERouteWaypointType.Dropoff),
    ])

    emulator.dispatch({ type: EDriverExternalEventType.VotingWon, orderId: 'v1' })
    // A caller reacting to the event still goes through the mode gate.
    const outcome = emulator.appendWaypoint(waypoint(47.24, 39.64, ERouteWaypointType.Custom))
    await flush()

    expect(outcome).toBe('rejected')
    expect(emulator.getState().waypoints.length).toBe(2)
    emulator.destroy()
  })

  it('lets an along-the-way order be taken via the change API in Realistic mode', async () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      speedMps: 30,
    })
    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.26, 39.66, ERouteWaypointType.Dropoff),
    ])
    emulator.step(1000)
    const seen = externalTypes(emulator)

    emulator.dispatch({
      type: EDriverExternalEventType.NewAlongTheWayOrder,
      orderId: 'a1',
      pickup: { lat: 47.23, lng: 39.63 },
    })
    // Model made no decision; a caller chooses to insert a mid-route stop.
    emulator.insertWaypoint(1, waypoint(47.23, 39.63, ERouteWaypointType.Custom))
    await flush()

    expect(emulator.getState().waypoints.length).toBe(3)
    expect(seen).toEqual([EDriverExternalEventType.NewAlongTheWayOrder])
    emulator.destroy()
  })

  it('notifies (does not decide) about an along-the-way order in Manual mode', () => {
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(),
      mode: ERouteEmulatorMode.Manual,
    })
    const decisions: IManualDecisionRequest[] = []
    emulator.onDecisionRequired(decision => decisions.push(decision))

    emulator.dispatch({ type: EDriverExternalEventType.NewAlongTheWayOrder, orderId: 'a1' })

    expect(decisions.length).toBe(1)
    expect(decisions[0].originalEvent.type).toBe(EDriverExternalEventType.NewAlongTheWayOrder)
    expect(decisions[0].actions).toContain(EManualDecisionAction.ReplaceRoute)
    // No automatic route change.
    expect(emulator.getState().waypoints.length).toBe(0)
    emulator.destroy()
  })
})

describe('DriverRouteEmulator auto-tick nominal step (stall immunity)', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('advances by a fixed nominal step per auto-tick, ignoring how late the tick fired', async() => {
    // A long, dense route so a single nominal step cannot reach the end (no finish).
    let clock = 0
    const emulator = new DriverRouteEmulator({
      routeProvider: straightLineProvider(400),
      speedMps: 10,
      tickIntervalMs: 1000,
      now: () => clock,
    })

    await emulator.setRoute([
      waypoint(47.20, 39.60, ERouteWaypointType.Pickup),
      waypoint(47.40, 39.80, ERouteWaypointType.Dropoff),
    ])

    jest.useFakeTimers()
    emulator.resume() // lastTickAt = now() = 0

    // Simulate a multi-second main-thread stall: wall-clock jumps 10 s but the
    // interval still only fires once. A wall-clock-driven implementation would
    // convert the whole 10 s gap to 100 m in one step (a visible teleport); the
    // nominal-step implementation always advances by exactly
    // speedMps × tickIntervalMs, i.e. 10 m, regardless of the real gap.
    clock = 10000
    jest.advanceTimersByTime(1000)

    expect(emulator.getState().traveledMeters).toBeCloseTo(10, 3)

    // A second, on-time tick advances by the same nominal amount again — no
    // compensation is ever applied for the earlier stall.
    clock = 11000
    jest.advanceTimersByTime(1000)

    expect(emulator.getState().traveledMeters).toBeCloseTo(20, 3)

    emulator.pause()
    emulator.destroy()
  })
})
