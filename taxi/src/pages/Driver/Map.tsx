import React, { useState, useEffect, useMemo, useRef } from 'react'
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
  EStatuses,
} from '../../types/types'
import { IWayGraph } from '../../tools/maps'
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
import { modalsActionCreators } from '../../state/modals'
import { areasActionCreators, areasSelectors } from '../../state/areas'
import { IRootState } from '../../state'
import { t, TRANSLATION } from '../../localization'
import PageSection from '../../components/PageSection'
import Button from '../../components/Button'
import SmoothRotatingMarker from '../../components/SmoothRotatingMarker'
import { EDriverTabs } from '.'
import { isOfferOrder, isVotingOrder } from '../../tools/driverOffer'
import { BROWSER_EMULATOR_STATE_EVENT, isBrowserEmulatorRunning, isDriverEmulatorTargetOrder, isEmulatedClientOrder } from '../../tools/emulatorMode'
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

function findNearestRouteIndex(points: Array<[number, number]>, position: [number, number]) {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  points.forEach((point, index) => {
    const distance = distanceBetweenEarthCoordinates(position[0], position[1], point[0], point[1])
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  })

  return nearestIndex
}

function interpolateRoutePoint(from: [number, number], to: [number, number], ratio: number): [number, number] {
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
  ]
}

