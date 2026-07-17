import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import L from 'leaflet'
import {
  MapContainer, Marker, TileLayer, Polyline,
  Popup, Tooltip, useMap,
} from 'react-leaflet'
import {
  EBookingDriverState,
  EOrderProfitRank,
  IAddressPoint,
  IOrder,
  IRouteInfo,
  IUser,
} from '../../types/types'
import { IWayGraph } from '../../tools/maps'
import { makeRoutePointsSafe } from '../../tools/route'
import { DriverRouteEmulator, ERouteWaypointType } from '../../tools/driverRouteEmulator'
import { DriverOrderEventAdapter } from '../../tools/driverOrderEventAdapter'
import {
  subscribeDriverRouteEmulatorCommand,
  emitDriverRouteEmulatorNotification,
} from '../../tools/driverRouteEmulatorCommandBus'
import { useCachedState } from '../../tools/hooks'
import images from '../../constants/images'
import {
  dateFormatTimeShort,
  distanceBetweenEarthCoordinates,
  getAttribution,
  getTileServerUrl,
  formatCurrency,
  HIGH_ACCURACY_GEOLOCATION_OPTIONS,
} from '../../tools/utils'
import { useInterval } from '../../tools/hooks'
import SITE_CONSTANTS from '../../siteConstants'
import * as API from '../../API'
import { orderActionCreators } from '../../state/order'
import { ordersActionCreators } from '../../state/orders'
import { modalsActionCreators } from '../../state/modals'
import { areasActionCreators, areasSelectors } from '../../state/areas'
import { IRootState } from '../../state'
import { t, TRANSLATION } from '../../localization'
import PageSection from '../../components/PageSection'
import Button from '../../components/Button'
import SmoothRotatingMarker from '../../components/SmoothRotatingMarker'
import { EDriverTabs } from '.'
import { isOfferOrder, isVotingOrder } from '../../tools/driverOffer'
import { BROWSER_EMULATOR_STATE_EVENT, isBrowserEmulatorRunning } from '../../tools/emulatorMode'
import { writeFlowEvent } from '../../tools/flowLog'
import { writeRawLog } from '../../tools/rawLog'
import { summarizeOrder } from '../../tools/frontendLog'
import './styles.scss'

const cachedDriverMapStateKey = 'cachedDriverMapState'
const DRIVER_STARTED_VOTING_ORDERS_STORAGE_KEY = 'driverStartedVotingOrderIds'
const SAVED_GEOLOCATION_KEY = 'gruzvill_last_browser_geolocation'

const KNOWN_LEAFLET_LIFECYCLE_ERRORS = [
  'Map container is being reused by another instance',
  'Map container not found',
  "Cannot read properties of undefined (reading '_leaflet_pos')",
  "Cannot read property '_leaflet_pos' of undefined",
  "Cannot read properties of null (reading '_leaflet_pos')",
  "Cannot read property '_leaflet_pos' of null",
  "Cannot read properties of undefined (reading '_leaflet_events')",
  "Cannot read property '_leaflet_events' of undefined",
  "Cannot read properties of null (reading '_leaflet_events')",
  "Cannot read property '_leaflet_events' of null",
  "Cannot read properties of undefined (reading 'appendChild')",
  "Cannot read property 'appendChild' of undefined",
  "Cannot read properties of null (reading 'appendChild')",
  "Cannot read property 'appendChild' of null",
  "Cannot read properties of undefined (reading 'parentNode')",
  "Cannot read property 'parentNode' of undefined",
  "Cannot read properties of null (reading 'parentNode')",
  "Cannot read property 'parentNode' of null",
]

function isKnownLeafletLifecycleError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return KNOWN_LEAFLET_LIFECYCLE_ERRORS.some(item => message.includes(item))
}

function isLeafletMapConnected(map?: L.Map | null) {
  try {
    const container = map?.getContainer?.()
    return Boolean(container && container.isConnected)
  } catch (_) {
    return false
  }
}

function isLeafletRuntimeReady(map?: L.Map | null) {
  try {
    const panes = (map as any)?._panes
    return Boolean(
      isLeafletMapConnected(map) &&
      panes?.mapPane &&
      panes?.tilePane &&
      panes?.overlayPane &&
      panes?.markerPane &&
      panes?.popupPane,
    )
  } catch (_) {
    return false
  }
}

function cleanupStaleDriverMarkerDom(marker: any) {
  const icon = marker?._icon
  const shadow = marker?._shadow

  try {
    if (icon && icon.parentNode)
      icon.parentNode.removeChild(icon)
  } catch (_) {}

  try {
    if (shadow && shadow.parentNode)
      shadow.parentNode.removeChild(shadow)
  } catch (_) {}

  try {
    marker._icon = null
    marker._shadow = null
  } catch (_) {}
}

function patchLeafletLifecycleForDriverMap() {
  const layerPrototype = (L.Layer as any)?.prototype
  if (layerPrototype && !layerPrototype.__driverSafeLayerAddPatched) {
    const originalLayerAdd = layerPrototype._layerAdd
    if (typeof originalLayerAdd === 'function') {
      layerPrototype._layerAdd = function driverSafeLayerAdd(event: any) {
        const map = event?.target || this?._map
        if (!isLeafletRuntimeReady(map))
          return this

        try {
          return originalLayerAdd.call(this, event)
        } catch (error) {
          if (!isKnownLeafletLifecycleError(error))
            throw error

          return this
        }
      }
      layerPrototype.__driverSafeLayerAddPatched = true
    }
  }

  const domEvent = (L.DomEvent as any)
  if (domEvent && !domEvent.__gruzvillSafeOffPatched) {
    const originalOff = domEvent.off
    if (typeof originalOff === 'function') {
      domEvent.off = function gruzvillSafeDomOff(...args: any[]) {
        const target = args[0]
        if (!target)
          return this

        try {
          return originalOff.apply(this, args)
        } catch (error) {
          if (!isKnownLeafletLifecycleError(error))
            throw error

          return this
        }
      }
      domEvent.__gruzvillSafeOffPatched = true
    }
  }

  const domUtil = (L.DomUtil as any)
  if (domUtil && !domUtil.__gruzvillSafeRemovePatched) {
    const originalRemove = domUtil.remove
    if (typeof originalRemove === 'function') {
      domUtil.remove = function gruzvillSafeDomRemove(element: any) {
        if (!element || !element.parentNode)
          return undefined

        try {
          return originalRemove.call(this, element)
        } catch (error) {
          if (!isKnownLeafletLifecycleError(error))
            throw error

          return undefined
        }
      }
      domUtil.__gruzvillSafeRemovePatched = true
    }
  }

  const mapPrototype = (L.Map as any)?.prototype
  if (mapPrototype && !mapPrototype.__gruzvillSafeRemoveLayerPatched) {
    const originalRemoveLayer = mapPrototype.removeLayer
    if (typeof originalRemoveLayer === 'function') {
      mapPrototype.removeLayer = function gruzvillSafeRemoveLayer(layer: any) {
        if (!layer)
          return this

        try {
          return originalRemoveLayer.call(this, layer)
        } catch (error) {
          if (!isKnownLeafletLifecycleError(error))
            throw error

          try {
            const layerId = (L.Util as any).stamp(layer)
            if (this?._layers)
              delete this._layers[layerId]
          } catch (_) {}

          return this
        }
      }
      mapPrototype.__gruzvillSafeRemoveLayerPatched = true
    }
  }

  const markerPrototype = (L.Marker as any)?.prototype
  if (markerPrototype && !markerPrototype.__gruzvillSafeOnRemovePatched) {
    const originalOnRemove = markerPrototype.onRemove
    if (typeof originalOnRemove === 'function') {
      markerPrototype.onRemove = function gruzvillSafeMarkerOnRemove(map: any) {
        try {
          if (!map || !isLeafletMapConnected(map)) {
            cleanupStaleDriverMarkerDom(this)
            return this
          }

          return originalOnRemove.call(this, map)
        } catch (error) {
          if (!isKnownLeafletLifecycleError(error))
            throw error

          cleanupStaleDriverMarkerDom(this)
          return this
        }
      }
      markerPrototype.__gruzvillSafeOnRemovePatched = true
    }
  }
}

function safeLeafletAction(action: () => void) {
  try {
    action()
  } catch (error) {
    if (!isKnownLeafletLifecycleError(error))
      throw error
  }
}

patchLeafletLifecycleForDriverMap()

function saveLastBrowserGeolocation(point: { latitude: number, longitude: number }) {
  try {
    window.localStorage.setItem(SAVED_GEOLOCATION_KEY, JSON.stringify({
      ...point,
      timestamp: Date.now(),
      source: 'driver-map',
    }))
  } catch {
    // ignore storage errors
  }
}

function getSavedDriverMapPosition(): L.LatLngExpression | undefined {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SAVED_GEOLOCATION_KEY) || 'null')
    const latitude = Number(parsed?.latitude)
    const longitude = Number(parsed?.longitude)
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? [latitude, longitude] : undefined
  } catch {
    return undefined
  }
}