function moveAlongRoutePoints(
  current: [number, number],
  points: Array<[number, number]>,
  stepMeters: number,
  startIndex?: number,
) {
  if (points.length < 2)
    return { point: current, index: 0, done: true }

  let point = current
  let targetIndex = Math.max(1, startIndex || findNearestRouteIndex(points, current) + 1)
  let remaining = stepMeters

  while (targetIndex < points.length) {
    const target = points[targetIndex]
    const segmentMeters = distanceBetweenEarthCoordinates(point[0], point[1], target[0], target[1]) * 1000

    if (segmentMeters <= 0.01) {
      point = target
      targetIndex += 1
      continue
    }

    if (segmentMeters > remaining) {
      return {
        point: interpolateRoutePoint(point, target, remaining / segmentMeters),
        index: targetIndex,
        done: false,
      }
    }

    remaining -= segmentMeters
    point = target
    targetIndex += 1
  }

  return { point: points[points.length - 1], index: points.length - 1, done: true }
}

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
  setRatingModal: modalsActionCreators.setRatingModal,
  setMessageModal: modalsActionCreators.setMessageModal,
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
  setRatingModal,
  setMessageModal,
  setOrderCardModal,
  getAreasBetweenPoints,
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
  const demoRouteIndexRef = useRef(0)
  const demoRouteKeyRef = useRef('')
  const demoRouteMoveAtRef = useRef(0)
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

  const isRouteToDestination = Boolean(
    activeDriverOrder?.driver?.c_state === EBookingDriverState.Started ||
    isStartedVotingOrder,
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

  const runMapOrderAction = (mutation: () => Promise<void>) => {
    if (mapActionPending)
      return

    setMapActionPending(true)
    mutation()
      .catch(error => {
        console.error(error)
        setMessageModal({ isOpen: true, status: EStatuses.Fail, message: t(TRANSLATION.ERROR) })
      })
      .finally(() => setMapActionPending(false))
  }

  const onMapArrivedClick = () => {
    const order = activeDriverOrder?.order
    if (!order) return

    runMapOrderAction(async() => {
      await API.setOrderState(order.b_id, EBookingDriverState.Arrived)
      if (order.b_voting)
        await API.arrivedVotingOrder(order.b_id)
      getOrder(order.b_id)
    })
  }

  const onMapStartedClick = () => {
    const order = activeDriverOrder?.order
    if (!order) return

    if (order.b_voting) {
      setOrderCardModal({ isOpen: true, orderId: order.b_id })
      return
    }

    runMapOrderAction(async() => {
      await API.setOrderState(order.b_id, EBookingDriverState.Started)
      getOrder(order.b_id)
    })
  }

  const onCompleteOrderClick = () => {
    if (!currentOrder) return

    runMapOrderAction(async() => {
      await API.setOrderState(currentOrder.b_id, EBookingDriverState.Finished)
      setStartedVotingOrderIds(removeStoredStartedVotingOrderId(currentOrder.b_id))
      getOrder(currentOrder.b_id)
      navigate(`/driver-order?tab=${EDriverTabs.Lite}`)
      setRatingModal({ isOpen: true, orderID: currentOrder.b_id })
    })
  }

  const mapPrimaryAction = useMemo(() => {
    const driverState = activeDriverOrder?.driver?.c_state
    const order = activeDriverOrder?.order
    if (!order || !driverState)
      return null

    if (driverState === EBookingDriverState.Performer)
      return {
        text: t(TRANSLATION.ARRIVED),
        className: 'finish-drive-button--arrived',
        onClick: onMapArrivedClick,
      }

    if (driverState === EBookingDriverState.Arrived)
      return {
        text: order.b_voting ? t(TRANSLATION.DRIVER_VOTING_CONFIRM_CODE) : t(TRANSLATION.WENT),
        className: 'finish-drive-button--started',
        onClick: onMapStartedClick,
      }

    if (driverState === EBookingDriverState.Started)
      return {
        text: t(TRANSLATION.CLOSE_DRIVE),
        className: 'finish-drive-button--finished',
        onClick: onCompleteOrderClick,
      }

    return null
  }, [
    activeDriverOrder?.driver?.c_state,
    activeDriverOrder?.order?.b_id,
    activeDriverOrder?.order?.b_voting,
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

  const isDemoMapMovementEnabled = Boolean(
    routeOrder &&
    activeDriveRouteInfo?.points?.length &&
    isDriverEmulatorMode &&
    (
      isDriverEmulatorTargetOrder(routeOrder) ||
      isEmulatedClientOrder(routeOrder)
    ),
  )

  useEffect(() => {
    if (!isDemoMapMovementEnabled || !activeDriveRouteInfo?.points?.length) {
      setDemoDriverPosition(null)
      demoRouteIndexRef.current = 0
      demoRouteKeyRef.current = ''
      demoRouteMoveAtRef.current = 0
      return
    }

    const routeKey = [
      routeOrder?.b_id || '',
      isRouteToDestination ? 'destination' : 'pickup',
      activeDriveRouteInfo.points.length,
      activeDriveRouteInfo.points[0]?.join(','),
      activeDriveRouteInfo.points[activeDriveRouteInfo.points.length - 1]?.join(','),
    ].join(':')

    if (demoRouteKeyRef.current === routeKey) return

    demoRouteKeyRef.current = routeKey
    demoRouteIndexRef.current = 1
    demoRouteMoveAtRef.current = Date.now()
    setDemoDriverPosition(activeDriveRouteInfo.points[0] as [number, number])
  }, [isDemoMapMovementEnabled, activeDriveRouteInfo, routeOrder?.b_id, isRouteToDestination])

  useInterval(() => {
    if (!isDemoMapMovementEnabled || !activeDriveRouteInfo?.points?.length) return

    const now = Date.now()
    const elapsedSeconds = demoRouteMoveAtRef.current ? Math.max(.5, (now - demoRouteMoveAtRef.current) / 1000) : 1
    demoRouteMoveAtRef.current = now

    setDemoDriverPosition((previous) => {
      const startPoint = previous || (activeDriveRouteInfo.points[0] as [number, number])
      const stepMeters = Math.min(80, Math.max(10, elapsedSeconds * DEMO_DRIVER_ROUTE_SPEED_MPS))
      const moved = moveAlongRoutePoints(startPoint, activeDriveRouteInfo.points, stepMeters, demoRouteIndexRef.current)
      demoRouteIndexRef.current = moved.index
      return moved.point
    })
  }, 1000)

  const browserDriverPosition = useMemo((): [number, number] | null => {
    if (!lastPositions || !lastPositions.length) return null
    const last = lastPositions[lastPositions.length - 1]
    return [last[0], last[1]]
  }, [lastPositions])

  // Мемоизируем текущую позицию маркера (чтобы React не пересоздавал <Marker> из-за новой ссылки на массив)
  const currentPosition = useMemo((): [number, number] | null => {
    if (isDemoMapMovementEnabled && demoDriverPosition) return demoDriverPosition

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
        !!lastPositions.length && !isDriverEmulatorMode &&
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
            disabled={mapActionPending}
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
  if (isOfferOrder(order)) return images.mapOrderWating
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

async function makeRoutePointsSafe(
  from: IAddressPoint,
  to: IAddressPoint,
  wayGraph?: IWayGraph,
): Promise<IRouteInfo> {
  try {
    const apiRoute = await API.makeRoutePoints(from, to)
    if (isUsableRouteInfo(apiRoute))
      return apiRoute
  } catch (error) {
    }

  const localRoute = makeLocalRoutePoints(from, to, wayGraph)
  if (isUsableRouteInfo(localRoute))
    return localRoute

  try {
    const osrmRoute = await makeOsrmRoutePoints(from, to)
    if (isUsableRouteInfo(osrmRoute))
      return osrmRoute
  } catch (error) {
    console.error(error)
  }

  throw new Error('Route by roads is not available')
}

async function makeOsrmRoutePoints(
  from: IAddressPoint,
  to: IAddressPoint,
): Promise<IRouteInfo | null> {
  if (!from.latitude || !from.longitude || !to.latitude || !to.longitude)
    return null

  const url = [
    'https://router.project-osrm.org/route/v1/driving/',
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`,
    '?overview=full&geometries=geojson',
  ].join('')
  const response = await fetch(url)
  if (!response.ok)
    return null

  const data = await response.json()
  const route = data?.routes?.[0]
  const coordinates = route?.geometry?.coordinates
  if (!Array.isArray(coordinates) || coordinates.length < 2)
    return null

  const durationSeconds = Number(route.duration) || 0
  const hours = Math.floor(durationSeconds / 3600)
  const minutes = Math.max(1, Math.round((durationSeconds - hours * 3600) / 60))

  return {
    distance: parseFloat(((Number(route.distance) || 0) / 1000).toFixed(2)),
    time: { hours, minutes },
    points: coordinates.map((item: [number, number]) => [item[1], item[0]]),
  }
}

function isUsableRouteInfo(route: IRouteInfo | null | undefined): route is IRouteInfo {
  return Boolean(
    route &&
    Array.isArray(route.points) &&
    route.points.length > 2 &&
    route.points.every(point =>
      Array.isArray(point) &&
      point.length >= 2 &&
      Number.isFinite(point[0]) &&
      Number.isFinite(point[1]),
    ),
  )
}

function makeLocalRoutePoints(
  from: IAddressPoint,
  to: IAddressPoint,
  wayGraph?: IWayGraph,
): IRouteInfo | null {
  if (!wayGraph || !from.latitude || !from.longitude || !to.latitude || !to.longitude)
    return null

  const [startNode] = wayGraph.findClosestNode(from.latitude, from.longitude)
  const [endNode] = wayGraph.findClosestNode(to.latitude, to.longitude)
  if (!startNode || !endNode)
    return null

  const [path, distanceMeters] = wayGraph.findShortestPath(startNode.id, endNode.id)
  if (path.length < 2 || !Number.isFinite(distanceMeters))
    return null

  const minutes = Math.max(1, Math.round(distanceMeters / 1000 / 35 * 60))
  return {
    distance: parseFloat((distanceMeters / 1000).toFixed(2)),
    time: {
      hours: Math.floor(minutes / 60),
      minutes: minutes % 60,
    },
    points: [
      [from.latitude, from.longitude],
      ...path.map(node => [node.latitude, node.longitude] as [number, number]),
      [to.latitude, to.longitude],
    ],
  }
}