function trimRoutePointsToPosition(points: Array<[number, number]> | undefined | null, position?: [number, number] | null) {
  if (!points?.length) return []
  if (!position || points.length < 2) return points

  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  points.forEach((point, index) => {
    const distance = distanceBetweenEarthCoordinates(position[0], position[1], point[0], point[1])
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  // Do not draw a direct line from a noisy/off-road backend point to the route.
  // The car marker is projected to the road polyline, so the visible route must
  // also start from the nearest route point. Otherwise the line gets weird short
  // side segments and looks like it is rebuilt on every tick.
  return points.slice(Math.min(nearestIndex, points.length - 1))
}

const DEMO_DRIVER_ROUTE_SPEED_MPS = 24
// Degrees offset used to place the temporary test/manual waypoints (~1.3 km).
const MANUAL_TEST_OFFSET = 0.012

// The map view unmounts whenever another driver tab is shown, which would reset
// the demo progression (the optimistically-advanced order state and how far the
// marker has driven). We stash both in module scope so they survive remounts
// within the session and can be restored when the map tab comes back.
const persistedDriverDemo: {
  optimistic: { orderId: string; state: EBookingDriverState } | null
  progress: { orderId: string; toDestination: boolean; traveledMeters: number } | null
} = { optimistic: null, progress: null }

function getStoredStartedVotingOrderIds(): string[] {
  try {
    const value = localStorage.getItem(DRIVER_STARTED_VOTING_ORDERS_STORAGE_KEY)
    return value ? JSON.parse(value) : []
  } catch {
    return []
  }
}

function removeStoredStartedVotingOrderId(orderId: IOrder['b_id']) {
  const nextIds = getStoredStartedVotingOrderIds().filter(id => id !== orderId)
  localStorage.setItem(DRIVER_STARTED_VOTING_ORDERS_STORAGE_KEY, JSON.stringify(nextIds))
  return nextIds
}

const mapDispatchToProps = {
  getOrder: orderActionCreators.getOrder,
  refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
  setOrderCardModal: modalsActionCreators.setOrderCardModal,
  getAreasBetweenPoints: areasActionCreators.getAreasBetweenPoints,
}

const mapStateToProps = (state: IRootState) => ({
  wayGraph: areasSelectors.wayGraph(state),
})

const connector = connect(mapStateToProps, mapDispatchToProps)

interface IProps extends ConnectedProps<typeof connector> {
  user: IUser,
  activeOrders: IOrder[] | null,
  readyOrders: IOrder[] | null,
}

function DriverOrderMapMode(props: IProps) {
  const [position, setPosition] = useCachedState<L.LatLngExpression | undefined>(
    `${cachedDriverMapStateKey}.position`,
  )
  const [zoom, setZoom] = useCachedState<number>(
    `${cachedDriverMapStateKey}.zoom`,
    15,
  )

  return (
    <PageSection className="driver-order-map-mode">
      <DriverMapErrorBoundary resetKey={`driver-map-${props.user?.u_id || 'guest'}`}>
        <MapContainer
          center={position ?? getSavedDriverMapPosition() ?? SITE_CONSTANTS.DEFAULT_POSITION}
          zoom={zoom}
          className='map'
          attributionControl={false}
          zoomControl={false}
        >
          <DriverOrderMapModeContent
            {...props}
            locate={false}
            {...{ setPosition, setZoom }}
          />
        </MapContainer>
      </DriverMapErrorBoundary>
    </PageSection>
  )
}

class DriverMapErrorBoundary extends React.Component<{
  resetKey: string
  children: React.ReactNode
}, {
  hasError: boolean
  resetKey: string
}> {
  state = {
    hasError: false,
    resetKey: this.props.resetKey,
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { resetKey: string },
  ) {
    if (props.resetKey !== state.resetKey)
      return { hasError: false, resetKey: props.resetKey }

    return null
  }

  componentDidCatch(error: unknown) {
    if (!isKnownLeafletLifecycleError(error))
      console.error(error)
  }

  render() {
    if (this.state.hasError)
      return <div className="map map--fallback" />

    return this.props.children
  }
}

interface IContentProps extends IProps {
  locate: boolean,
  setZoom: (zoom: number) => void
  setPosition: (position: L.LatLngExpression) => void
}

function DriverOrderMapModeContent({
  user,
  activeOrders,
  readyOrders,
  locate,
  setPosition,
  setZoom,
  getOrder,
  setOrderCardModal,
  getAreasBetweenPoints,
  refreshActiveOrders,
  wayGraph,
}: IContentProps) {

  const navigate = useNavigate()
  const map = useMap()

  const [lastPositions, setLastPositions] = useState<[number, number][]>([])
  const [activeDriveRouteInfo, setActiveDriveRouteInfo] = useState<IRouteInfo | null>(null)
  const [startedVotingOrderIds, setStartedVotingOrderIds] = useState(() =>
    getStoredStartedVotingOrderIds(),
  )
  const [hiddenOrderIds, setHiddenOrderIds] = useState<string[]>(() => getHiddenOrderIds(user?.u_id))
  const [mapActionPending, setMapActionPending] = useState(false)
  // Optimistically remember the state the driver just advanced to. The active-orders
  // list the map reads can lag several seconds behind the backend, which made the
  // map buttons/marker look unresponsive after a tap. We honour this override until
  // the polled list catches up (see effectiveDriverState below).
  const [optimisticDriverState, setOptimisticDriverState] = useState<{
    orderId: IOrder['b_id']
    state: EBookingDriverState
  } | null>(() => persistedDriverDemo.optimistic)

  // Mirror the optimistic override into module scope so a tab switch (which
  // unmounts this view) does not lose it and revert the button to "Поехал".
  useEffect(() => {
    persistedDriverDemo.optimistic = optimisticDriverState ?
      { orderId: String(optimisticDriverState.orderId), state: optimisticDriverState.state } :
      null
  }, [optimisticDriverState])
  const lastDriverMapOrdersRenderLogKeyRef = useRef('')
  const lastDriverMapOrderCardLogKeyRef = useRef('')
  const lastDriverMapVisibleOrderIdsRef = useRef<string[]>([])
  const loggedDriverMapOrderSnapshotIdsRef = useRef<Record<string, true>>({})
  const [resolvedDestinationAddresses, setResolvedDestinationAddresses] = useState<Record<string, string>>({})
  const fittedDestinationOrderRef = useRef<string | null>(null)
  const lastRoutePointRef = useRef<IAddressPoint | null>(null)
  const lastRouteTargetRef = useRef<IAddressPoint | null>(null)
  const lastRouteGraphRef = useRef<IWayGraph | null>(null)
  const [demoDriverPosition, setDemoDriverPosition] = useState<[number, number] | null>(null)
  // Route emulator model drives the current driver's marker along the taken
  // order's route. It is framework-agnostic; here we only feed it the built
  // route geometry, subscribe to its position, and render it.
  const routeEmulatorRef = useRef<DriverRouteEmulator | null>(null)
  // Order-event adapter (task 6): diffs activeOrders/readyOrders snapshots into
  // world events and feeds them into the model via dispatch. The model only
  // re-transmits them; reacting to them (route mutations) is a later task/FSM.
  const orderEventAdapterRef = useRef<DriverOrderEventAdapter | null>(null)
  const wayGraphRef = useRef<IWayGraph | undefined>(undefined)
  const activeRoutePointsRef = useRef<Array<[number, number]> | null>(null)
  // Current route phase, read by the (long-lived) tick handler when it stashes the
  // marker's travelled distance for cross-remount restore.
  const routePhaseRef = useRef<{ orderId: string | null; toDestination: boolean }>({
    orderId: null,
    toDestination: false,
  })
  const demoRouteKeyRef = useRef('')
  // Manual route override: once the temporary test controls (Replace/Append/
  // Remove Last/Clear from DriverEmulatorPanel) touch the model, the automatic
  // order → setRoute pipeline stops feeding it, so the manually edited route is
  // not immediately overwritten. `manualRouteOverrideRef` is the synchronous
  // guard read inside effects; `manualRouteActive` drives rendering.
  const manualRouteOverrideRef = useRef(false)
  const [manualRouteActive, setManualRouteActive] = useState(false)
  const [manualRoutePolyline, setManualRoutePolyline] = useState<[number, number][] | null>(null)
  // Freshest map context for the (long-lived) command handler to read.
  const mapContextRef = useRef<{ position: [number, number] | null; orderStart: [number, number] | null }>({
    position: null,
    orderStart: null,
  })
  const browserGeoRequestPendingRef = useRef(false)
  const lastBrowserGeoRequestAtRef = useRef(0)
  const [browserEmulatorModes, setBrowserEmulatorModes] = useState(() => ({
    clients: isBrowserEmulatorRunning('clients'),
    drivers: isBrowserEmulatorRunning('drivers'),
  }))
  const isClientEmulatorMode = browserEmulatorModes.clients
  const isDriverEmulatorMode = browserEmulatorModes.drivers
  const emulatorOrdersEnabled = isClientEmulatorMode || isDriverEmulatorMode

  useEffect(() => {
    const syncEmulatorMode = () => setBrowserEmulatorModes({
      clients: isBrowserEmulatorRunning('clients'),
      drivers: isBrowserEmulatorRunning('drivers'),
    })
    syncEmulatorMode()
    window.addEventListener(BROWSER_EMULATOR_STATE_EVENT, syncEmulatorMode)
    return () => window.removeEventListener(BROWSER_EMULATOR_STATE_EVENT, syncEmulatorMode)
  }, [])

  useEffect(() => {
    const onZoomPreset = (event: Event) => {
      const preset = (event as CustomEvent<'max' | 'overview'>).detail
      if (!isLeafletMapConnected(map)) return
      const rawMaxZoom = Number(map.getMaxZoom())
      const maxZoom = Number.isFinite(rawMaxZoom) && rawMaxZoom > 0 ? rawMaxZoom : 18
      const targetZoom = preset === 'max' ? maxZoom : Math.max(10, maxZoom - 3)
      safeLeafletAction(() => map.setZoom(targetZoom, { animate: true }))
    }

    window.addEventListener('driverMapZoomPreset', onZoomPreset)
    return () => window.removeEventListener('driverMapZoomPreset', onZoomPreset)
  }, [map])

  useEffect(() => {
    if (!map)
      return undefined

    let cancelled = false

    const onLocationFound = (e: L.LocationEvent) => {
      if (cancelled) return
      const point = { latitude: e.latlng.lat, longitude: e.latlng.lng }
      saveLastBrowserGeolocation(point)
      setLastPositions([[e.latlng.lat, e.latlng.lng]])
      if (locate && isLeafletMapConnected(map))
        safeLeafletAction(() => map.setView(e.latlng))
    }
    const onLocationError = (e: L.ErrorEvent) => console.error(e.message)
    const onMapClick = (_e: L.LeafletMouseEvent) => {
      // Не отправляем координаты по клику по карте.
      // Иначе на Android/Chrome при тапе по заказу всплывает системный confirm
      // вместо обычной карточки заказа.
    }
    const onZoomEnd = () => {
      if (!isLeafletRuntimeReady(map))
        return

      safeLeafletAction(() => setZoom(map.getZoom()))
    }
    const onMoveEnd = () => {
      if (!isLeafletRuntimeReady(map))
        return

      safeLeafletAction(() => setPosition(map.getCenter()))
    }

    safeLeafletAction(() => {
      map.once('locationfound', onLocationFound)
      map.once('locationerror', onLocationError)
      if (locate && isClientEmulatorMode && !isDriverEmulatorMode) {
        map.locate({
          ...HIGH_ACCURACY_GEOLOCATION_OPTIONS,
        })
      }
      map.on('zoomend', onZoomEnd)
      map.on('moveend', onMoveEnd)
    })

    return () => {
      cancelled = true
      safeLeafletAction(() => {
        map.off('locationfound', onLocationFound)
        map.off('locationerror', onLocationError)
        map.off('zoomend', onZoomEnd)
        map.off('moveend', onMoveEnd)
        map.stopLocate()
      })
    }
  }, [map, locate, isClientEmulatorMode, isDriverEmulatorMode, setPosition, setZoom, user])

  useEffect(() => {
    const updateHiddenOrders = () => setHiddenOrderIds(getHiddenOrderIds(user?.u_id))
    updateHiddenOrders()
    window.addEventListener('hiddenOrdersChanged', updateHiddenOrders)
    window.addEventListener('storage', updateHiddenOrders)
    return () => {
      window.removeEventListener('hiddenOrdersChanged', updateHiddenOrders)
      window.removeEventListener('storage', updateHiddenOrders)
    }
  }, [user?.u_id])

  const visibleReadyOrders = useMemo(() =>
    readyOrders?.filter(item => !hiddenOrderIds.includes(String(item.b_id))) ?? null
  , [readyOrders, hiddenOrderIds.join('|')])

  const visibleMapOrders = useMemo(() => {
    const ordersById: Record<string, IOrder> = {}

    ;[
      ...(activeOrders ?? []),
      ...(visibleReadyOrders ?? []),
    ].forEach(order => {
      if (!order?.b_id)
        return

      ordersById[String(order.b_id)] = order
    })

    return Object.values(ordersById)
  }, [
    activeOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}`).join('|'),
    visibleReadyOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}`).join('|'),
  ])

  useEffect(() => {
    const activeMapOrders = activeOrders ?? []
    const readyMapOrders = visibleReadyOrders ?? []
    const allMapOrders = visibleMapOrders
    const mapOrdersWithCoordinates = allMapOrders.filter(order => Boolean(order.b_start_latitude && order.b_start_longitude))
    const mapOrdersWithoutCoordinates = allMapOrders.filter(order => !order.b_start_latitude || !order.b_start_longitude)
    const visibleMarkers = mapOrdersWithCoordinates.map(order => ({
      section: activeMapOrders.some(item => String(item.b_id) === String(order.b_id)) ?
        'active-map-marker' :
        'ready-map-marker',
      order,
    }))
    const renderKey = JSON.stringify({
      userId: user?.u_id ?? null,
      active: activeMapOrders.map(order => order.b_id),
      ready: readyMapOrders.map(order => order.b_id),
      allMapOrders: allMapOrders.map(order => order.b_id),
      mapOrdersWithCoordinates: mapOrdersWithCoordinates.map(order => order.b_id),
      mapOrdersWithoutCoordinates: mapOrdersWithoutCoordinates.map(order => order.b_id),
      visibleMarkers: visibleMarkers.map(item => `${item.section}:${item.order.b_id}`),
      hiddenOrderIds,
    })

    if (renderKey !== lastDriverMapOrdersRenderLogKeyRef.current) {
      lastDriverMapOrdersRenderLogKeyRef.current = renderKey
      const visibleOrderIds = visibleMarkers.map(item => String(item.order.b_id))
      const previousVisibleOrderIds = lastDriverMapVisibleOrderIdsRef.current
      const addedVisibleOrderIds = visibleOrderIds.filter(orderId => !previousVisibleOrderIds.includes(orderId))
      const removedVisibleOrderIds = previousVisibleOrderIds.filter(orderId => !visibleOrderIds.includes(orderId))
      lastDriverMapVisibleOrderIdsRef.current = visibleOrderIds

      const renderedSummary = {
        tab: 'map',
        userId: user?.u_id ?? null,
        activeOrdersCount: activeMapOrders.length,
        readyOrdersCount: readyMapOrders.length,
        totalOrders: allMapOrders.length,
        withCoordinates: mapOrdersWithCoordinates.length,
        withoutCoordinates: mapOrdersWithoutCoordinates.length,
        renderedMarkers: visibleMarkers.length,
        visibleMarkerCount: visibleMarkers.length,
        hiddenOrderIds,
      }

      writeFlowEvent('MAP_ORDERS_RECEIVED', {
        screen: 'DriverMap',
        uiState: 'MapTab',
        data: {
          ...renderedSummary,
          orderIds: allMapOrders.map(order => order.b_id),
          withCoordinatesOrderIds: mapOrdersWithCoordinates.map(order => order.b_id),
          withoutCoordinatesOrderIds: mapOrdersWithoutCoordinates.map(order => order.b_id),
        },
      })
      writeRawLog('MAP_ORDERS_RECEIVED', {
        source: 'driver-map-ui',
        screen: 'DriverMap',
        uiState: 'MapTab',
        ...renderedSummary,
        orderIds: allMapOrders.map(order => order.b_id),
        withCoordinatesOrderIds: mapOrdersWithCoordinates.map(order => order.b_id),
        withoutCoordinatesOrderIds: mapOrdersWithoutCoordinates.map(order => order.b_id),
      })

      allMapOrders.forEach(order => {
        const lat = order.b_start_latitude === undefined || order.b_start_latitude === null ? null : Number(order.b_start_latitude)
        const lng = order.b_start_longitude === undefined || order.b_start_longitude === null ? null : Number(order.b_start_longitude)
        const hasValidCoordinates = Number.isFinite(lat) && Number.isFinite(lng) && Boolean(lat && lng)
        writeFlowEvent('MAP_ORDER', {
          orderId: order.b_id,
          screen: 'DriverMap',
          uiState: 'MapTab',
          data: {
            orderId: order.b_id,
            lat,
            lng,
            hasValidCoordinates,
            renderedMarker: visibleMarkers.some(item => String(item.order.b_id) === String(order.b_id)),
            order: summarizeOrder(order),
          },
        })
        writeRawLog('MAP_ORDER', {
          source: 'driver-map-ui',
          screen: 'DriverMap',
          uiState: 'MapTab',
          orderId: order.b_id,
          lat,
          lng,
          hasValidCoordinates,
          renderedMarker: visibleMarkers.some(item => String(item.order.b_id) === String(order.b_id)),
          order: summarizeOrder(order),
        })
      })

      addedVisibleOrderIds.forEach(orderId => {
        const item = visibleMarkers.find(section => String(section.order.b_id) === String(orderId))
        if (!item)
          return

        writeFlowEvent('ORDER_BECAME_VISIBLE', {
          orderId: item.order.b_id,
          screen: 'DriverMap',
          uiState: 'MapTab',
          data: {
            section: item.section,
            order: summarizeOrder(item.order),
            userId: user?.u_id ?? null,
          },
        })

        if (!loggedDriverMapOrderSnapshotIdsRef.current[String(item.order.b_id)]) {
          loggedDriverMapOrderSnapshotIdsRef.current[String(item.order.b_id)] = true
          writeFlowEvent('ORDER_SNAPSHOT', {
            orderId: item.order.b_id,
            screen: 'DriverMap',
            uiState: 'MapTab',
            data: {
              reason: 'first_marker_visible_on_driver_map',
              section: item.section,
              order: item.order,
            },
          })
          writeRawLog('ORDER_SNAPSHOT', {
            source: 'driver-map-ui',
            screen: 'DriverMap',
            uiState: 'MapTab',
            orderId: item.order.b_id,
            reason: 'first_marker_visible_on_driver_map',
            section: item.section,
            order: item.order,
          })
        }
      })

      removedVisibleOrderIds.forEach(orderId => {
        writeFlowEvent('ORDER_REMOVED', {
          orderId,
          screen: 'DriverMap',
          uiState: 'MapTab',
          data: {
            reason: 'not_in_visible_driver_map_markers',
            remainingOrderIds: visibleOrderIds,
          },
        })
        writeRawLog('ORDER_REMOVED', {
          source: 'driver-map-ui',
          screen: 'DriverMap',
          uiState: 'MapTab',
          orderId,
          reason: 'not_in_visible_driver_map_markers',
          remainingOrderIds: visibleOrderIds,
        })
      })

      writeFlowEvent('ORDERS_LIST_RENDERED', {
        screen: 'DriverMap',
        uiState: 'MapTab',
        data: renderedSummary,
      })
      writeFlowEvent('ACTIVE_ORDERS_RENDERED', {
        screen: 'DriverMap',
        uiState: 'MapTab',
        data: renderedSummary,
      })
      writeRawLog('ACTIVE_ORDERS_RENDERED', {
        source: 'driver-map-ui',
        screen: 'DriverMap',
        uiState: 'MapTab',
        ...renderedSummary,
      })
      writeFlowEvent('ORDERS_VISIBLE_ON_SCREEN', {
        screen: 'DriverMap',
        uiState: 'MapTab',
        data: {
          tab: 'map',
          userId: user?.u_id ?? null,
          visibleOrderIds: visibleMarkers.map(item => String(item.order.b_id)),
          visibleSections: visibleMarkers.map(item => ({
            section: item.section,
            orderId: item.order.b_id,
            orderState: item.order.b_state,
            hasCoords: Boolean(item.order.b_start_latitude && item.order.b_start_longitude),
            driversCount: item.order.drivers?.length ?? 0,
          })),
        },
      })
    }

    const cardsKey = visibleMarkers
      .map(item => `${item.section}:${item.order.b_id}:${item.order.b_state}:${item.order.drivers?.length ?? 0}`)
      .join('|')
    if (cardsKey === lastDriverMapOrderCardLogKeyRef.current)
      return

    lastDriverMapOrderCardLogKeyRef.current = cardsKey
    visibleMarkers.forEach((item, index) => {
      writeFlowEvent('ORDER_CARD_RENDERED', {
        orderId: item.order.b_id,
        screen: 'DriverMap',
        uiState: 'MapTab',
        data: {
          section: item.section,
          index,
          order: summarizeOrder(item.order),
          userId: user?.u_id ?? null,
        },
      })
    })
  }, [
    user?.u_id,
    activeOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}`).join('|'),
    visibleReadyOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}`).join('|'),
    visibleMapOrders.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}`).join('|'),
    hiddenOrderIds.join('|'),
  ])

  // Не делаем reverseGeocode для всех видимых заказов на карте.
  // Массовые запросы к Nominatim быстро дают 429/CORS и ломают выбор адресов у клиента.
  // Для плашек берём только реальные адреса из заказа/options; активный заказ ниже
  // может догрузить адрес отдельно, если backend его не вернул.

  const activeDriverOrder = useMemo(() => {
    const navigationStates = [
      EBookingDriverState.Performer,
      EBookingDriverState.Arrived,
      EBookingDriverState.Started,
    ]

    const order = activeOrders?.find(item => {
      const driver = item.drivers?.find(item => item.u_id === user?.u_id)
      return !!driver && navigationStates.includes(driver.c_state)
    })

    if (!order) return null

    const driver = order.drivers?.find(item => item.u_id === user?.u_id) ?? null
    return { order, driver }
  }, [activeOrders, user?.u_id])

  const isStartedVotingOrder = Boolean(
    activeDriverOrder?.order.b_id &&
    startedVotingOrderIds.includes(activeDriverOrder.order.b_id),
  )

  const backendDriverState = activeDriverOrder?.driver?.c_state
  const activeOrderId = activeDriverOrder?.order?.b_id

  // The button/marker follow the freshest known state: the optimistic override the
  // moment the driver taps, then the polled backend state once it catches up.
  const effectiveDriverState = (
    optimisticDriverState &&
    activeOrderId !== undefined &&
    String(optimisticDriverState.orderId) === String(activeOrderId) &&
    (backendDriverState === undefined || optimisticDriverState.state > backendDriverState)
  ) ? optimisticDriverState.state : backendDriverState

  // Drop the override once the backend order is gone or has reached the override.
  useEffect(() => {
    if (!optimisticDriverState)
      return
    if (
      activeOrderId === undefined ||
      String(activeOrderId) !== String(optimisticDriverState.orderId) ||
      (backendDriverState !== undefined && backendDriverState >= optimisticDriverState.state)
    )
      setOptimisticDriverState(null)
  }, [optimisticDriverState, activeOrderId, backendDriverState])

  const routeOrderIsVoting = isVotingOrder(activeDriverOrder?.order ?? null)

  // Every order is a two-leg trip: first drive to the passenger (pickup leg),
  // then to their destination. "Поехал" (→ Arrived) starts the pickup leg; the
  // destination leg only starts with "Приехал" (→ Started) for normal orders, or
  // once the boarding code is confirmed (isStartedVotingOrder) for voting orders.
  const isRouteToDestination = Boolean(
    effectiveDriverState === EBookingDriverState.Started ||
    isStartedVotingOrder,
  )

  // The marker stays parked right after the order is accepted (Performer state)
  // and only starts moving once the driver taps "Поехал" (state ≥ Arrived).
  // Routing to the destination always implies the driver has departed — keep this
  // independent of effectiveDriverState so the marker keeps moving on the
  // destination leg even if that state momentarily regresses. On a live backend a
  // voting performer stays at Performer (Arrived/Started are no-ops), so the
  // optimistic "Arrived" is the only thing lifting effectiveDriverState; a refresh
  // that briefly empties the active-orders list can drop it, which would otherwise
  // freeze the marker right after the boarding code is confirmed.
  const hasDeparted = Boolean(
    (effectiveDriverState !== undefined && effectiveDriverState >= EBookingDriverState.Arrived) ||
    isRouteToDestination,
  )

  const performingOrder = !isRouteToDestination ? activeDriverOrder?.order : undefined
  const currentOrder = isRouteToDestination ? activeDriverOrder?.order : undefined
  const routeOrder = activeDriverOrder?.order ?? null

  const routeOrderResolvedDestination = routeOrder?.b_id ?
    resolvedDestinationAddresses[String(routeOrder.b_id)] :
    undefined

  useEffect(() => {
    if (!routeOrder)
      return undefined

    const orderId = String(routeOrder.b_id)
    if (
      getOrderDestinationAddress(routeOrder, routeOrderResolvedDestination) ||
      routeOrderResolvedDestination !== undefined ||
      !routeOrder.b_destination_latitude ||
      !routeOrder.b_destination_longitude
    )
      return undefined

    let cancelled = false

    API.reverseGeocode(
      String(routeOrder.b_destination_latitude),
      String(routeOrder.b_destination_longitude),
      { details: true },
    )
      .then(response => {
        if (cancelled) return
        setResolvedDestinationAddresses(prev => ({
          ...prev,
          [orderId]: getReverseGeocodeAddress(response),
        }))
      })
      .catch(error => {
        console.error(error)
        if (!cancelled) {
          setResolvedDestinationAddresses(prev => ({
            ...prev,
            [orderId]: '',
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    routeOrder?.b_id,
    routeOrder?.b_destination_latitude,
    routeOrder?.b_destination_longitude,
    routeOrderResolvedDestination,
  ])

  // A voting order's boarding code is confirmed inside the order-details card,
  // which is overlaid on this still-mounted map. Without a live signal the map
  // would only notice the confirmation (and flip the route to the passenger's
  // destination) after being unmounted and re-opened, because the "started
  // voting" marker is read from storage once on mount. React to the confirm
  // event: re-read the marker and refresh the order so the route switches at once.
  useEffect(() => {
    const handleStartedVotingOrder = () => {
      setStartedVotingOrderIds(getStoredStartedVotingOrderIds())
      refreshActiveOrders()
    }
    window.addEventListener('driver-started-voting-order', handleStartedVotingOrder)
    return () => window.removeEventListener('driver-started-voting-order', handleStartedVotingOrder)
  }, [refreshActiveOrders])

  // The map button state is derived from the active-orders list, so after a
  // transition we must refresh THAT list (getOrder only updates the single-order
  // slice the order-details screen reads). Refresh immediately and once more
  // shortly after, to cover any backend lag before the 5s watch poll catches up.
  const refreshMapOrderState = (orderId: IOrder['b_id']) => {
    getOrder(orderId)
    refreshActiveOrders()
    window.setTimeout(() => refreshActiveOrders(), 1500)
  }

  // Drive a forward order-state transition from the map. The emulator/demo backend
  // may answer a valid forward transition with a noisy error while still applying
  // it, so we never block the flow with an error modal (the order-details screen
  // tolerates it the same way). We always refresh afterwards so the active-orders
  // list reflects the real driver state and advances the button.
  const runMapOrderTransition = (orderId: IOrder['b_id'], run: () => Promise<void>) => {
    if (mapActionPending)
      return

    setMapActionPending(true)
    run()
      .catch(error => console.error(error))
      .finally(() => {
        refreshMapOrderState(orderId)
        setMapActionPending(false)
      })
  }

  // "Поехал": order accepted (Performer) → depart (Arrived). The marker starts moving.
  const onMapArrivedClick = () => {
    const order = activeDriverOrder?.order
    if (!order) return

    setOptimisticDriverState({ orderId: order.b_id, state: EBookingDriverState.Arrived })
    runMapOrderTransition(order.b_id, async() => {
      await API.setOrderState(order.b_id, EBookingDriverState.Arrived)
      if (isVotingOrder(order))
        await API.arrivedVotingOrder(order.b_id)
    })
  }

  // "Приехал": en route (Arrived) → started. Voting orders confirm the boarding
  // code in the order-details card, so open it instead of transitioning directly.
  const onMapStartedClick = () => {
    const order = activeDriverOrder?.order
    if (!order) return

    if (isVotingOrder(order)) {
      setOrderCardModal({ isOpen: true, orderId: order.b_id })
      return
    }

    setOptimisticDriverState({ orderId: order.b_id, state: EBookingDriverState.Started })
    runMapOrderTransition(order.b_id, async() => {
      await API.setOrderState(order.b_id, EBookingDriverState.Started)
    })
  }

  // "Завершить поездку": started → finished, then close the order view.
  const onCompleteOrderClick = () => {
    const order = currentOrder ?? activeDriverOrder?.order
    if (!order || mapActionPending) return

    // The trip is over, so drop the persisted demo state — otherwise coming back
    // to the map would try to restore a finished order's marker/button.
    persistedDriverDemo.optimistic = null
    persistedDriverDemo.progress = null
    setOptimisticDriverState(null)
    setMapActionPending(true)
    API.setOrderState(order.b_id, EBookingDriverState.Finished)
      .catch(error => console.error(error))
      .finally(() => {
        setStartedVotingOrderIds(removeStoredStartedVotingOrderId(order.b_id))
        refreshMapOrderState(order.b_id)
        setMapActionPending(false)
        // The rating modal is opened by the finished-order effect in Driver/index;
        // opening it here too would pop it twice.
        navigate(`/driver-order?tab=${EDriverTabs.Lite}`)
      })
  }

  const mapPrimaryAction = useMemo(() => {
    const driverState = effectiveDriverState
    const order = activeDriverOrder?.order
    if (!order || !driverState)
      return null

    // Accepted order: the car is parked, prompt the driver to depart.
    if (driverState === EBookingDriverState.Performer)
      return {
        text: t(TRANSLATION.WENT),
        className: 'finish-drive-button--started',
        onClick: onMapArrivedClick,
      }

    // Pickup leg: prompt arrival at the passenger (voting confirms the boarding
    // code via the card instead).
    if (driverState === EBookingDriverState.Arrived)
      return {
        text: isVotingOrder(order) ? t(TRANSLATION.DRIVER_VOTING_CONFIRM_CODE) : t(TRANSLATION.ARRIVED),
        className: 'finish-drive-button--arrived',
        onClick: onMapStartedClick,
        // Both actions mean "I am at the passenger": confirming the boarding
        // code and tapping "Приехал" require actually reaching the pickup point.
        requiresPickupArrival: true,
      }

    // Trip in progress: prompt completion, which closes the order.
    if (driverState === EBookingDriverState.Started)
      return {
        text: t(TRANSLATION.CLOSE_DRIVE),
        className: 'finish-drive-button--finished',
        onClick: onCompleteOrderClick,
      }

    return null
  }, [
    effectiveDriverState,
    activeDriverOrder?.order?.b_id,
    routeOrderIsVoting,
    mapActionPending,
  ])

  const backendDriverPosition = useMemo((): [number, number] | null => {
    const latitude = Number(activeDriverOrder?.driver?.c_latitude)
    const longitude = Number(activeDriverOrder?.driver?.c_longitude)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return null

    return [latitude, longitude]
  }, [activeDriverOrder?.driver?.c_latitude, activeDriverOrder?.driver?.c_longitude])

  useInterval(() => {
    if (!emulatorOrdersEnabled) return

    // В режиме driver-emulator координаты водителя специально управляются эмулятором.
    // В режиме client-emulator водитель должен оставаться реальным человеком, поэтому
    // берём живой GPS браузера как основной источник, даже если backend ещё хранит
    // старую/серверную координату.
    if (isDriverEmulatorMode) return

    // Android Chrome can freeze the UI when high accuracy geolocation requests
    // overlap with map redraw + polling. Keep only one active request and avoid
    // firing it while the tab is hidden.
    if (document.hidden || browserGeoRequestPendingRef.current) return

    const now = Date.now()
    if (now - lastBrowserGeoRequestAtRef.current < 4500) return
    lastBrowserGeoRequestAtRef.current = now
    browserGeoRequestPendingRef.current = true

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        browserGeoRequestPendingRef.current = false
        setLastPositions(prev => {
          const previous = prev.length ? prev[prev.length - 1] : null
          if (previous) {
            const distanceKm = distanceBetweenEarthCoordinates(previous[0], previous[1], coords.latitude, coords.longitude)
            // Mobile GPS sometimes gives a bad single point. Ignore huge jumps so
            // the map marker does not teleport while the user stands still.
            if (distanceKm > 0.45) return prev
          }

          saveLastBrowserGeolocation({ latitude: coords.latitude, longitude: coords.longitude })
          const nextPositions = [
            ...prev.slice(-2),
            [coords.latitude, coords.longitude] as [number, number],
          ]
          return nextPositions as typeof prev
        })
      },
      error => {
        browserGeoRequestPendingRef.current = false
        console.error(error)
      },
      HIGH_ACCURACY_GEOLOCATION_OPTIONS,
    )
  }, 1000)

  // The current driver is "me". While any emulator session is running and I
  // have a taken order with a built route, the emulator model drives my marker
  // along that route instead of showing my real GPS.
  const isDemoMapMovementEnabled = Boolean(
    routeOrder &&
    activeDriveRouteInfo?.points?.length &&
    emulatorOrdersEnabled,
  )

  // Keep the values the (long-lived) route provider reads up to date.
  wayGraphRef.current = wayGraph ?? undefined
  activeRoutePointsRef.current = activeDriveRouteInfo?.points ?? null
  routePhaseRef.current = {
    orderId: routeOrder?.b_id ? String(routeOrder.b_id) : null,
    toDestination: isRouteToDestination,
  }

  // Create the route emulator once. Its provider reuses the already-built
  // route geometry when available, and falls back to makeRoutePointsSafe.
  useEffect(() => {
    const model = new DriverRouteEmulator({
      speedMps: DEMO_DRIVER_ROUTE_SPEED_MPS,
      routeProvider: async(from, to) => {
        // For the automatic single-order case the model's only segment IS the
        // order route, so reuse the already-built geometry. But under the manual
        // test controls the route has arbitrary multi-point waypoints, so each
        // segment must be routed for real between its own from/to — otherwise
        // every segment would collapse onto the order's polyline.
        const prebuilt = activeRoutePointsRef.current
        if (!manualRouteOverrideRef.current && prebuilt && prebuilt.length > 1)
          return prebuilt.map(([lat, lng]) => ({ lat, lng }))

        const info = await makeRoutePointsSafe(
          { latitude: from.lat, longitude: from.lng },
          { latitude: to.lat, longitude: to.lng },
          wayGraphRef.current,
        )
        return info.points.map(([lat, lng]) => ({ lat, lng }))
      },
    })
    routeEmulatorRef.current = model

    const unsubscribe = model.subscribe(event => {
      if (event.type === 'tick') {
        setDemoDriverPosition([event.position.lat, event.position.lng])
        // Stash how far we have driven so a tab switch can restore the marker.
        const phase = routePhaseRef.current
        if (phase.orderId)
          persistedDriverDemo.progress = {
            orderId: phase.orderId,
            toDestination: phase.toDestination,
            traveledMeters: model.getState().traveledMeters,
          }
      } else if (event.type === 'route-loaded') {
        const state = model.getState()
        if (state.position)
          setDemoDriverPosition([state.position.lat, state.position.lng])
        // Kept in sync so the manual test controls can draw the model's own
        // geometry (it may diverge from the order's drawn route).
        setManualRoutePolyline(
          state.polyline.length > 1 ? state.polyline.map(point => [point.lat, point.lng]) : null,
        )
      } else if (event.type === 'route-cleared')
        setManualRoutePolyline(null)
      else if (event.type === 'external-event') {
        // The model only re-transmits the event; log it so the pipeline is
        // observable. Deciding what to do with it (route mutation) is task 9/10.
        writeRawLog('DRIVER_ROUTE_EMULATOR_EVENT', {
          source: 'driver-route-emulator',
          screen: 'DriverMap',
          uiState: 'MapTab',
          eventType: event.event.type,
          orderId: event.event.orderId ?? null,
          hasPickup: Boolean(event.event.pickup),
          hasDropoff: Boolean(event.event.dropoff),
          pickup: event.event.pickup ?? null,
          dropoff: event.event.dropoff ?? null,
        })
        // Debug-only surface (task 9/10): let the dev panel show the last event.
        emitDriverRouteEmulatorNotification({
          eventType: event.event.type,
          orderId: event.event.orderId,
        })
      }
    })

    return () => {
      unsubscribe()
      model.destroy()
      routeEmulatorRef.current = null
    }
  }, [])

  // Task 6: diff the latest order snapshots into world events and hand them to
  // the model via dispatch. The adapter is stateful (remembers the previous
  // snapshot); the first run only establishes a silent baseline.
  useEffect(() => {
    if (!orderEventAdapterRef.current)
      orderEventAdapterRef.current = new DriverOrderEventAdapter({ userId: user?.u_id })

    const adapter = orderEventAdapterRef.current
    const model = routeEmulatorRef.current
    if (!model)
      return

    adapter.setContext({ userId: user?.u_id })
    adapter.ingest({ activeOrders, readyOrders }).forEach(event => model.dispatch(event))
  }, [activeOrders, readyOrders, user?.u_id])

  // Feed the taken order's route into the model and start/stop movement.
  useEffect(() => {
    const model = routeEmulatorRef.current
    if (!model)
      return

    // The temporary test controls took the model over — leave its route alone.
    if (manualRouteOverrideRef.current)
      return

    const points = activeDriveRouteInfo?.points
    if (!isDemoMapMovementEnabled || !points?.length) {
      demoRouteKeyRef.current = ''
      model.clearRoute()
      setDemoDriverPosition(null)
      return
    }

    const start = points[0]
    const end = points[points.length - 1]

    // The drawn route is rebuilt asynchronously when the phase flips (pickup →
    // destination), so for a render or two `activeDriveRouteInfo` can still end at
    // the previous phase's target. Feeding that stale geometry to the emulator
    // would snap the marker back to the old route's start and drive pickup again.
    // Wait until the geometry actually ends at the current phase target.
    const phaseTargetOrderPoint = isRouteToDestination ?
      { lat: routeOrder?.b_destination_latitude, lng: routeOrder?.b_destination_longitude } :
      { lat: routeOrder?.b_start_latitude, lng: routeOrder?.b_start_longitude }
    const phaseTarget: [number, number] | null =
      phaseTargetOrderPoint.lat && phaseTargetOrderPoint.lng ?
        [phaseTargetOrderPoint.lat, phaseTargetOrderPoint.lng] :
        null
    if (
      phaseTarget &&
      distanceBetweenEarthCoordinates(end[0], end[1], phaseTarget[0], phaseTarget[1]) > 0.15
    )
      return

    const routeKey = [
      routeOrder?.b_id || '',
      isRouteToDestination ? 'destination' : 'pickup',
      points.length,
      start?.join(','),
      end?.join(','),
    ].join(':')

    if (demoRouteKeyRef.current === routeKey) {
      // The route geometry is unchanged, but the "departed" flag may have just
      // toggled (e.g. right after "Поехал" while still routing to the pickup).
      // Keep the marker moving/parked in step with it instead of returning early.
      if (hasDeparted)
        model.resume()
      else
        model.pause()
      return
    }
    demoRouteKeyRef.current = routeKey

    model.setRoute([
      {
        lat: start[0],
        lng: start[1],
        type: isRouteToDestination ? ERouteWaypointType.Boarding : ERouteWaypointType.Pickup,
        orderId: routeOrder?.b_id,
      },
      {
        lat: end[0],
        lng: end[1],
        type: isRouteToDestination ? ERouteWaypointType.Dropoff : ERouteWaypointType.Pickup,
        orderId: routeOrder?.b_id,
      },
    ]).then(() => {
      // Restore how far the marker had driven before a tab switch rebuilt the
      // route, so it does not snap back to the start (same order + same phase).
      const saved = persistedDriverDemo.progress
      if (
        saved &&
        String(saved.orderId) === String(routeOrder?.b_id ?? '') &&
        saved.toDestination === isRouteToDestination &&
        saved.traveledMeters > 0
      )
        model.seek(saved.traveledMeters)

      // Stay parked at the start until the driver taps "Поехал"; only then move.
      if (hasDeparted)
        model.resume()
      else
        model.pause()
    })
  }, [isDemoMapMovementEnabled, activeDriveRouteInfo, routeOrder?.b_id, isRouteToDestination, hasDeparted])

  const browserDriverPosition = useMemo((): [number, number] | null => {
    if (!lastPositions || !lastPositions.length) return null
    const last = lastPositions[lastPositions.length - 1]
    return [last[0], last[1]]
  }, [lastPositions])

  // Мемоизируем текущую позицию маркера (чтобы React не пересоздавал <Marker> из-за новой ссылки на массив)
  const currentPosition = useMemo((): [number, number] | null => {
    // Demo movement OR the manual test controls both drive the marker via the
    // route emulator model, so honour its position first.
    if ((isDemoMapMovementEnabled || manualRouteActive) && demoDriverPosition) return demoDriverPosition

    // Client emulator создаёт пассажирские заказы, но водитель остаётся реальным.
    // Поэтому сначала берём GPS этого браузера, а серверную координату используем
    // только как fallback, пока GPS ещё не пришёл.
    if (isClientEmulatorMode && !isDriverEmulatorMode && browserDriverPosition)
      return browserDriverPosition

    if (backendDriverPosition) return backendDriverPosition
    if (browserDriverPosition) return browserDriverPosition
    return null
  }, [
    isDemoMapMovementEnabled,
    manualRouteActive,
    demoDriverPosition,
    isClientEmulatorMode,
    isDriverEmulatorMode,
    browserDriverPosition,
    backendDriverPosition,
  ])

  const centerOnDriver = () => {
    if (!currentPosition) return
    if (isLeafletMapConnected(map))
      safeLeafletAction(() => map.setView(currentPosition, Math.max(map.getZoom(), 16)))
  }

  const currentOrderDestination = useMemo((): [number, number] | null => {
    if (!routeOrder?.b_destination_latitude || !routeOrder?.b_destination_longitude) return null
    return [
      routeOrder.b_destination_latitude,
      routeOrder.b_destination_longitude,
    ]
  }, [routeOrder?.b_destination_latitude, routeOrder?.b_destination_longitude])

  const currentOrderStart = useMemo((): [number, number] | null => {
    if (!routeOrder?.b_start_latitude || !routeOrder?.b_start_longitude) return null
    return [
      routeOrder.b_start_latitude,
      routeOrder.b_start_longitude,
    ]
  }, [routeOrder?.b_start_latitude, routeOrder?.b_start_longitude])

  // The driver has "reached the pickup" once they are within ~100 m of it — the
  // same threshold the order-details card uses to allow marking arrival. Gates the
  // boarding-code confirmation so it cannot happen before reaching the passenger.
  const hasReachedPickup = useMemo(() => {
    if (!currentPosition || !currentOrderStart) return false
    const distanceMeters = distanceBetweenEarthCoordinates(
      currentPosition[0], currentPosition[1],
      currentOrderStart[0], currentOrderStart[1],
    ) * 1000
    return distanceMeters <= 100
  }, [currentPosition, currentOrderStart])

  // Keep the values the (long-lived) command/manual handlers read up to date.
  mapContextRef.current = { position: currentPosition, orderStart: currentOrderStart }

  // Base point for the temporary manual/test waypoints: the model's current
  // position if it has a route, else the driver/order position, else the map
  // default.
  const manualBasePoint = useCallback((): { lat: number; lng: number } => {
    const modelPosition = routeEmulatorRef.current?.getState().position
    if (modelPosition)
      return { lat: modelPosition.lat, lng: modelPosition.lng }

    const context = mapContextRef.current
    const fallback = context.position ?? context.orderStart
    if (fallback)
      return { lat: fallback[0], lng: fallback[1] }

    const [lat, lng] = SITE_CONSTANTS.DEFAULT_POSITION as [number, number]
    return { lat, lng }
  }, [])

  // Once the manual/test controls take over, stop the automatic order pipeline
  // from feeding the model so the manual route is not overwritten.
  const engageManualRoute = useCallback(() => {
    manualRouteOverrideRef.current = true
    setManualRouteActive(true)
  }, [])

  // A fresh arbitrary test waypoint offset from the current base position.
  const manualTestWaypoint = useCallback((type: ERouteWaypointType = ERouteWaypointType.Custom) => {
    const base = manualBasePoint()
    return {
      lat: base.lat + MANUAL_TEST_OFFSET,
      lng: base.lng + MANUAL_TEST_OFFSET * 0.8,
      type,
    }
  }, [manualBasePoint])

  // Temporary test controls (DriverEmulatorPanel → command bus): drive the route
  // emulator's PUBLIC API directly so its mutation methods can be exercised on a
  // real map. The model never decides anything here — the button says what to do,
  // the model just does it, and the marker/polyline reflect the new state. This
  // is the same shape a future FSM/event handler will use to call the model.
  useEffect(() => subscribeDriverRouteEmulatorCommand(command => {
    const model = routeEmulatorRef.current
    if (!model)
      return

    const base = manualBasePoint()

    if (command.type === 'clear') {
      engageManualRoute()
      model.clearRoute()
      setDemoDriverPosition(null)
      setManualRoutePolyline(null)
      return
    }

    if (command.type === 'removeLast') {
      const lastIndex = model.getState().waypoints.length - 1
      if (lastIndex < 0)
        return
      engageManualRoute()
      model.removeWaypoint(lastIndex)
      model.resume()
      return
    }

    if (command.type === 'append') {
      engageManualRoute()
      model.appendWaypoint(manualTestWaypoint())
      model.resume()
      return
    }

    if (command.type === 'replace') {
      engageManualRoute()
      const o = MANUAL_TEST_OFFSET
      model.replaceRoute([
        { lat: base.lat, lng: base.lng, type: ERouteWaypointType.Pickup },
        { lat: base.lat + o * 0.8, lng: base.lng + o * 0.5, type: ERouteWaypointType.Custom },
        { lat: base.lat + o * 0.4, lng: base.lng + o * 1.6, type: ERouteWaypointType.Dropoff },
      ])
      model.resume()
    }
  }), [engageManualRoute, manualBasePoint, manualTestWaypoint])

  const currentRouteTarget = useMemo((): [number, number] | null => {
    if (isRouteToDestination)
      return currentOrderDestination

    return currentOrderStart
  }, [isRouteToDestination, currentOrderDestination, currentOrderStart])

  const currentRouteStart = useMemo((): [number, number] | null => {
    if (currentPosition)
      return currentPosition

    return currentOrderStart
  }, [currentPosition, currentOrderStart])

  const displayedActiveDriveRoutePoints = useMemo(() =>
    trimRoutePointsToPosition(activeDriveRouteInfo?.points, currentPosition),
  [activeDriveRouteInfo, currentPosition])

  const routeAreasRequestKey = useMemo(() => {
    if (!currentRouteStart || !currentRouteTarget) return ''

    return [
      ...currentRouteStart,
      ...currentRouteTarget,
    ].map(value => value.toFixed(4)).join(';')
  }, [currentRouteStart, currentRouteTarget])

  useEffect(() => {
    if (!currentRouteStart || !currentRouteTarget) return

    getAreasBetweenPoints([currentRouteStart, currentRouteTarget])
  }, [routeAreasRequestKey, getAreasBetweenPoints])

  useEffect(() => {
    if (!currentRouteTarget) return
    const fitKey = `${routeOrder?.b_id || ''}:${isRouteToDestination ? 'destination' : 'pickup'}`
    if (fittedDestinationOrderRef.current === fitKey) return

    fittedDestinationOrderRef.current = fitKey

    if (currentRouteStart) {
      if (isLeafletMapConnected(map))
        safeLeafletAction(() => map.fitBounds([currentRouteStart, currentRouteTarget], {
          padding: [60, 90],
          maxZoom: 16,
        }))
      return
    }

    if (isLeafletMapConnected(map))
      safeLeafletAction(() => map.setView(currentRouteTarget, Math.max(map.getZoom(), 15)))
  }, [map, routeOrder?.b_id, currentRouteTarget, currentRouteStart])

  useEffect(() => {
    if (!currentRouteStart || !currentRouteTarget) {
      if (activeDriveRouteInfo) {
        writeFlowEvent('MAP_ROUTE_RESET', {
          screen: 'DriverMap',
          uiState: 'MapTab',
          data: {
            reason: 'no_current_route_target_or_start',
            routeOrderId: routeOrder?.b_id ?? null,
            emulatorOrdersEnabled,
          },
        })
        writeRawLog('MAP_ROUTE_RESET', {
          source: 'driver-map-ui',
          screen: 'DriverMap',
          uiState: 'MapTab',
          reason: 'no_current_route_target_or_start',
          routeOrderId: routeOrder?.b_id ?? null,
          emulatorOrdersEnabled,
        })
      }
      setActiveDriveRouteInfo(null)
      lastRoutePointRef.current = null
      lastRouteTargetRef.current = null
      lastRouteGraphRef.current = null
      return
    }

    const from: IAddressPoint = {
      latitude: currentRouteStart[0],
      longitude: currentRouteStart[1],
    }
    const to: IAddressPoint = {
      latitude: currentRouteTarget[0],
      longitude: currentRouteTarget[1],
    }
    const lastRoutePoint = lastRoutePointRef.current
    const lastRouteTarget = lastRouteTargetRef.current
    if (
      activeDriveRouteInfo &&
      lastRoutePoint &&
      lastRouteTarget &&
      lastRouteGraphRef.current === wayGraph &&
      distanceBetweenEarthCoordinates(
        lastRoutePoint.latitude!,
        lastRoutePoint.longitude!,
        from.latitude!,
        from.longitude!,
      ) < 0.8 &&
      distanceBetweenEarthCoordinates(
        lastRouteTarget.latitude!,
        lastRouteTarget.longitude!,
        to.latitude!,
        to.longitude!,
      ) < 0.03
    )
      return

    let changed = false
    lastRoutePointRef.current = from
    lastRouteTargetRef.current = to
    lastRouteGraphRef.current = wayGraph

    makeRoutePointsSafe(from, to, wayGraph)
      .then((info) => {
        if (changed) return
        setActiveDriveRouteInfo(info)
      })
      .catch((error) => {
        console.error(error)
        if (!changed && !activeDriveRouteInfo)
          setActiveDriveRouteInfo(null)
      })

    return () => {
      changed = true
    }
  }, [currentRouteStart, currentRouteTarget, wayGraph, activeDriveRouteInfo, routeOrder?.b_id, emulatorOrdersEnabled])


  const routeDestinationAddress = routeOrder ?
    getOrderDestinationAddress(routeOrder, resolvedDestinationAddresses[String(routeOrder.b_id)]) :
    ''

  return (
    <>
      <TileLayer
        attribution={getAttribution()}
        url={getTileServerUrl()}
      />
      {currentPosition && (
        <button
          type="button"
          className="driver-order-map-mode__locate-button"
          onPointerDown={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onTouchStart={event => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            centerOnDriver()
          }}
          aria-label={t(TRANSLATION.SHOW_MY_LOCATION)}
        >
          <img src={images.mapLocationButton} alt="" />
        </button>
      )}
      {
        // Заменяем lastPositions.map() на одиночный <Marker> с мемоизированной позицией и arrowIconRef.current
        currentPosition && (
          <SmoothRotatingMarker
            position={currentPosition}
            iconUrl={images.mapArrow}
            className="driver-arrow-divicon smooth-rotating-marker"
            iconAnchor={[20, 20]}
            popupAnchor={[0, -22]}
            speedKmh={96}
            path={activeDriveRouteInfo?.points}
            zIndexOffset={3000}
          />
        )
      }
      {
        !!lastPositions.length && !isDriverEmulatorMode && !isDemoMapMovementEnabled &&
        <Polyline positions={lastPositions} />
      }
      {
        activeDriveRouteInfo && (
          <Polyline
            positions={displayedActiveDriveRoutePoints.length > 1 ? displayedActiveDriveRoutePoints : activeDriveRouteInfo.points}
            pathOptions={{
              color: '#FF3B30',
              weight: 4,
              opacity: .9,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )
      }
      {
        // Route emulator's own geometry while the manual test controls are active.
        // Drawn separately (blue, dashed) because it can diverge from the order route.
        manualRouteActive && manualRoutePolyline && manualRoutePolyline.length > 1 && (
          <Polyline
            positions={manualRoutePolyline}
            pathOptions={{
              color: '#007AFF',
              weight: 4,
              opacity: .9,
              dashArray: '6 8',
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        )
      }
      {
        currentOrderDestination && (
          <Marker
            position={currentOrderDestination}
            icon={new L.Icon({
              iconUrl: images.markerTo,
              iconSize: [36, 41],
              iconAnchor: [18, 41],
              popupAnchor: [0, -35],
            })}
          >
            <Tooltip direction="top" offset={[0, -40]} opacity={1} permanent>
              {formatDriverPointTooltip(t(TRANSLATION.TO), routeDestinationAddress)}
            </Tooltip>
            <Popup>
              {t(TRANSLATION.TO)}
              {!!routeDestinationAddress && `: ${routeDestinationAddress}`}
            </Popup>
          </Marker>
        )
      }
      {
        currentOrderStart && (
          <Marker
            position={currentOrderStart}
            icon={new L.Icon({
              iconUrl: images.markerFrom,
              iconSize: [35, 41],
              iconAnchor: [18, 41],
              popupAnchor: [0, -35],
            })}
          >
            <Popup>
              {t(TRANSLATION.FROM)}
              {!!routeOrder?.b_start_address && `: ${routeOrder.b_start_address}`}
            </Popup>
          </Marker>
        )
      }
      {
        visibleMapOrders
          .filter(item => item.b_start_latitude && item.b_start_longitude)
          .map(item =>
            <Marker
              position={[item.b_start_latitude, item.b_start_longitude] as L.LatLngExpression}
              icon={new L.DivIcon({
                iconAnchor: [20, 40],
                popupAnchor: [0, -35],
                iconSize: [50, 50],
                shadowSize: [29, 40],
                shadowAnchor: [7, 40],
                html: getOrderMarkerHtml(item, item === performingOrder, resolvedDestinationAddresses[String(item.b_id)]),
              })}
              eventHandlers={{
                click: (event) => {
                  try {
                    event.originalEvent?.preventDefault?.()
                    event.originalEvent?.stopPropagation?.()
                    L.DomEvent.stopPropagation(event.originalEvent)
                  } catch (_) {}
                  setOrderCardModal({ isOpen: true, orderId: item.b_id })
                },
              }}
              key={item.b_id}
            />,
          )
      }
      <button
        className='no-coords-orders'
        onClick={() => navigate(`/driver-order?tab=${EDriverTabs.Detailed}`)}
      >
        {
          (
            !!visibleMapOrders && visibleMapOrders
              .filter(item => !item.b_start_latitude || !item.b_start_longitude)
              .length
          ) || 0
        }
      </button>
      {
        mapPrimaryAction && (
          <Button
            text={mapPrimaryAction.text}
            className={`finish-drive-button ${mapPrimaryAction.className}`}
            onClick={mapPrimaryAction.onClick}
            disabled={mapActionPending || (mapPrimaryAction.requiresPickupArrival && !hasReachedPickup)}
            fixedSize={false}
          />
        )
      }
      {/* {
        !!activeOrders?.length && (
          <div
            style={{
              zIndex: 400,
              position: 'absolute',
              left: '70px',
              right: '70px',
            }}
          >
            {
              activeOrders.map(order => (
                <ChatToggler
                  anotherUserID={order.u_id}
                  orderID={order.b_id}
                  key={order.b_id}
                />
              ))
            }
          </div>
        )
      } */}
    </>
  )
}


function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function getAddressString(value?: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number')
    return String(value).replace(/\s+/g, ' ').trim()

  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    return getAddressString(
      source.shortAddress ||
      source.address ||
      source.formattedAddress ||
      source.formatted_address ||
      source.displayName ||
      source.name ||
      source.title ||
      source.label ||
      source.text,
    )
  }

  return ''
}

function isGeneratedAddressPlaceholder(value?: unknown) {
  const address = getAddressString(value).toLowerCase()
  if (!address) return false

  return [
    /^точка\s+(подачи|назначения|нажатия)(\s+|$)/i,
    /рядом\s+с\s+(вами|нами)/i,
    /с\s+(вами|нами)$/i,
    /^destination\s+point/i,
    /^pickup\s+point/i,
  ].some(pattern => pattern.test(address))
}

function pickRealAddress(...values: unknown[]) {
  for (const value of values) {
    const address = getAddressString(value)
    if (address && !isGeneratedAddressPlaceholder(address)) return address
  }
  return ''
}

function getReverseGeocodeAddress(response: any) {
  return pickRealAddress(
    response?.display_name,
    response?.displayName,
    response?.address?.road && response?.address?.city ?
      `${response.address.road}, ${response.address.city}` :
      '',
    response?.address?.road && response?.address?.town ?
      `${response.address.road}, ${response.address.town}` :
      '',
    response?.address?.suburb && response?.address?.city ?
      `${response.address.suburb}, ${response.address.city}` :
      '',
    response?.address?.suburb,
    response?.name,
  )
}

function shortenAddress(value?: unknown, limit = 38) {
  const text = getAddressString(value)
  if (!text) return ''

  const parts = text
    .split(',')
    .map(part => part.replace(/^(откуда|куда)\s*:?\s*/i, '').trim())
    .filter(Boolean)
  const meaningfulPart = parts.find(part => /[a-zа-яё]/i.test(part) && part.length > 2)
  const firstPart = meaningfulPart || parts.find(Boolean) || text
  const cleanText = firstPart.replace(/^(откуда|куда)\s*:?\s*/i, '').trim() || firstPart
  return cleanText.length > limit ? `${cleanText.slice(0, Math.max(0, limit - 1))}…` : cleanText
}

function getOrderDestinationAddress(order: IOrder, resolvedDestinationAddress?: string) {
  const options = (order as any)?.b_options || {}
  const pricingOptions = options?.pricingModel?.options || {}

  // Важно: не показываем технические заглушки типа
  // "Точка назначения рядом с вами". Сначала берём реальный адрес заказа,
  // потом адрес из геокодера, потом расширенные поля options, и только в
  // последнюю очередь короткие поля options, если они не являются заглушками.
  return pickRealAddress(
    order.b_destination_address,
    resolvedDestinationAddress,
    options.toAddress,
    options.destinationAddress,
    options.destination,
    options.to,
    pricingOptions.toAddress,
    pricingOptions.destinationAddress,
    options.toShortAddress,
    options.destinationShortAddress,
    pricingOptions.toShortAddress,
  )
}

function formatDriverPointTooltip(label: string, address?: unknown) {
  const short = shortenAddress(address)
  return short ? `${label}: ${short}` : label
}

function getSafeOrderTime(order: IOrder) {
  try {
    return order.b_start_datetime?.format ? order.b_start_datetime.format(dateFormatTimeShort) : ''
  } catch {
    return ''
  }
}

function getEstimatedProfit(order: IOrder) {
  if (typeof order.profit === 'number' && Number.isFinite(order.profit))
    return order.profit

  const price = Number(order.b_price_estimate || (order as any).b_price || (order as any).price || 0)
  const tips = Number(order.b_tips || 0)
  const passengerBonus = Number(order.b_passengers_count || 0) * 3
  const fallback = price + tips + passengerBonus
  return Number.isFinite(fallback) && fallback > 0 ? fallback : undefined
}

function getProfitRankClass(order: IOrder) {
  const rank = order.profitRank
  if (rank !== undefined) {
    return {
      [EOrderProfitRank.Low]: 'low',
      [EOrderProfitRank.Medium]: 'medium',
      [EOrderProfitRank.High]: 'high',
    }[rank]
  }

  const profit = getEstimatedProfit(order)
  if (profit === undefined) return ''
  if (profit >= 200) return 'high'
  if (profit >= 100) return 'medium'
  return 'low'
}

function getOrderModeIcon(order: IOrder, performing: boolean) {
  if (performing) return images.mapOrderPerforming
  if (isVotingOrder(order)) return images.mapOrderVoting
  if (isOfferOrder(order)) return images.mapOrderOffer
  return images.mapOrderWating
}

function getOrderMarkerHtml(order: IOrder, performing: boolean, resolvedDestinationAddress?: string) {
  const rankClass = getProfitRankClass(order)
  const profit = getEstimatedProfit(order)
  const profitText = profit !== undefined ? formatCurrency(profit, {
    signDisplay: 'always',
    currencyDisplay: 'none',
  }) : '+?'
  const toText = shortenAddress(getOrderDestinationAddress(order, resolvedDestinationAddress) || t(TRANSLATION.ADDRESS_NOT_SPECIFIED), 40)
  const startTime = getSafeOrderTime(order)
  const competitorsCount = Number(order.drivers?.length || 0)
  const priceValue = order.b_price_estimate || 0
  const tipsValue = order.b_tips || 0
  const passengersCount = order.b_passengers_count || 0
  const modeIcon = getOrderModeIcon(order, performing)

  const negativeClass = profit !== undefined && profit < 0 ? ' order-marker--profit-negative' : ''

  return `<div class='order-marker${rankClass ? ` order-marker--profit--${rankClass}` : ''}${negativeClass}'>
    <div class='order-marker-hint order-marker-hint--destination-only'>
      <div class='order-marker-hint__destination'>
        <b>${escapeHtml(t(TRANSLATION.TO))}:</b>
        <span>${escapeHtml(toText)}</span>
      </div>
      <div class='order-marker-hint__meta'>
        ${startTime ? `<span class='order-marker-hint__time'>${escapeHtml(startTime)}</span>` : ''}
        <span class='competitors-num'>${escapeHtml(competitorsCount)}</span>
        <span class='price'>${escapeHtml(priceValue)}</span>
        <span class='tips'>${escapeHtml(tipsValue)}</span>
        <span class='order-profit'>${escapeHtml(passengersCount)}</span>
        <span class='order-profit-estimation'>${escapeHtml(profitText)}</span>
      </div>
    </div>
    <img src='${modeIcon}'>
  </div>`
}

function getHiddenOrderIds(userID?: IUser['u_id']): string[] {
  if (!userID)
    return []

  try {
    const hiddenOrders = JSON.parse(localStorage.getItem('hiddenOrders') || '{}')
    return Array.isArray(hiddenOrders?.[userID]) ? hiddenOrders[userID].map(String) : []
  } catch {
    return []
  }
}

export default connector(DriverOrderMapMode)
