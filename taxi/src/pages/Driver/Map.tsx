import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react'
import { connect, ConnectedProps } from 'react-redux'
import L from 'leaflet'
import {
  MapContainer, Marker, TileLayer, Polyline,
  Popup, Tooltip, useMap,
} from 'react-leaflet'
import {
  EBookingDriverState,
  EOrderProfitRank,
  IAddressPoint,
  IDriver,
  IOrder,
  IRouteInfo,
  IUser,
} from '../../types/types'
import { IWayGraph } from '../../tools/maps'
import {
  DriverRouteEmulator,
  EDriverExternalEventType,
  ERouteWaypointType,
  IGeoPoint,
} from '../../tools/driverRouteEmulator'
import {
  ETripStopKind,
  ITripStop,
  buildDriverTripPlan,
  getTripActionStop,
  getTripPlanOrderIds,
  getTripStopKey,
  isFinalTripStop,
} from '../../tools/driverTripPlan'
import { isAlongTheWayCandidate } from '../../tools/alongTheWayCandidate'
import { DriverOrderEventAdapter } from '../../tools/driverOrderEventAdapter'
import {
  subscribeDriverRouteEmulatorCommand,
  emitDriverRouteEmulatorNotification,
} from '../../tools/driverRouteEmulatorCommandBus'
import {
  isAtDestinationPoint,
  isAtPickupPoint,
  publishDriverPosition,
  getDriverParkedPosition,
  rememberDriverParkedPosition,
} from '../../tools/driverPosition'
import { TDriverPositionSource } from '../../tools/driverLocationLog'
import { TDriverTripPhase, publishDriverTrip } from '../../tools/driverTripPhase'
import { snapToRoad, REACHABLE_ROAD_METERS } from '../../tools/mapReachability'
import { useCachedState } from '../../tools/hooks'
import images from '../../constants/images'
import OrderModeButton from '../../components/OrderModeButton'
import {
  dateFormatTimeShort,
  distanceBetweenEarthCoordinates,
  getAttribution,
  getTileServerUrl,
  formatCurrency,
  HIGH_ACCURACY_GEOLOCATION_OPTIONS,
} from '../../tools/utils'
import { useInterval, useSelector } from '../../tools/hooks'
import { orderControlModeSelectors } from '../../state/orderControlMode'
import { EOrderControlMode } from '../../state/orderControlMode/constants'
import { dismissOrderModeDecision, requestOrderModeDecision } from '../../tools/orderModeDecision'
import { showOrderModeToast } from '../../tools/orderModeToast'
import { getOrderIdParts, getOrderIdText } from '../../tools/orderId'
import { computeProfitPercentiles, getEstimatedProfit } from '../../tools/order'
import { formatShortAddress } from '../../tools/address'

import SITE_CONSTANTS from '../../siteConstants'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import {
  DRIVER_MAP_EVENTS,
  driverMapGateway,
} from '../../platform/adapters/DriverMapGateway'
import type { DriverMapFailurePayload } from '../../platform/adapters/DriverMapGateway'
import {
  PLATFORM_ROUTES,
  useDriverHudSurface,
  useMapSurface,
  usePlatformNavigate,
} from '../../platform/platform-interface'
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
import { canDriverTakeOrderBySeats, getDriverFreeSeats } from '../../tools/driverCapacity'
import {
  buildOrderDecisionContext,
  mergeDecisionStageOrders,
} from '../../tools/orderDecisionContext'
import { trackOrderDecisions } from '../../tools/orderDecisionTracker'
import { carsSelectors } from '../../state/cars'
import { BROWSER_EMULATOR_STATE_EVENT, isBrowserEmulatorRunning } from '../../tools/emulatorMode'
import { writeFlowEvent } from '../../tools/flowLog'
import { writeRawLog } from '../../tools/rawLog'
import { summarizeOrder } from '../../tools/frontendLog'
import './styles.scss'

/** Задержка перед каждым шагом поездки в Строгом режиме (показываем тост, затем действие). */
const STRICT_STEP_DELAY_MS = 2000
/** Сколько держать тост шага. */
const STRICT_STEP_TOAST_MS = 3500
/**
 * Сколько ждём, что взятый попутный заказ появится в активных. Дольше держать
 * точку «на пробу» смысла нет: взятие где-то потерялось, и водитель должен
 * поехать дальше, а не стоять у точки, о которой его уже не спрашивают.
 */
const ALONG_THE_WAY_TAKE_TIMEOUT_MS = 15000

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
/** Сколько построенных ног маршрута держим в кэше провайдера геометрии. */
const ROUTE_SEGMENT_CACHE_LIMIT = 60
// Degrees offset used to place the temporary test/manual waypoints (~1.3 km).
const MANUAL_TEST_OFFSET = 0.012

// The map view unmounts whenever another driver tab is shown, which would reset
// the demo progression (the optimistically-advanced order state and where the
// marker has driven to). We stash both in module scope so they survive remounts
// within the session and can be restored when the map tab comes back.
const persistedDriverDemo: {
  // Ключ — id заказа: водитель может вести несколько заказов сразу (попутные),
  // и оптимистичное состояние одного не должно затирать состояние другого.
  optimistic: Record<string, EBookingDriverState> | null
  // Где физически стоял маркер, когда карта ушла с экрана.
  //
  // Раньше здесь лежала пройденная дистанция, но она осмысленна только для той
  // геометрии, на которой была измерена: после возвращения маршрут строится
  // заново и — пока позиция маркера потеряна — от последней координаты с
  // бэкенда, то есть от места, где водитель стоял ДО поездки. Дистанцию по
  // такому маршруту отматывали не туда: маркер откатывался к «классической»
  // геопозиции, а если новый маршрут оказывался короче пройденного — модель
  // считала поездку завершённой и маркер вставал насовсем.
  //
  // Координата верна при любом перестроении: с неё и начинается новый маршрут,
  // поэтому поездка продолжается ровно с того места, где её прервали.
  position: { orderIds: string[]; lat: number; lng: number } | null
  /**
   * Попутчик, к которому водитель едет (или о котором его уже спросили).
   *
   * Кандидата находит диффер снимков заказов — и только в МОМЕНТ появления
   * заказа. После возвращения на карту диффер начинает с чистого листа и того же
   * заказа «новым» уже не увидит, а состояние карты к тому времени сброшено —
   * поэтому точка попутчика просто исчезала из маршрута вместе с решением по
   * ней. Помним её сами.
   */
  alongTheWay: {
    orderIds: string[]
    /** Последний снимок заказа: между «взял» и активными он не числится нигде. */
    orders: Record<string, IOrder>
    declinedOrderIds: string[]
    takingOrderIds: string[]
    boardedOrderIds: string[]
  } | null
} = { optimistic: null, position: null, alongTheWay: null }

function toIdMap(ids: string[] | undefined): Record<string, true> {
  return (ids ?? []).reduce<Record<string, true>>((map, id) => {
    map[id] = true
    return map
  }, {})
}

/**
 * Сохранённая позиция маркера, если она относится к ТЕКУЩЕЙ поездке. Достаточно
 * пересечения по заказам: состав плана за время отсутствия на карте мог
 * измениться (попутчика взяли, кого-то высадили), но машина всё та же. Совсем
 * другая поездка заказов не разделяет — её точка не подхватится.
 */
function getPersistedDemoPosition(orderIds: string[]): [number, number] | null {
  const saved = persistedDriverDemo.position
  if (!saved || !orderIds.length)
    return null

  return orderIds.some(orderId => saved.orderIds.includes(orderId)) ?
    [saved.lat, saved.lng] :
    null
}

/** Точка высадки заказа — запасной ответ на «где водитель закончил поездку». */
function toOrderDestinationPoint(order: IOrder): [number, number] | null {
  const latitude = Number(order.b_destination_latitude)
  const longitude = Number(order.b_destination_longitude)

  return Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude || longitude) ?
    [latitude, longitude] :
    null
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

interface ISnappedOrderPoints {
  start: [number, number] | null
  destination: [number, number] | null
}

/**
 * Привязка точек заказа к ближайшей дороге. Привязываем только заметно
 * оторванные от дороги точки, чтобы не дёргать уже нормальные (снап на
 * генерации оставляет дорогу в пределах REACHABLE).
 */
async function snapOrderPoints(order: IOrder): Promise<ISnappedOrderPoints> {
  const rawStart = order.b_start_latitude && order.b_start_longitude ?
    { latitude: Number(order.b_start_latitude), longitude: Number(order.b_start_longitude) } :
    null
  const rawDestination = order.b_destination_latitude && order.b_destination_longitude ?
    { latitude: Number(order.b_destination_latitude), longitude: Number(order.b_destination_longitude) } :
    null

  const [startSnap, destinationSnap] = await Promise.all([
    rawStart ? snapToRoad(rawStart) : Promise.resolve(null),
    rawDestination ? snapToRoad(rawDestination) : Promise.resolve(null),
  ])

  const start = startSnap && startSnap.roadDistanceMeters > REACHABLE_ROAD_METERS ?
    [startSnap.latitude, startSnap.longitude] as [number, number] :
    null
  const destination = destinationSnap && destinationSnap.roadDistanceMeters > REACHABLE_ROAD_METERS ?
    [destinationSnap.latitude, destinationSnap.longitude] as [number, number] :
    null

  if (start || destination) {
    writeRawLog('DRIVER_DEMO_ORDER_OFFROAD', {
      source: 'driver-map',
      screen: 'Driver/Map',
      orderId: String(order.b_id),
      startRoadDistanceMeters: startSnap?.roadDistanceMeters ?? null,
      destinationRoadDistanceMeters: destinationSnap?.roadDistanceMeters ?? null,
      snappedStart: Boolean(start),
      snappedDestination: Boolean(destination),
    })
  }

  return { start, destination }
}

const mapDispatchToProps = {
  getOrder: orderActionCreators.getOrder,
  refreshActiveOrders: ordersActionCreators.refreshActiveOrders,
  setOrderCardModal: modalsActionCreators.setOrderCardModal,
  setDriverTripCancelModal: modalsActionCreators.setDriverTripCancelModal,
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
          center={
            position ??
            // Точка, где водитель остался после прошлого заказа, ближе к правде,
            // чем последний GPS браузера: заказ мог закрыться далеко от дома.
            getDriverParkedPosition() ??
            getSavedDriverMapPosition() ??
            SITE_CONSTANTS.DEFAULT_POSITION
          }
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
  user: userProp,
  activeOrders: activeOrdersProp,
  readyOrders: readyOrdersProp,
  locate,
  setPosition,
  setZoom,
  getOrder,
  setOrderCardModal,
  setDriverTripCancelModal,
  getAreasBetweenPoints,
  refreshActiveOrders,
  wayGraph,
}: IContentProps) {

  const navigate = usePlatformNavigate()

  // Platform Interface: Driver HUD Surface — источник состояния водителя и заказов.
  // Пока Snapshot недоступен, работает legacy fallback на props из Redux.
  const driverPresentation = useDriverHudSurface()
  let user = userProp
  if (driverPresentation.available && driverPresentation.user) {
    user = {
      ...(userProp ?? {}),
      ...driverPresentation.user,
    } as IUser
  }
  const activeOrders = driverPresentation.available ?
    driverPresentation.activeOrders as IOrder[] :
    activeOrdersProp
  const readyOrders = driverPresentation.available ?
    driverPresentation.readyOrders as IOrder[] :
    readyOrdersProp

  // Map Surface управляет lifecycle Map Channel. mockEnabled = false: демо-режим
  // маркера (markerMock) в основной репозиторий не переносился, мок-режимом здесь
  // остаётся эмулятор водителя.
  const mapChannel = useMapSurface({ mockEnabled: false, setOrderCardModal })

  // Platform Interface: монтирование Driver Map Gateway и подписка на его события.
  //
  // Arrived / Started / Finished здесь НЕ обрабатываются намеренно: обновление
  // состояния после перехода принадлежит обработчикам карты (runMapOrderTransition,
  // refreshMapOrderState, продолжение плана поездки, припаркованная позиция), и
  // дублировать его в событии значило бы дважды дёргать getOrder. Промис шлюза
  // резолвится после терминального результата команды, поэтому этот порядок
  // одинаково верен и в legacy-режиме, и с настроенным Command API.
  //
  // Failed логируется без модалки: карта сознательно не блокирует поездку окном
  // ошибки — демо-бэкенд отвечает шумом и на успешный переход.
  useEffect(() => {
    const unmountGateway = driverMapGateway.mount()
    const unsubscribe = driverMapGateway.subscribe(event => {
      const payload = event.payload as {
        readonly orderId?: IOrder['b_id']
        readonly points?: readonly [number, number][]
      }

      switch (event.type) {
        case DRIVER_MAP_EVENTS.CardOpened:
          if (payload.orderId)
            setOrderCardModal({ isOpen: true, orderId: payload.orderId })
          break
        case DRIVER_MAP_EVENTS.AreasRequested:
          if (payload.points?.length)
            getAreasBetweenPoints([...payload.points])
          break
        case DRIVER_MAP_EVENTS.Failed: {
          const failure = event.payload as DriverMapFailurePayload
          console.error('[DriverMap]', failure.code, failure.message)
          break
        }
      }
    })

    return () => {
      unsubscribe()
      unmountGateway()
    }
  }, [getAreasBetweenPoints, setOrderCardModal])

  const map = useMap()

  const [lastPositions, setLastPositions] = useState<[number, number][]>([])
  const [activeDriveRouteInfo, setActiveDriveRouteInfo] = useState<IRouteInfo | null>(null)
  const [startedVotingOrderIds, setStartedVotingOrderIds] = useState(() =>
    getStoredStartedVotingOrderIds(),
  )
  const [hiddenOrderIds, setHiddenOrderIds] = useState<string[]>(() => getHiddenOrderIds(user?.u_id))
  const [mapActionPending, setMapActionPending] = useState(false)
  const orderControlMode = useSelector(orderControlModeSelectors.orderControlMode)
  const driverCar = useSelector(carsSelectors.userDrivenCar)
  const autoProgressStepRef = useRef<string>('')
  const scheduledAutoStepRef = useRef<string>('')
  const toastShownStepRef = useRef<string>('')
  const autoProgressTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const latestPrimaryActionRef = useRef<{ onClick: () => void } | null>(null)
  // К какому шагу поездки кнопка относится ПРЯМО СЕЙЧАС. Отложенное действие
  // Строгого режима сверяется с этим ключом перед выполнением — см. ниже.
  const latestAutoStepKeyRef = useRef<string>('')

  useEffect(() => () => {
    autoProgressTimers.current.forEach(clearTimeout)
    autoProgressTimers.current = []
  }, [])
  // Optimistically remember the state the driver just advanced to. The active-orders
  // list the map reads can lag several seconds behind the backend, which made the
  // map buttons/marker look unresponsive after a tap. We honour this override until
  // the polled list catches up (see effectiveDriverState below).
  const [optimisticDriverStates, setOptimisticDriverStates] = useState<
    Record<string, EBookingDriverState>
  >(() => persistedDriverDemo.optimistic ?? {})

  // Mirror the optimistic override into module scope so a tab switch (which
  // unmounts this view) does not lose it and revert the button to "Поехал".
  useEffect(() => {
    persistedDriverDemo.optimistic = Object.keys(optimisticDriverStates).length ?
      { ...optimisticDriverStates } :
      null
  }, [optimisticDriverStates])

  // Запомнить шаг, на который водитель только что перевёл КОНКРЕТНЫЙ заказ.
  const rememberOptimisticState = useCallback((orderId: IOrder['b_id'], state: EBookingDriverState) => {
    setOptimisticDriverStates(prev => ({ ...prev, [String(orderId)]: state }))
  }, [])

  const forgetOptimisticState = useCallback((orderId: IOrder['b_id']) => {
    setOptimisticDriverStates(prev => {
      const id = String(orderId)
      if (!(id in prev)) return prev

      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])
  const lastDriverMapOrdersRenderLogKeyRef = useRef('')
  const lastDriverMapOrderCardLogKeyRef = useRef('')
  const lastDriverMapVisibleOrderIdsRef = useRef<string[]>([])
  const loggedDriverMapOrderSnapshotIdsRef = useRef<Record<string, true>>({})
  const [resolvedDestinationAddresses, setResolvedDestinationAddresses] = useState<Record<string, string>>({})
  const fittedDestinationOrderRef = useRef<string | null>(null)
  // Карту центрируем на водителе только при открытии: дальше кадром распоряжается
  // он сам (и подгонка маршрута), а не каждый шаг маркера.
  const centeredOnOpenRef = useRef(false)
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
  // Построенные ноги маршрута: план перестраивается заметно чаще, чем меняются
  // сами сегменты, поэтому держим их под рукой вместо повторных запросов.
  const routeSegmentCacheRef = useRef<Map<string, IGeoPoint[]>>(new Map())
  // Свежие значения для долгоживущих обработчиков (подписка на модель создаётся
  // один раз и видит только первый рендер).
  const currentPositionRef = useRef<[number, number] | null>(null)
  // Заказы текущего плана — под ними сохраняется позиция маркера (подписка на
  // модель создаётся один раз и свежий план видит только через реф).
  const planOrderIdsRef = useRef<string[]>([])
  // Маршрут, скормленный модели, и точка, на которой она сейчас стоит и ждёт
  // действия водителя.
  const tripRouteKeyRef = useRef('')
  const reachedStopKeyRef = useRef('')
  // Просьба сторожа движения перестроить маршрут: сам он этого сделать не может —
  // маршрут строит эффект, а эффекту нужна смена зависимостей.
  const [routeSyncNonce, setRouteSyncNonce] = useState(0)
  // ——— Попутные заказы ———
  // Диффер помечает событием NEW_ALONG_THE_WAY_ORDER любой обычный заказ,
  // появившийся, пока водитель в поездке. Кандидатом он становится только пройдя
  // предикат (места, вид заказа, прошлые отказы) — см. alongTheWayCandidate.ts.
  // Кандидата, найденного до ухода с карты, диффер повторно не найдёт (он видит
  // только НОВЫЕ заказы), поэтому стартуем из сохранённого состояния.
  const [alongTheWayOrderIds, setAlongTheWayOrderIds] = useState<string[]>(
    () => persistedDriverDemo.alongTheWay?.orderIds ?? [],
  )
  // Попутчик, которого посадили сразу при взятии: водитель уже стоял рядом с ним,
  // поэтому шаги «Поехал»/«Приехал» пропускаем. Пока бэкенд не подтвердил Started,
  // план всё равно должен считать пассажира в салоне — иначе на пару секунд
  // вернулись бы обе бессмысленные кнопки. Тот же приём, что у
  // startedVotingOrderIds: бэкенд держит водителя в Performer, а пассажир уже едет.
  const [boardedAlongTheWayIds, setBoardedAlongTheWayIds] = useState<string[]>(
    () => persistedDriverDemo.alongTheWay?.boardedOrderIds ?? [],
  )
  // Подписка на модель живёт с deps [] и видит только первый рендер — свежий
  // контекст предиката читаем через реф (тот же приём, что у mapContextRef).
  const alongTheWayContextRef = useRef<{ userId?: IUser['u_id']; freeSeats: number }>({
    userId: undefined,
    freeSeats: 0,
  })
  // «Не брать» по заказу: решение принято один раз и повторно не предлагается.
  const declinedAlongTheWayRef = useRef<Record<string, boolean>>(
    toIdMap(persistedDriverDemo.alongTheWay?.declinedOrderIds),
  )
  // «Взять» уже отправлено: заказ уходит из свободных раньше, чем появляется в
  // моих активных, — держим точку в плане всё это время, иначе маркер на секунду
  // потеряет её и уедет мимо попутчика.
  const takingAlongTheWayRef = useRef<Record<string, boolean>>(
    toIdMap(persistedDriverDemo.alongTheWay?.takingOrderIds),
  )
  // Последний известный снимок кандидата — из него строится точка, пока заказ
  // «в пути» между списками.
  const alongTheWayOrdersRef = useRef<Record<string, IOrder>>(
    { ...(persistedDriverDemo.alongTheWay?.orders ?? {}) },
  )
  const scheduledAlongTheWayRef = useRef('')
  const alongTheWayDecisionKeyRef = useRef('')
  const latestAlongTheWayActionsRef = useRef<{ take: () => void; decline: () => void } | null>(null)
  // Manual route override: once the temporary test controls (Replace/Append/
  // Remove Last/Clear from DriverEmulatorPanel) touch the model, the automatic
  // order → setRoute pipeline stops feeding it, so the manually edited route is
  // not immediately overwritten. `manualRouteOverrideRef` is the synchronous
  // guard read inside effects; `manualRouteActive` drives rendering.
  const manualRouteOverrideRef = useRef(false)
  const [manualRouteActive, setManualRouteActive] = useState(false)
  // Геометрия, по которой реально едет модель: и многоногий план заказов, и
  // произвольный маршрут тестовых кнопок панели.
  const [emulatorRoutePolyline, setEmulatorRoutePolyline] = useState<[number, number][] | null>(null)
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

  // Свободные места в салоне с учётом уже взятых заказов: булавки заказов, куда
  // столько пассажиров не поместится, водителю показывать нечего.
  const driverFreeSeats = useMemo(
    () => getDriverFreeSeats(driverCar, activeOrders, user?.u_id),
    [driverCar, activeOrders, user?.u_id],
  )

  // Свежий контекст для предиката попутного (подписка на модель его не видит).
  alongTheWayContextRef.current = { userId: user?.u_id, freeSeats: driverFreeSeats }

  const visibleReadyOrders = useMemo(() =>
    readyOrders?.filter(item =>
      !hiddenOrderIds.includes(String(item.b_id)) &&
      canDriverTakeOrderBySeats(item, driverFreeSeats, user?.u_id),
    ) ?? null
  , [readyOrders, hiddenOrderIds.join('|'), driverFreeSeats, user?.u_id])

  const visibleMapOrders = useMemo(() => {
    const ordersById: Record<string, IOrder> = {}

    ;[
      ...(activeOrders ?? []).filter(order => canDriverTakeOrderBySeats(order, driverFreeSeats, user?.u_id)),
      ...(visibleReadyOrders ?? []),
    ].forEach(order => {
      if (!order?.b_id)
        return

      ordersById[String(order.b_id)] = order
    })

    return Object.values(ordersById)
  }, [
    driverFreeSeats,
    user?.u_id,
    // Выгода входит в ключ: она пересчитывается по мере движения такси, и без
    // неё маркеры остались бы с суммой, посчитанной на момент появления заказа.
    activeOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}:${order.profit ?? ''}`).join('|'),
    visibleReadyOrders?.map(order => `${order.b_id}:${order.b_state}:${order.b_start_latitude}:${order.b_start_longitude}:${order.drivers?.length ?? 0}:${order.profit ?? ''}`).join('|'),
  ])

  // Перцентильные группы прибыльности пересчитываются на каждое обновление набора
  // видимых заказов — карта хинтов { b_id -> группа 0..4 } для их раскраски.
  const orderProfitPercentiles = useMemo(
    () => computeProfitPercentiles(visibleMapOrders),
    [visibleMapOrders],
  )

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
    // Decision Log, стадия «карта»: на входе активные и свободные заказы, на
    // выходе — те, у кого реально отрисована булавка. Заказ без координат
    // отличается здесь от заказа, отсеянного по местам или расстоянию.
    trackOrderDecisions({
      stage: 'MAP_UI',
      orders: mergeDecisionStageOrders(activeOrders, readyOrders),
      visibleOrderIds: visibleMarkers.map(item => item.order.b_id),
      context: buildOrderDecisionContext({
        user,
        car: driverCar,
        activeOrders,
        hiddenOrderIds,
        freeSeats: driverFreeSeats,
        declinedAlongTheWayOrderIds: declinedAlongTheWayRef.current,
      }),
    })

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
    // Нужны Decision Log: свободный заказ, отсеянный по местам, до
    // visibleReadyOrders не доходит, а зафиксировать его скрытие надо.
    readyOrders?.map(order => `${order.b_id}:${order.b_state}`).join('|'),
    driverFreeSeats,
  ])

  // Не делаем reverseGeocode для всех видимых заказов на карте.
  // Массовые запросы к Nominatim быстро дают 429/CORS и ломают выбор адресов у клиента.
  // Для плашек берём только реальные адреса из заказа/options; активный заказ ниже
  // может догрузить адрес отдельно, если backend его не вернул.

  // ВСЕ заказы, которые водитель сейчас выполняет. Раньше карта знала только про
  // первый из них; с попутными заказами их может быть несколько одновременно,
  // поэтому источником истины становится список, а не единственный заказ.
  const driverActiveOrders = useMemo(() => {
    const navigationStates = [
      EBookingDriverState.Performer,
      EBookingDriverState.Arrived,
      EBookingDriverState.Started,
    ]

    return (activeOrders ?? []).reduce<Array<{ order: IOrder; driver: IDriver }>>((list, item) => {
      const driver = item.drivers?.find(driver => driver.u_id === user?.u_id)
      if (driver && navigationStates.includes(driver.c_state))
        list.push({ order: item, driver })

      return list
    }, [])
  }, [activeOrders, user?.u_id])

  // Состояние водителя по каждому его заказу — чтобы шаги разных заказов не
  // приходилось выводить из одного «текущего».
  const driverStateByOrderId = useMemo(() => {
    const states: Record<string, EBookingDriverState> = {}
    driverActiveOrders.forEach(({ order, driver }) => {
      states[String(order.b_id)] = driver.c_state
    })

    return states
  }, [driverActiveOrders])

  /**
   * Свежайшее известное состояние заказа: оптимистичное сразу после нажатия,
   * затем — пришедшее с бэкенда, как только оно догонит.
   */
  const effectiveStateOf = useCallback((orderId?: IOrder['b_id'] | null): EBookingDriverState | undefined => {
    if (orderId === undefined || orderId === null) return undefined

    const id = String(orderId)
    const backendState = driverStateByOrderId[id]
    const optimistic = optimisticDriverStates[id]
    const state = optimistic !== undefined && (backendState === undefined || optimistic > backendState) ?
      optimistic :
      backendState

    // Попутчика сажаем в момент взятия — водитель уже стоит рядом с ним. Пока
    // бэкенд не подтвердил Started, состояние здесь всё равно «в салоне»: иначе
    // план (он считает по boardedOrderIds) и кнопка разошлись бы, и водителю,
    // который уже везёт этого пассажира, предложили бы «Поехал».
    if (state !== undefined && state < EBookingDriverState.Started && boardedAlongTheWayIds.includes(id))
      return EBookingDriverState.Started

    return state
  }, [driverStateByOrderId, optimisticDriverStates, boardedAlongTheWayIds])

  // Drop each override once its order is gone or the backend has reached it.
  // Пробегаем по всем ключам: чужие оптимистичные состояния трогать нельзя,
  // иначе шаг одного заказа откатывал бы шаг другого.
  useEffect(() => {
    setOptimisticDriverStates(prev => {
      const stale = Object.keys(prev).filter(orderId => {
        const backendState = driverStateByOrderId[orderId]
        return backendState === undefined || backendState >= prev[orderId]
      })
      if (!stale.length) return prev

      const next = { ...prev }
      stale.forEach(orderId => delete next[orderId])
      return next
    })
  }, [driverStateByOrderId])

  // ——— Позиция водителя ———
  // Координата водителя одна на все его заказы, но приходит внутри каждого —
  // берём первую валидную, чтобы позиция не пропадала из-за того, что в первом
  // заказе бэкенд её ещё не заполнил.
  const backendDriverPositionKey = driverActiveOrders
    .map(({ driver }) => `${driver.c_latitude ?? ''}:${driver.c_longitude ?? ''}`)
    .join('|')

  const backendDriverPosition = useMemo((): [number, number] | null => {
    for (const { driver } of driverActiveOrders) {
      const latitude = Number(driver.c_latitude)
      const longitude = Number(driver.c_longitude)

      if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude || longitude))
        return [latitude, longitude]
    }

    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendDriverPositionKey])

  const browserDriverPosition = useMemo((): [number, number] | null => {
    if (!lastPositions || !lastPositions.length) return null
    const last = lastPositions[lastPositions.length - 1]
    return [last[0], last[1]]
  }, [lastPositions])

  // Защитный слой (суррогат «FSM-проверки» из архитектуры генерации заказов):
  // ТОЛЬКО в режиме эмулятора точки заказа могут оказаться в стороне от дорог
  // (заказ «в парке») — тогда маркер физически не доезжает до точки посадки и
  // приезд не подтвердить. Здесь мы страхуемся: спрашиваем Map Adapter о ближайшей
  // дороге и, если точка заметно оторвана от неё, используем привязанную к дороге
  // координату И для маршрута, И для проверки прибытия (обе должны совпадать).
  // Реальные (не эмуляторные) заказы НЕ трогаем — там точка пассажира точна.
  const [snappedOrderPoints, setSnappedOrderPoints] = useState<Record<string, ISnappedOrderPoints>>({})
  const snappedOrdersRef = useRef<Record<string, true>>({})

  // ——— Кандидаты в попутчики ———
  // Отмеченный заказ живёт в свободных, пока его не разобрали. Держим последний
  // снимок: между «взял» и появлением заказа в активных он не числится нигде.
  useEffect(() => {
    (readyOrders ?? []).forEach(order => {
      const id = String(order.b_id)
      if (alongTheWayOrdersRef.current[id])
        alongTheWayOrdersRef.current[id] = order
    })
  }, [readyOrders])

  const driverActiveOrderIdsKey = driverActiveOrders
    .map(({ order }) => String(order.b_id))
    .join('|')
  const readyOrderIdsKey = (readyOrders ?? []).map(order => String(order.b_id)).join('|')

  // Кандидат перестаёт быть кандидатом, когда его взяли (дальше точки даёт сам
  // заказ), отклонили или разобрал другой водитель.
  useEffect(() => {
    const activeIds = new Set(driverActiveOrderIdsKey ? driverActiveOrderIdsKey.split('|') : [])
    const readyIds = new Set(readyOrderIdsKey ? readyOrderIdsKey.split('|') : [])

    setAlongTheWayOrderIds(prev => {
      const next = prev.filter(id => {
        if (declinedAlongTheWayRef.current[id])
          return false

        if (activeIds.has(id)) {
          // Взят: точка посадки теперь приходит из активного заказа.
          delete takingAlongTheWayRef.current[id]
          delete alongTheWayOrdersRef.current[id]
          return false
        }

        if (readyIds.has(id))
          return true

        // Пропал из свободных: держим только пока идёт наше взятие.
        if (takingAlongTheWayRef.current[id])
          return true

        // Разобрал другой водитель — снимок больше не нужен.
        delete alongTheWayOrdersRef.current[id]
        return false
      })

      return next.length === prev.length ? prev : next
    })
  }, [driverActiveOrderIdsKey, readyOrderIdsKey])

  // Зеркалим решение по попутчику в модульное хранилище: карта уходит с экрана
  // вместе со всем своим состоянием, а вопрос про этого пассажира — нет.
  // `mapActionPending` в зависимостях не случаен: он переключается ровно на
  // время «взятия», когда заполняется takingAlongTheWayRef.
  useEffect(() => {
    persistedDriverDemo.alongTheWay = {
      orderIds: alongTheWayOrderIds,
      orders: { ...alongTheWayOrdersRef.current },
      declinedOrderIds: Object.keys(declinedAlongTheWayRef.current),
      takingOrderIds: Object.keys(takingAlongTheWayRef.current),
      boardedOrderIds: boardedAlongTheWayIds,
    }
  }, [
    alongTheWayOrderIds,
    boardedAlongTheWayIds,
    readyOrderIdsKey,
    driverActiveOrderIdsKey,
    mapActionPending,
  ])

  const alongTheWayCandidates = useMemo(() => {
    if (!alongTheWayOrderIds.length)
      return [] as IOrder[]

    const readyById = new Map((readyOrders ?? []).map(order => [String(order.b_id), order]))

    return alongTheWayOrderIds.reduce<IOrder[]>((list, id) => {
      const order = readyById.get(id) ?? alongTheWayOrdersRef.current[id]
      if (order)
        list.push(order)

      return list
    }, [])
  }, [alongTheWayOrderIds, readyOrders])

  // ——— План поездки ———
  // Заказы, чьи пассажиры уже в салоне. Считаем по ОПТИМИСТИЧНОМУ состоянию, а не
  // по пришедшему с бэкенда: иначе после «Приехал» кнопка уже переключилась бы на
  // «Завершить», а план ещё вёл бы к точке посадки — и водитель на несколько
  // секунд увидел бы «Прервать поездку». Голосовой заказ с подтверждённым кодом
  // тоже сюда: бэкенд оставляет такого водителя в Performer.
  const boardedOrderIds = useMemo(() => {
    const ids = new Set(startedVotingOrderIds.map(String))
    boardedAlongTheWayIds.forEach(id => ids.add(id))
    driverActiveOrders.forEach(({ order }) => {
      if ((effectiveStateOf(order.b_id) ?? 0) >= EBookingDriverState.Started)
        ids.add(String(order.b_id))
    })

    return Array.from(ids)
  }, [startedVotingOrderIds, boardedAlongTheWayIds, driverActiveOrders, effectiveStateOf])

  // Отметку снимаем, когда бэкенд подтвердил посадку: дальше состояние самого
  // заказа говорит, что пассажир в салоне, и дублировать его не нужно.
  useEffect(() => {
    setBoardedAlongTheWayIds(prev => {
      const next = prev.filter(id => (driverStateByOrderId[id] ?? 0) < EBookingDriverState.Started)
      return next.length === prev.length ? prev : next
    })
  }, [driverStateByOrderId])

  // Подпись СОСТАВА плана: заказы, их состояния и координаты плюс уже посаженные
  // пассажиры. Она меняется, только когда меняется набор точек, — но НЕ когда
  // едет маркер. Позиция водителя в план попадает через реф и в зависимостях не
  // участвует: иначе порядок обхода переключался бы на ходу и маршрут строился
  // бы заново на каждом тике (см. комментарий в tools/driverTripPlan.ts).
  const planTasksKey = [
    driverActiveOrders.map(({ order, driver }) => [
      order.b_id,
      driver.c_state,
      order.b_start_latitude,
      order.b_start_longitude,
      order.b_destination_latitude,
      order.b_destination_longitude,
    ].join(':')).join('|'),
    boardedOrderIds.join(','),
    // Кандидаты в попутчики — тоже состав плана: их точка посадки появляется и
    // исчезает вместе с решением водителя.
    alongTheWayCandidates.map(order => [
      order.b_id,
      order.b_start_latitude,
      order.b_start_longitude,
    ].join(':')).join('|'),
  ].join('#')

  // Первая позиция приходит уже после первого рендера — тогда план нужно
  // пересобрать один раз, иначе порядок останется посчитанным «из ниоткуда».
  const hasPositionForPlan = Boolean(currentPositionRef.current)

  const rawTripStops = useMemo(
    () => buildDriverTripPlan({
      activeOrders,
      userId: user?.u_id,
      position: currentPositionRef.current,
      boardedOrderIds,
      candidateOrders: alongTheWayCandidates,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planTasksKey, hasPositionForPlan],
  )

  const planOrderIds = getTripPlanOrderIds(rawTripStops)
  const planOrderIdsKey = planOrderIds.join('|')
  const tripPlanOrderCount = planOrderIds.length
  planOrderIdsRef.current = planOrderIds

  // Где маркер стоял, когда карту в прошлый раз закрыли. Живёт ровно до первого
  // тика модели: пока его нет, именно эта точка — «где сейчас водитель», и от
  // неё же строится маршрут, поэтому поездка продолжается, а не начинается
  // заново от последней координаты с бэкенда.
  const restoredDemoPosition = useMemo(
    () => getPersistedDemoPosition(planOrderIds),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planOrderIdsKey],
  )

  // Привязываем к дорогам точки ВСЕХ заказов плана. Каждый заказ обрабатываем
  // один раз (`snappedOrdersRef`) — иначе появление второго заказа заново
  // дёргало бы Map Adapter по уже привязанным точкам.
  useEffect(() => {
    if (!emulatorOrdersEnabled) {
      // Вне эмулятора точки заказа точны — привязка не нужна и не должна
      // оставаться от прошлой сессии.
      snappedOrdersRef.current = {}
      setSnappedOrderPoints(previous => (Object.keys(previous).length ? {} : previous))
      return
    }

    const pending: IOrder[] = []
    rawTripStops.forEach(({ order, orderId }) => {
      if (snappedOrdersRef.current[orderId])
        return

      snappedOrdersRef.current[orderId] = true
      pending.push(order)
    })
    if (!pending.length)
      return

    let cancelled = false
    ;(async() => {
      const snapped = await Promise.all(pending.map(order => snapOrderPoints(order)))
      if (cancelled)
        return

      const next: Record<string, ISnappedOrderPoints> = {}
      pending.forEach((order, index) => {
        const points = snapped[index]
        if (points.start || points.destination)
          next[String(order.b_id)] = points
      })
      if (Object.keys(next).length)
        setSnappedOrderPoints(prev => ({ ...prev, ...next }))
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emulatorOrdersEnabled, planOrderIdsKey])

  // Снап точек к дорогам применяется к РЕЗУЛЬТАТУ плана, а не ко входу: иначе
  // привязка меняла бы порядок обхода, а порядок — то, что нужно привязывать.
  const tripStops = useMemo(
    () => rawTripStops.map(stop => {
      const snapped = snappedOrderPoints[stop.orderId]
      const point = stop.kind === ETripStopKind.Pickup ? snapped?.start : snapped?.destination

      return point ? { ...stop, lat: point[0], lng: point[1] } : stop
    }),
    [rawTripStops, snappedOrderPoints],
  )

  const currentStop = tripStops[0] ?? null
  // Кнопка шага относится к ближайшему ВЗЯТОМУ заказу: точка попутчика своих
  // шагов не имеет (см. getTripActionStop).
  const actionStop = getTripActionStop(tripStops)
  const isLastTripStop = isFinalTripStop(tripStops)

  // Ключ геометрии маршрута: состав плана ПЛЮС координаты. Привязка точки к
  // дороге меняет геометрию, не меняя состав, — без координат в ключе такой
  // маршрут не был бы перестроен.
  const tripRouteKey = tripStops
    .map(stop => `${getTripStopKey(stop)}@${stop.lat.toFixed(5)},${stop.lng.toFixed(5)}`)
    .join('|')

  // Заказы, которые ещё предстоит забрать, и заказы, чьи пассажиры уже в салоне.
  const pickupPendingOrderIds = useMemo(
    () => new Set(
      tripStops.filter(stop => stop.kind === ETripStopKind.Pickup).map(stop => stop.orderId),
    ),
    [tripStops],
  )

  const dropoffOnlyOrderIds = useMemo(
    () => new Set(
      tripStops
        .filter(stop => stop.kind === ETripStopKind.Dropoff && !pickupPendingOrderIds.has(stop.orderId))
        .map(stop => stop.orderId),
    ),
    [tripStops, pickupPendingOrderIds],
  )

  const routeOrder = currentStop?.order ?? null
  const routeOrderIsVoting = isVotingOrder(routeOrder)

  // The button/marker follow the freshest known state: the optimistic override the
  // moment the driver taps, then the polled backend state once it catches up.
  const effectiveDriverState = effectiveStateOf(actionStop?.orderId)

  // Фаза поездки больше не выводится из статуса заказа: «едем к высадке» — это
  // просто `currentStop.kind === Dropoff`. Для голосового заказа с подтверждённым
  // кодом это работает само собой: план считает его посаженным и оставляет
  // только высадку.

  // Маркер стоит на месте сразу после взятия заказа (Performer) и трогается,
  // когда водитель нажал «Поехал». Дальше «машина едет» — свойство поездки, а не
  // текущей точки: если водитель уже выехал по какому-то заказу или везёт
  // пассажира, останавливаться из-за того, что ближайшая точка принадлежит
  // только что появившемуся попутчику, нельзя.
  const hasDeparted = Boolean(
    currentStop && (
      dropoffOnlyOrderIds.size > 0 ||
      tripStops.some(stop =>
        !stop.pending &&
        (effectiveStateOf(stop.orderId) ?? 0) >= EBookingDriverState.Arrived,
      )
    ),
  )

  // The current driver is "me". While any emulator session is running and I have
  // something to drive to, the emulator model drives my marker along the planned
  // route instead of showing my real GPS. Намеренно НЕ зависит от нарисованного
  // маршрута: тот перестраивается по ходу движения, и движение маркера не должно
  // от него дёргаться.
  const isDemoMapMovementEnabled = Boolean(tripStops.length && emulatorOrdersEnabled)

  // Мемоизируем текущую позицию маркера (чтобы React не пересоздавал <Marker> из-за новой ссылки на массив).
  // Вместе с точкой возвращается её источник: он ничего не меняет в поведении
  // карты, но без него в журнале нельзя отличить смену провайдера координат от
  // реального перемещения водителя.
  const resolvedPosition = useMemo((): {
    point: [number, number] | null
    source: TDriverPositionSource
  } => {
    // Demo movement OR the manual test controls both drive the marker via the
    // route emulator model, so honour its position first.
    if ((isDemoMapMovementEnabled || manualRouteActive) && demoDriverPosition)
      return { point: demoDriverPosition, source: 'EMULATOR_ROUTE' }

    // Карта только что открылась заново, а модель ещё не сделала ни одного тика.
    // Водитель в этот момент там, где его застало переключение вкладки, — иначе
    // маркер (и строящийся от него маршрут) откатился бы к координате с
    // бэкенда, то есть к месту, где водитель стоял до начала поездки.
    if (isDemoMapMovementEnabled && restoredDemoPosition)
      return { point: restoredDemoPosition, source: 'EMULATOR_RESTORED' }

    // Заказ закрыт, план пуст — но водитель никуда не телепортировался: он там,
    // где закончил прошлую поездку. Без этого маркер (а с ним и точка, вокруг
    // которой генерируются новые заказы) откатывался к GPS браузера, то есть к
    // домашнему гео, хотя заказ мог закрыться на другом конце города.
    if (emulatorOrdersEnabled) {
      const parkedPosition = getDriverParkedPosition()
      if (parkedPosition) return { point: parkedPosition, source: 'PARKED' }
    }

    // Client emulator создаёт пассажирские заказы, но водитель остаётся реальным.
    // Поэтому сначала берём GPS этого браузера, а серверную координату используем
    // только как fallback, пока GPS ещё не пришёл.
    if (isClientEmulatorMode && !isDriverEmulatorMode && browserDriverPosition)
      return { point: browserDriverPosition, source: 'BROWSER_GPS' }

    if (backendDriverPosition) return { point: backendDriverPosition, source: 'BACKEND' }
    if (browserDriverPosition) return { point: browserDriverPosition, source: 'BROWSER_GPS' }
    return { point: null, source: 'NONE' }
  }, [
    isDemoMapMovementEnabled,
    manualRouteActive,
    demoDriverPosition,
    restoredDemoPosition,
    emulatorOrdersEnabled,
    isClientEmulatorMode,
    isDriverEmulatorMode,
    browserDriverPosition,
    backendDriverPosition,
  ])

  const currentPosition = resolvedPosition.point

  currentPositionRef.current = currentPosition

  // Булавка с цветным хинтом стоит в точке посадки и служит выбору заказа
  // («Куда», выгода, конкуренты). Пассажир сел, водитель поехал к высадке —
  // точка посадки позади, выбирать нечего: булавку убираем. Маршрут дальше
  // показывают метки «Откуда/Куда» и полилиния.
  const markerMapOrders = useMemo(
    () => visibleMapOrders.filter(order => {
      // Пассажир уже в салоне — в плане у заказа осталась только высадка,
      // выбирать по его точке посадки нечего.
      if (dropoffOnlyOrderIds.has(String(order.b_id)))
        return false

      // План держится на активных заказах водителя, а они пропадают, как только
      // поездка завершена — состояние самого заказа надёжнее: раз посадка
      // состоялась (Started/Finished), булавка не должна вернуться.
      const myState = order.drivers?.find(driver => driver.u_id === user?.u_id)?.c_state
      return myState === undefined || myState < EBookingDriverState.Started
    }),
    [visibleMapOrders, dropoffOnlyOrderIds, user?.u_id],
  )

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

    driverMapGateway.reverseGeocode(
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
    const order = actionStop?.order
    if (!order) return

    rememberOptimisticState(order.b_id, EBookingDriverState.Arrived)
    runMapOrderTransition(order.b_id, () =>
      driverMapGateway.arrive(order.b_id, isVotingOrder(order)),
    )
  }

  // "Приехал": en route (Arrived) → started. Voting orders confirm the boarding
  // code in the order-details card, so open it instead of transitioning directly.
  const onMapStartedClick = () => {
    const order = actionStop?.order
    if (!order) return

    if (isVotingOrder(order)) {
      void driverMapGateway.openCard(order.b_id)
      return
    }

    rememberOptimisticState(order.b_id, EBookingDriverState.Started)
    runMapOrderTransition(order.b_id, () => driverMapGateway.start(order.b_id))
  }

  // "Завершить поездку": started → finished, then close the order view.
  const onCompleteOrderClick = () => {
    const order = actionStop?.order
    if (!order || mapActionPending) return

    // Остались ли после этого заказа другие точки — тогда поездка продолжается,
    // и уходить с карты (как и сбрасывать прогресс маркера) нельзя.
    const planContinues = tripStops.some(stop => stop.orderId !== String(order.b_id))

    // Смена продолжается там, где закрылся заказ. Сохранённая под план позиция
    // сейчас будет сброшена вместе с самим планом, поэтому точку высадки
    // запоминаем отдельно — от неё водитель и поедет дальше, вокруг неё же
    // появятся следующие заказы.
    // У настоящего водителя его место знает GPS, и подменять его нечем и незачем.
    const finishPosition = emulatorOrdersEnabled ?
      currentPositionRef.current ?? toOrderDestinationPoint(order) :
      null
    if (finishPosition)
      rememberDriverParkedPosition(finishPosition, { immediate: true })

    // The trip is over, so drop the persisted demo state — otherwise coming back
    // to the map would try to restore a finished order's marker/button. Чистим
    // только этот заказ: у водителя может остаться попутчик в салоне.
    if (persistedDriverDemo.optimistic)
      delete persistedDriverDemo.optimistic[String(order.b_id)]
    if (!planContinues) {
      persistedDriverDemo.position = null
      persistedDriverDemo.alongTheWay = null
    }
    forgetOptimisticState(order.b_id)
    setBoardedAlongTheWayIds(prev => prev.filter(id => id !== String(order.b_id)))
    setMapActionPending(true)
    driverMapGateway.finish(order.b_id)
      .catch(error => console.error(error))
      .finally(() => {
        setStartedVotingOrderIds(removeStoredStartedVotingOrderId(order.b_id))
        refreshMapOrderState(order.b_id)
        setMapActionPending(false)
        if (planContinues)
          return

        // The rating modal is opened by the finished-order effect in Driver/index;
        // opening it here too would pop it twice.
        navigate(PLATFORM_ROUTES.DriverOrders, { query: { tab: EDriverTabs.Lite } })
      })
  }

  // "Прервать поездку": the trip is under way but the driver is not at the
  // dropoff, so ending it now is a cancellation and must carry a reason.
  const onInterruptTripClick = () => {
    const order = actionStop?.order
    if (!order || mapActionPending) return

    // Deliberately no persistedDriverDemo reset here: the driver can still back
    // out of the reason modal, and clearing it would restart the marker.
    setDriverTripCancelModal({ isOpen: true, orderId: order.b_id })
  }

  // Действие относится к БЛИЖАЙШЕЙ точке плана, а не к «единственному заказу».
  // Когда заказов несколько, к подписи добавляем номер заказа — иначе непонятно,
  // к кому относится «Приехал».
  const mapPrimaryAction = useMemo(() => {
    const driverState = effectiveDriverState
    const order = actionStop?.order
    if (!order || !driverState)
      return null

    const orderSuffix = tripPlanOrderCount > 1 ?
      ` ${getOrderIdText(order.b_id, (activeOrders || []).map(item => item.b_id))}` :
      ''

    // Accepted order: the car is parked, prompt the driver to depart.
    if (driverState === EBookingDriverState.Performer)
      return {
        text: `${t(TRANSLATION.WENT)}${orderSuffix}`,
        orderSuffix,
        className: 'finish-drive-button--started',
        onClick: onMapArrivedClick,
      }

    // Pickup leg: prompt arrival at the passenger (voting confirms the boarding
    // code via the card instead).
    if (driverState === EBookingDriverState.Arrived)
      return {
        text: (isVotingOrder(order) ?
          t(TRANSLATION.DRIVER_VOTING_CONFIRM_CODE) :
          t(TRANSLATION.ARRIVED)) + orderSuffix,
        orderSuffix,
        className: 'finish-drive-button--arrived',
        onClick: onMapStartedClick,
        // Both actions mean "I am at the passenger": confirming the boarding
        // code and tapping "Приехал" require actually reaching the pickup point.
        requiresPickupArrival: true,
      }

    // Trip in progress: prompt completion, which closes the order. Until the
    // driver actually reaches the dropoff the render site swaps this for an
    // attributed interruption (same idiom as requiresPickupArrival above).
    if (driverState === EBookingDriverState.Started)
      return {
        // Промежуточная высадка закрывает один заказ, а поездка продолжается —
        // «Завершить поездку» там врало бы. На последней точке наоборот: заказ
        // один, уточнять номер нечем и незачем.
        text: isLastTripStop ?
          t(TRANSLATION.CLOSE_DRIVE) :
          `${t(TRANSLATION.FINISH_ORDER)}${orderSuffix}`,
        orderSuffix,
        className: 'finish-drive-button--finished',
        onClick: onCompleteOrderClick,
        requiresDestinationArrival: true,
      }

    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    effectiveDriverState,
    actionStop?.orderId,
    actionStop?.kind,
    isLastTripStop,
    tripPlanOrderCount,
    routeOrderIsVoting,
    mapActionPending,
  ])

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

  // Keep the values the (long-lived) route provider reads up to date.
  wayGraphRef.current = wayGraph ?? undefined

  // Create the route emulator once. Каждый сегмент строится по-настоящему между
  // своими from/to: маршрут теперь многоногий (посадки и высадки нескольких
  // заказов), и переиспользование одной готовой полилинии схлопнуло бы все ноги
  // в одну. Чтобы не бить по маршрутизатору на каждом перестроении, готовые
  // сегменты кэшируем — состав плана меняется куда чаще, чем сами сегменты.
  useEffect(() => {
    const model = new DriverRouteEmulator({
      speedMps: DEMO_DRIVER_ROUTE_SPEED_MPS,
      routeProvider: async(from, to) => {
        const cacheKey = [
          from.lat.toFixed(5), from.lng.toFixed(5),
          to.lat.toFixed(5), to.lng.toFixed(5),
        ].join(',')

        const cached = routeSegmentCacheRef.current.get(cacheKey)
        if (cached)
          return cached

        const info = await driverMapGateway.makeRoutePoints(
          { latitude: from.lat, longitude: from.lng },
          { latitude: to.lat, longitude: to.lng },
          wayGraphRef.current,
        )
        const points = info.points.map(([lat, lng]) => ({ lat, lng }))

        // Кэш ограничен: у долгой смены сегментов накапливается много, а нужны
        // только недавние (ноги текущего плана).
        if (routeSegmentCacheRef.current.size >= ROUTE_SEGMENT_CACHE_LIMIT) {
          const oldest = routeSegmentCacheRef.current.keys().next().value
          if (oldest !== undefined)
            routeSegmentCacheRef.current.delete(oldest)
        }
        routeSegmentCacheRef.current.set(cacheKey, points)

        return points
      },
    })
    routeEmulatorRef.current = model

    const unsubscribe = model.subscribe(event => {
      if (event.type === 'tick') {
        setDemoDriverPosition([event.position.lat, event.position.lng])
        // Точка живёт дольше поездки: заказ закроется — план опустеет вместе с
        // сохранённой под него позицией, а водитель останется здесь же.
        rememberDriverParkedPosition([event.position.lat, event.position.lng])
        // Stash where the marker is so a tab switch can resume from there.
        const orderIds = planOrderIdsRef.current
        if (orderIds.length)
          persistedDriverDemo.position = {
            orderIds,
            lat: event.position.lat,
            lng: event.position.lng,
          }
      } else if (event.type === 'waypoint-reached') {
        // Раньше маркер вставал у цели просто потому, что маршрут был из двух
        // точек. Теперь точек несколько, поэтому на каждой останавливаемся сами
        // и ждём действия водителя (посадка/высадка) — движение возобновит смена
        // состава плана, которая перестроит маршрут от текущей позиции.
        const stopKey = (event.waypoint.meta as { stopKey?: string } | undefined)?.stopKey
        if (stopKey) {
          model.pause()
          reachedStopKeyRef.current = stopKey
        }
      } else if (event.type === 'route-loaded') {
        const state = model.getState()
        if (state.position)
          setDemoDriverPosition([state.position.lat, state.position.lng])
        // Геометрия модели — то, по чему маркер реально едет; её же и рисуем,
        // поэтому линия и движение не могут разойтись.
        setEmulatorRoutePolyline(
          state.polyline.length > 1 ? state.polyline.map(point => [point.lat, point.lng]) : null,
        )
      } else if (event.type === 'route-cleared')
        setEmulatorRoutePolyline(null)
      else if (event.type === 'external-event') {
        // Модель только ретранслирует событие — решает потребитель. Вот здесь и
        // принимается решение по попутному: заказ, прошедший предикат, попадает
        // в план отдельной точкой посадки (pending), до которой водитель доедет
        // и там скажет «взять» или «не брать».
        if (event.event.type === EDriverExternalEventType.NewAlongTheWayOrder) {
          const candidate = (event.event.payload as { order?: IOrder } | undefined)?.order
          const context = alongTheWayContextRef.current
          const isCandidate = isAlongTheWayCandidate(candidate, {
            userId: context.userId,
            freeSeats: context.freeSeats,
            declinedOrderIds: declinedAlongTheWayRef.current,
          })

          if (candidate && isCandidate) {
            const orderId = String(candidate.b_id)
            setAlongTheWayOrderIds(prev => {
              // Ровно один попутчик за раз. Эмулятор клиентов сыплет заказами
              // каждые полминуты, и без этого маршрут обрастал бы точками, по
              // которым водитель не успевает принимать решения.
              if (prev.length || prev.includes(orderId))
                return prev

              alongTheWayOrdersRef.current[orderId] = candidate
              return [...prev, orderId]
            })
          }
        }

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

  // Feed the planned route into the model and start/stop movement.
  //
  // Ключ — подпись плана вместе с координатами точек. Намеренно НЕ зависим от
  // нарисованного маршрута: раньше он перестраивался от текущей позиции по мере
  // движения, каждое такое перестроение выглядело как «новый маршрут» и вызывало
  // setRoute() посреди поездки — маркер дёргался на каждом тике. Модель кормим
  // ровно один раз на состав плана; дальше она сама владеет своей геометрией и
  // двигается по ней через step()/tick.
  //
  // Каждое перестроение начинает маршрут ПОД маркером, поэтому пройденная
  // дистанция всегда обнуляется законно и никакого восстановления прогресса не
  // требуется — где водитель был, там маршрут и начинается.
  useEffect(() => {
    const model = routeEmulatorRef.current
    if (!model)
      return

    // The temporary test controls took the model over — leave its route alone.
    if (manualRouteOverrideRef.current)
      return

    if (!isDemoMapMovementEnabled || !tripStops.length) {
      tripRouteKeyRef.current = ''
      reachedStopKeyRef.current = ''
      model.clearRoute()
      setDemoDriverPosition(null)
      return
    }

    // Геометрия у модели уже есть и она та же — трогать её нельзя. Сверяемся не
    // только с ключом, но и с самой моделью: после возвращения на карту модель
    // создаётся заново и пустая, и ключ от прошлой жизни (его мог восстановить
    // сторож ниже) не должен помешать построить маршрут.
    if (tripRouteKeyRef.current === tripRouteKey && model.getState().waypoints.length > 1) {
      // Состав маршрута тот же, но флаг «поехал» мог только что переключиться
      // (например, сразу после «Поехал»). Держим маркер в согласии с ним, но не
      // трогаем стоянку на достигнутой точке — там ждём действия водителя.
      if (hasDeparted && !reachedStopKeyRef.current)
        model.resume()
      else
        model.pause()
      return
    }
    tripRouteKeyRef.current = tripRouteKey
    reachedStopKeyRef.current = ''

    // Маршрут начинается там, где водитель стоит СЕЙЧАС (сразу после
    // возвращения на карту — там, где его застало переключение вкладки), и
    // ведёт через все оставшиеся точки плана по очереди. Отматывать по нему
    // пройденную дистанцию не нужно и нельзя: она измерена по прошлой
    // геометрии, а эта начинается ровно под маркером.
    const origin = currentPositionRef.current ??
      restoredDemoPosition ??
      [tripStops[0].lat, tripStops[0].lng]

    model.setRoute([
      { lat: origin[0], lng: origin[1], type: ERouteWaypointType.Custom },
      ...tripStops.map(stop => ({
        lat: stop.lat,
        lng: stop.lng,
        type: stop.kind === ETripStopKind.Pickup ?
          ERouteWaypointType.Pickup :
          ERouteWaypointType.Dropoff,
        orderId: stop.orderId,
        meta: { stopKey: getTripStopKey(stop), pending: Boolean(stop.pending) },
      })),
    ]).then(() => {
      // Маршрут построен ровно из-под маркера, а маркер может стоять НА первой
      // точке: до ухода с карты модель уже доехала до неё и ждала действия
      // водителя. Возобновлять движение в этом случае нельзя — иначе маркер
      // сполз бы с точки, а вместе с ним уехал бы и вопрос «взять попутчика?».
      const firstStop = tripStops[0]
      const parkedAtFirstStop = firstStop.kind === ETripStopKind.Pickup ?
        isAtPickupPoint(origin, firstStop.lat, firstStop.lng) :
        isAtDestinationPoint(origin, firstStop.lat, firstStop.lng)

      if (parkedAtFirstStop)
        reachedStopKeyRef.current = getTripStopKey(firstStop)

      // Stay parked at the start until the driver taps "Поехал"; only then move.
      if (hasDeparted && !parkedAtFirstStop)
        model.resume()
      else
        model.pause()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMapMovementEnabled, tripRouteKey, hasDeparted, routeSyncNonce])

  const centerOnDriver = () => {
    if (!currentPosition) return
    if (isLeafletMapConnected(map))
      safeLeafletAction(() => map.setView(currentPosition, Math.max(map.getZoom(), 16)))
  }

  // Карта открывается там, где водитель, — один раз, на первой известной точке.
  // После завершённого заказа это место высадки, а не домашнее гео: центр карты
  // кэширован с прошлого просмотра и сам туда не приедет. Поездку в кадр берёт
  // fitBounds по плану, поэтому при живом маршруте не вмешиваемся.
  useEffect(() => {
    if (centeredOnOpenRef.current || !currentPosition)
      return

    centeredOnOpenRef.current = true
    if (currentStop || !isLeafletMapConnected(map))
      return

    safeLeafletAction(() => map.setView(currentPosition, Math.max(map.getZoom(), 15)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, currentPosition, currentStop])

  // Точка подачи текущего заказа — уже привязанная к дороге, если привязка была
  // нужна. Служит запасным началом маршрута и базой для тестовых точек панели;
  // сами метки поездки рисуются по точкам плана.
  const currentOrderStart = useMemo((): [number, number] | null => {
    if (!routeOrder?.b_start_latitude || !routeOrder?.b_start_longitude) return null

    const snapped = snappedOrderPoints[String(routeOrder.b_id)]?.start
    return snapped ?? [routeOrder.b_start_latitude, routeOrder.b_start_longitude]
  }, [routeOrder?.b_start_latitude, routeOrder?.b_start_longitude, routeOrder?.b_id, snappedOrderPoints])

  // Publish the resolved position so the order-details surfaces judge arrival by
  // the same marker the driver sees, instead of raw device GPS (which stands
  // still while the route emulator drives the marker).
  useEffect(() => {
    publishDriverPosition(resolvedPosition.point, resolvedPosition.source)
  }, [resolvedPosition])

  // Поездка наружу: клиентский эмулятор по фазе выбирает момент, когда подбросить
  // попутный заказ (до посадки / после), а по цели — куда его посадить, чтобы он
  // действительно оказался по пути. Пока водитель не выехал, фазы нет —
  // попутчик в этот момент бессмысленен. Цель — точка ВЗЯТОГО заказа: вести
  // эмулятор на точку кандидата, которого он сам и создал, значит зациклиться.
  const publishedTripPhase: TDriverTripPhase | null = !hasDeparted || !actionStop ?
    null :
    (actionStop.kind === ETripStopKind.Pickup ? 'to-pickup' : 'to-dropoff')
  const publishedTripTargetKey = actionStop ? `${actionStop.lat},${actionStop.lng}` : ''

  useEffect(() => {
    publishDriverTrip({
      phase: publishedTripPhase,
      target: actionStop ? [actionStop.lat, actionStop.lng] : null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publishedTripPhase, publishedTripTargetKey])

  useEffect(() => () => publishDriverTrip({ phase: null, target: null }), [])

  // The driver has "reached the pickup" once they are within ~100 m of it — the
  // same threshold the order-details card uses to allow marking arrival. Gates the
  // boarding-code confirmation so it cannot happen before reaching the passenger.
  // Считаем по ТЕКУЩЕЙ точке плана: у неё уже известен вид (посадка/высадка), и
  // радиус прибытия берётся соответствующий.
  const isAtStop = useCallback((stop: ITripStop | null) => {
    if (!stop)
      return false

    return stop.kind === ETripStopKind.Pickup ?
      isAtPickupPoint(currentPosition, stop.lat, stop.lng) :
      isAtDestinationPoint(currentPosition, stop.lat, stop.lng)
  }, [currentPosition])

  // Гейт шага поездки считаем по той же точке, к которой относится кнопка.
  const hasReachedCurrentStop = isAtStop(actionStop)

  // Прежние имена сохраняем: по ним гейтятся кнопки и авто-шаги.
  const hasReachedPickup = actionStop?.kind === ETripStopKind.Pickup && hasReachedCurrentStop
  // Same idea for the dropoff: it decides whether ending the trip means
  // "completed" or "interrupted".
  const hasReachedDestination = actionStop?.kind === ETripStopKind.Dropoff && hasReachedCurrentStop

  // ——— Решение по попутчику ———
  // Момент решения — приезд к его точке посадки: модель уже встала на
  // waypoint-reached, водителю остаётся сказать «беру» или «не беру». Пока
  // взятие в полёте, спрашивать больше не о чем: точка ещё держится в плане, но
  // решение уже принято — иначе окно открылось бы второй раз поверх ответа.
  const alongTheWayDecisionStop =
    currentStop?.pending &&
    !takingAlongTheWayRef.current[currentStop.orderId] &&
    isAtStop(currentStop) ?
      currentStop :
      null

  // «Не брать»: заказ уходит из кандидатов, план пересобирается без его точки, и
  // перестроение маршрута само снимает модель с паузы.
  const declineAlongTheWayOrder = (order: IOrder) => {
    const orderId = String(order.b_id)
    declinedAlongTheWayRef.current[orderId] = true
    delete takingAlongTheWayRef.current[orderId]
    delete alongTheWayOrdersRef.current[orderId]
    setAlongTheWayOrderIds(prev => prev.filter(id => id !== orderId))
    // Взятие могло сорваться уже после отметки о посадке — снимаем и её.
    setBoardedAlongTheWayIds(prev => prev.filter(id => id !== orderId))
  }

  // «Взять»: заказ принимается по-настоящему, а не только визуально. Точку из
  // плана НЕ снимаем — она держится до появления заказа в активных, иначе маркер
  // на секунду останется без ближайшей точки и уедет мимо попутчика.
  const takeAlongTheWayOrder = (order: IOrder) => {
    const orderId = String(order.b_id)
    if (takingAlongTheWayRef.current[orderId] || mapActionPending)
      return

    // Пока ехали, состав активных заказов мог измениться — мест может уже не быть.
    const freeSeats = getDriverFreeSeats(driverCar, activeOrders, user?.u_id)
    if (!canDriverTakeOrderBySeats(order, freeSeats, user?.u_id)) {
      declineAlongTheWayOrder(order)
      return
    }

    takingAlongTheWayRef.current[orderId] = true
    setMapActionPending(true)
    backendGateway.takeOrder(order.b_id, { performers_price: 0 }, false)
      .then(async() => {
        // Водитель уже стоит у попутчика: «Поехал» ему ехать некуда, а «Приехал»
        // подтверждать нечего — он приехал ещё до того, как взял заказ. Сажаем
        // пассажира сразу, чтобы в плане у заказа осталась только высадка и
        // движение продолжилось без двух бессмысленных нажатий.
        setBoardedAlongTheWayIds(prev => (prev.includes(orderId) ? prev : [...prev, orderId]))
        // Бэкенд ведёт заказ по шагам, перепрыгнуть через Arrived нельзя.
        // Ошибки не блокируют поездку — демо-бэкенд отвечает шумом и на успешный
        // переход (тот же приём, что в runMapOrderTransition).
        await driverMapGateway.arrive(order.b_id).catch(error => console.error(error))
        await driverMapGateway.start(order.b_id).catch(error => console.error(error))
        refreshMapOrderState(order.b_id)
        // Страховка: если заказ так и не появился в активных, точка «на пробу»
        // осталась бы в плане навсегда, а маркер — стоять на ней без вопроса.
        const timer = setTimeout(() => {
          if (takingAlongTheWayRef.current[orderId])
            declineAlongTheWayOrder(order)
        }, ALONG_THE_WAY_TAKE_TIMEOUT_MS)
        autoProgressTimers.current.push(timer)
      })
      .catch(error => {
        // Не удалось (обычно заказ уже разобрали) — это тот же отказ, иначе
        // маркер остался бы стоять на точке, которую некому подтвердить.
        console.error(error)
        declineAlongTheWayOrder(order)
      })
      .finally(() => setMapActionPending(false))
  }

  // Отложенные вызовы (таймер Строгого, окно Реалистичного) должны звать свежие
  // обработчики — тот же приём, что и у latestPrimaryActionRef.
  latestAlongTheWayActionsRef.current = alongTheWayDecisionStop ?
    {
      take: () => takeAlongTheWayOrder(alongTheWayDecisionStop.order),
      decline: () => declineAlongTheWayOrder(alongTheWayDecisionStop.order),
    } :
    null

  // Кандидат сменился или исчез (разобрали) — прошлое окно решения неактуально.
  useEffect(() => {
    const decisionKey = alongTheWayDecisionStop ? `${alongTheWayDecisionStop.orderId}:take-along` : ''
    if (alongTheWayDecisionKeyRef.current && alongTheWayDecisionKeyRef.current !== decisionKey) {
      dismissOrderModeDecision(alongTheWayDecisionKeyRef.current)
      // Канал окна-решения один: вопрос про попутчика мог вытеснить окно шага
      // поездки. Снимаем отметку «шаг уже показан», иначе его больше не
      // предложат и водитель зависнет на точке.
      autoProgressStepRef.current = ''
    }

    alongTheWayDecisionKeyRef.current = decisionKey
  }, [alongTheWayDecisionStop?.orderId])

  // Авто-режимы для попутного. Ручной обрабатывается кнопками при рендере —
  // здесь только Реалистичный (окно с отсчётом) и Строгий (берём сам + тост).
  useEffect(() => {
    const stop = alongTheWayDecisionStop
    if (!stop || mapActionPending)
      return
    if (orderControlMode === EOrderControlMode.Manual)
      return

    const decisionKey = `${stop.orderId}:take-along`

    if (orderControlMode === EOrderControlMode.Strict) {
      if (scheduledAlongTheWayRef.current === decisionKey)
        return
      scheduledAlongTheWayRef.current = decisionKey

      const { suffix } = getOrderIdParts(stop.order.b_id, (activeOrders || []).map(item => item.b_id))
      const timer = setTimeout(() => {
        showOrderModeToast({
          id: decisionKey,
          orderLabel: `${t(TRANSLATION.ORDER_MODE_ORDER_WORD)} №${suffix}`,
          message: t(TRANSLATION.ORDER_MODE_TOAST_ALONG_THE_WAY),
          duration: STRICT_STEP_TOAST_MS,
        })
        // Замок снимаем: если взятие не прошло, эффект перепланирует шаг.
        scheduledAlongTheWayRef.current = ''
        latestAlongTheWayActionsRef.current?.take()
      }, STRICT_STEP_DELAY_MS)
      autoProgressTimers.current.push(timer)
      return
    }

    // Реалистичный — окно с выбором; по истечении 5 с заказ берётся.
    requestOrderModeDecision({
      id: decisionKey,
      orderLabel: [
        t(TRANSLATION.ORDER_MODE_ORDER_WORD),
        getOrderIdText(stop.order.b_id, (activeOrders || []).map(item => item.b_id)),
      ].filter(Boolean).join(' '),
      title: t(TRANSLATION.ORDER_MODE_DECISION_ALONG_THE_WAY_TITLE),
      description: t(TRANSLATION.ORDER_MODE_DECISION_ALONG_THE_WAY_DESC),
      actionText: t(TRANSLATION.TAKE_ORDER),
      cancelText: t(TRANSLATION.DONT_GO),
      seconds: 5,
      onConfirm: () => latestAlongTheWayActionsRef.current?.take(),
      onCancel: () => latestAlongTheWayActionsRef.current?.decline(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alongTheWayDecisionStop?.orderId, orderControlMode, mapActionPending, activeOrders])

  // Keep the values the (long-lived) command/manual handlers read up to date.
  mapContextRef.current = { position: currentPosition, orderStart: currentOrderStart }
  // Всегда держим ссылку на актуальное действие шага, чтобы отложенный вызов не
  // сработал по устаревшему замыканию (иначе действие могло «не сработать» и маркер
  // застревал на точке посадки).
  latestPrimaryActionRef.current = mapPrimaryAction
  // ...и ключ шага, которому это действие принадлежит: «свежее действие» без
  // проверки, ТОТ ЛИ это шаг, закрывает следующий заказ вместо текущего.
  latestAutoStepKeyRef.current = actionStop && effectiveDriverState !== undefined ?
    `${actionStop.orderId}:${actionStop.kind}:${effectiveDriverState}` :
    ''

  // Авто-режимы (Строгий/Реалистичный): ведём поездку по шагам автоматически.
  // Действие берём из mapPrimaryAction, а гейт — из достижения точки демо-маркером
  // (те же hasReachedPickup/hasReachedDestination, что у ручных кнопок).
  // Строгий — выполняем шаг сам (с задержкой и тостом); Реалистичный — показываем
  // окно с выбором (по таймеру шаг выполняется автоматически, вторая — отмена поездки).
  useEffect(() => {
    if (orderControlMode === EOrderControlMode.Manual)
      return
    const order = actionStop?.order
    if (!order || isVotingOrder(order))
      return
    if (mapActionPending || !mapPrimaryAction)
      return
    // Пока решается судьба попутчика, шаг поездки не подгоняем: иначе окно
    // решения и окно шага открылись бы одно поверх другого.
    if (alongTheWayDecisionStop)
      return

    const state = effectiveDriverState
    if (state === undefined)
      return

    if (mapPrimaryAction.requiresPickupArrival && !hasReachedPickup)
      return
    if (mapPrimaryAction.requiresDestinationArrival && !hasReachedDestination)
      return

    // Вид точки входит в ключ: у одного заказа посадка и высадка — разные шаги,
    // и при двух заказах шаги не должны схлопываться между собой.
    // Тот же вид, что у latestAutoStepKeyRef — по нему сверяется отложенный шаг.
    const stepKey = `${actionStop.orderId}:${actionStop.kind}:${state}`

    const meta = (() => {
      switch (state) {
        case EBookingDriverState.Performer:
          return {
            title: t(TRANSLATION.ORDER_MODE_DECISION_DEPART_TITLE),
            description: t(TRANSLATION.ORDER_MODE_DECISION_DEPART_DESC),
            toast: t(TRANSLATION.ORDER_MODE_TOAST_DEPART),
          }
        case EBookingDriverState.Arrived:
          return {
            title: t(TRANSLATION.ORDER_MODE_DECISION_ARRIVED_TITLE),
            description: t(TRANSLATION.ORDER_MODE_DECISION_ARRIVED_DESC),
            toast: t(TRANSLATION.ORDER_MODE_TOAST_BOARDING),
          }
        case EBookingDriverState.Started:
          return {
            title: t(TRANSLATION.ORDER_MODE_DECISION_COMPLETE_TITLE),
            description: t(TRANSLATION.ORDER_MODE_DECISION_COMPLETE_DESC),
            toast: t(TRANSLATION.ORDER_MODE_TOAST_DELIVERED),
          }
        default:
          return { title: '', description: '', toast: '' }
      }
    })()

    if (orderControlMode === EOrderControlMode.Strict) {
      // Уже запланировали этот шаг — ждём срабатывания, не планируем повторно.
      if (scheduledAutoStepRef.current === stepKey)
        return
      scheduledAutoStepRef.current = stepKey

      const { suffix } = getOrderIdParts(order.b_id, (activeOrders || []).map(item => item.b_id))
      const orderLabel = `${t(TRANSLATION.ORDER_MODE_ORDER_WORD)} №${suffix}`

      const timer = setTimeout(() => {
        // Шаг мог пройти, пока мы ждали: действие сработало, заказ ушёл из
        // активных, и кнопка теперь относится к СЛЕДУЮЩЕЙ точке — то есть к
        // другому заказу. Дёрнуть «свежее действие» вслепую значит закрыть этот
        // следующий заказ прямо на первой высадке и увести водителя с карты, не
        // доехав до второй. Выполняем только тот шаг, который планировали.
        if (latestAutoStepKeyRef.current !== stepKey) {
          scheduledAutoStepRef.current = ''
          return
        }

        // Сообщение о шаге — тоже с задержкой (один раз на шаг).
        if (toastShownStepRef.current !== stepKey) {
          toastShownStepRef.current = stepKey
          showOrderModeToast({
            id: stepKey,
            orderLabel,
            message: meta.toast,
            duration: STRICT_STEP_TOAST_MS,
          })
        }
        // Снимаем «замок» шага: если состояние не сдвинулось (действие не прошло),
        // эффект перепланирует и повторит — маркер не должен застревать на точке.
        scheduledAutoStepRef.current = ''
        latestPrimaryActionRef.current?.onClick()
      }, STRICT_STEP_DELAY_MS)
      autoProgressTimers.current.push(timer)
      return
    }

    // Realistic — окно подтверждения (один раз на шаг).
    if (autoProgressStepRef.current === stepKey)
      return
    autoProgressStepRef.current = stepKey

    requestOrderModeDecision({
      id: stepKey,
      orderLabel: [
        t(TRANSLATION.ORDER_MODE_ORDER_WORD),
        getOrderIdText(order.b_id, (activeOrders || []).map(item => item.b_id)),
      ].filter(Boolean).join(' '),
      title: meta.title,
      description: meta.description,
      actionText: mapPrimaryAction.text,
      cancelText: t(TRANSLATION.ORDER_MODE_CANCEL_TRIP),
      seconds: 5,
      onConfirm: () => mapPrimaryAction.onClick(),
      onCancel: () => onInterruptTripClick(),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderControlMode,
    actionStop?.orderId,
    actionStop?.kind,
    alongTheWayDecisionStop?.orderId,
    activeOrders,
    effectiveDriverState,
    mapPrimaryAction,
    mapActionPending,
    hasReachedPickup,
    hasReachedDestination,
  ])

  // ——— Сторож движения ———
  // «Ехать или стоять» решает эффект маршрута, а он срабатывает только на смену
  // своих зависимостей. После возвращения на карту сходится не всё: модель
  // создаётся заново и пустой, маршрут ей строится асинхронно, и любой сбой на
  // этом пути (маршрут не построился, модель осталась на паузе) больше некому
  // заметить — водитель видит маркер, стоящий посреди незаконченной поездки.
  // Раз в секунду сверяем намерение плана с фактическим состоянием модели.
  useInterval(() => {
    const model = routeEmulatorRef.current
    if (!model || manualRouteOverrideRef.current)
      return
    if (!isDemoMapMovementEnabled || !hasDeparted || mapActionPending)
      return
    // Законные остановки: ждём решения по попутчику или действия водителя на
    // достигнутой точке.
    if (reachedStopKeyRef.current || alongTheWayDecisionStop || isAtStop(currentStop))
      return

    const state = model.getState()
    if (state.loading || state.running)
      return

    // Маршрута нет (или он уже пройден), а ехать есть куда. Эффект на этих
    // зависимостях уже отработал и сам не вернётся — сбрасываем его память о
    // построенном маршруте и просим построить заново.
    if (state.waypoints.length < 2 || state.polyline.length < 2 || state.finished) {
      tripRouteKeyRef.current = ''
      setRouteSyncNonce(value => value + 1)
      return
    }

    model.resume()
  }, 1000)

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
      setEmulatorRoutePolyline(null)
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

  // Отображаемый маршрут ведёт к ближайшей точке плана.
  const currentRouteTarget = useMemo((): [number, number] | null =>
    currentStop ? [currentStop.lat, currentStop.lng] : null,
  [currentStop])

  const currentRouteStart = useMemo((): [number, number] | null => {
    if (currentPosition)
      return currentPosition

    return currentOrderStart
  }, [currentPosition, currentOrderStart])

  // Пока едет эмулятор, источник линии — геометрия самой модели: по ней маркер и
  // движется, поэтому линия и движение не могут разойтись. Для реального
  // водителя без эмулятора остаётся построенный маршрут до текущей точки.
  const tripRoutePoints = useMemo(
    () => (emulatorRoutePolyline && emulatorRoutePolyline.length > 1 ?
      emulatorRoutePolyline :
      activeDriveRouteInfo?.points ?? null),
    [emulatorRoutePolyline, activeDriveRouteInfo],
  )

  const displayedActiveDriveRoutePoints = useMemo(() =>
    trimRoutePointsToPosition(tripRoutePoints, currentPosition),
  [tripRoutePoints, currentPosition])

  const routeAreasRequestKey = useMemo(() => {
    if (!currentRouteStart || !currentRouteTarget) return ''

    return [
      ...currentRouteStart,
      ...currentRouteTarget,
    ].map(value => value.toFixed(4)).join(';')
  }, [currentRouteStart, currentRouteTarget])

  useEffect(() => {
    if (!currentRouteStart || !currentRouteTarget) return

    void driverMapGateway.requestAreas([currentRouteStart, currentRouteTarget])
  }, [routeAreasRequestKey, getAreasBetweenPoints])

  useEffect(() => {
    if (!currentRouteTarget) return
    // Ключ по набору заказов плана: подгонять карту на каждой точке маршрута —
    // значит дёргать её на каждой посадке и высадке.
    const fitKey = planOrderIdsKey
    if (fittedDestinationOrderRef.current === fitKey) return

    fittedDestinationOrderRef.current = fitKey

    // В кадр берём ВСЮ поездку, а не только текущую ногу: при двух заказах
    // остальные точки иначе оказались бы за экраном.
    const bounds: Array<[number, number]> = [
      ...(currentRouteStart ? [currentRouteStart] : []),
      ...tripStops.map(stop => [stop.lat, stop.lng] as [number, number]),
    ]

    if (bounds.length > 1) {
      if (isLeafletMapConnected(map))
        safeLeafletAction(() => map.fitBounds(bounds, {
          padding: [60, 90],
          maxZoom: 16,
        }))
      return
    }

    if (isLeafletMapConnected(map))
      safeLeafletAction(() => map.setView(currentRouteTarget, Math.max(map.getZoom(), 15)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, planOrderIdsKey, currentRouteTarget, currentRouteStart])

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

    // Линию рисует геометрия эмулятора — по ней же едет маркер. Строить рядом
    // второй (двухточечный) маршрут незачем: это лишние запросы к роутеру на
    // каждое перестроение плана и на каждый сдвиг водителя.
    if (isDemoMapMovementEnabled && emulatorRoutePolyline && emulatorRoutePolyline.length > 1)
      return

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

    driverMapGateway.makeRoutePoints(from, to, wayGraph)
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
  }, [
    currentRouteStart,
    currentRouteTarget,
    wayGraph,
    activeDriveRouteInfo,
    routeOrder?.b_id,
    emulatorOrdersEnabled,
    isDemoMapMovementEnabled,
    emulatorRoutePolyline,
  ])


  // Пул для коротких номеров заказов: активные плюс кандидаты в попутчики —
  // номер попутчика водитель видит на кнопке решения ещё до взятия заказа.
  const orderIdPool = [
    ...(activeOrders || []).map(activeOrder => activeOrder.b_id),
    ...alongTheWayCandidates.map(candidate => candidate.b_id),
  ]

  return (
    <>
      <TileLayer
        attribution={getAttribution()}
        url={getTileServerUrl()}
      />
      <OrderModeButton />
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
            path={tripRoutePoints ?? undefined}
            zIndexOffset={3000}
          />
        )
      }
      {
        !!lastPositions.length && !isDriverEmulatorMode && !isDemoMapMovementEnabled &&
        <Polyline positions={lastPositions} />
      }
      {
        // Маршрут поездки целиком: пока едет эмулятор — его собственная
        // геометрия (все ноги плана), иначе построенный маршрут до текущей точки.
        !manualRouteActive && tripRoutePoints && tripRoutePoints.length > 1 && (
          <Polyline
            positions={displayedActiveDriveRoutePoints.length > 1 ? displayedActiveDriveRoutePoints : tripRoutePoints}
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
        manualRouteActive && emulatorRoutePolyline && emulatorRoutePolyline.length > 1 && (
          <Polyline
            positions={emulatorRoutePolyline}
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
        // Метки ВСЕХ точек поездки. С попутным заказом маршрут стал многоточечным,
        // и «Откуда/Куда» одного заказа больше не описывают, куда водитель едет.
        // Постоянная подпись — только у ближайшей точки: на трёх-четырёх
        // постоянных тултипах экран заливает текстом.
        tripStops.map((stop, index) => {
          const isPickup = stop.kind === ETripStopKind.Pickup
          // Метка посадки стоит ровно поверх собственной булавки заказа, поэтому
          // свой попап она не открывает — это съело бы клик и показало адрес
          // подачи вместо карточки заказа.
          const openOrderCard = {
            click: (event: L.LeafletMouseEvent) => {
              try {
                event.originalEvent?.preventDefault?.()
                event.originalEvent?.stopPropagation?.()
                L.DomEvent.stopPropagation(event.originalEvent)
              } catch (_) {}
              mapChannel.selectOrder(stop.order.b_id)
            },
          }
          const address = isPickup ?
            getAddressString(stop.order.b_start_address) :
            getOrderDestinationAddress(stop.order, resolvedDestinationAddresses[stop.orderId])
          const label = isPickup ? t(TRANSLATION.FROM) : t(TRANSLATION.TO)
          const shortAddress = formatShortAddress(address)
          const idText = getOrderIdText(stop.order.b_id, orderIdPool)

          return (
            <Marker
              key={getTripStopKey(stop)}
              position={[stop.lat, stop.lng]}
              icon={new L.Icon({
                iconUrl: isPickup ? images.markerFrom : images.markerTo,
                iconSize: isPickup ? [35, 41] : [36, 41],
                iconAnchor: [18, 41],
                popupAnchor: [0, -35],
              })}
              eventHandlers={isPickup ? openOrderCard : undefined}
            >
              <Tooltip direction="top" offset={[0, -40]} opacity={1} permanent={index === 0}>
                {formatDriverPointTooltip(label, address)}
              </Tooltip>
              {!isPickup && (
                <Popup>
                  <span className="driver-order-map-mode__point-popup">
                    {!!idText && (
                      <b className="driver-order-map-mode__point-popup-id">{idText}</b>
                    )}
                    <span title={address || undefined}>
                      {label}
                      {!!shortAddress && `: ${shortAddress}`}
                    </span>
                  </span>
                </Popup>
              )}
            </Marker>
          )
        })
      }
      {
        markerMapOrders
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
                html: getOrderMarkerHtml(
                  item,
                  pickupPendingOrderIds.has(String(item.b_id)),
                  resolvedDestinationAddresses[String(item.b_id)],
                  // Same pool as <OrderId>/order details (active orders only) so
                  // the short id shown on the map matches the one in the order
                  // details for the same order.
                  (activeOrders || []).map(activeOrder => activeOrder.b_id),
                  orderProfitPercentiles[String(item.b_id)],
                ),
              })}
              eventHandlers={{
                click: (event) => {
                  try {
                    event.originalEvent?.preventDefault?.()
                    event.originalEvent?.stopPropagation?.()
                    L.DomEvent.stopPropagation(event.originalEvent)
                  } catch (_) {}
                  mapChannel.selectOrder(item.b_id)
                },
              }}
              key={item.b_id}
            />,
          )
      }
      <button
        className='no-coords-orders'
        onClick={() => navigate(PLATFORM_ROUTES.DriverOrders, { query: { tab: EDriverTabs.Detailed } })}
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
        // Ручной режим спрашивает про попутчика прямо на карте, в том же слоте,
        // где обычно стоит кнопка шага поездки, и без таймера: решение за
        // водителем. Кнопка шага на это время уступает место — иначе на экране
        // оказались бы три кнопки про разные заказы.
        alongTheWayDecisionStop && orderControlMode === EOrderControlMode.Manual ?
          (
            <div className="driver-order-map-mode__along-the-way-decision">
              <Button
                text={[
                  t(TRANSLATION.TAKE_ORDER),
                  getOrderIdText(alongTheWayDecisionStop.order.b_id, orderIdPool),
                ].filter(Boolean).join(' ')}
                className="driver-order-map-mode__along-the-way-button"
                onClick={() => takeAlongTheWayOrder(alongTheWayDecisionStop.order)}
                disabled={mapActionPending}
                fixedSize={false}
              />
              <Button
                text={t(TRANSLATION.DONT_GO)}
                className="driver-order-map-mode__along-the-way-button driver-order-map-mode__along-the-way-button--decline"
                onClick={() => declineAlongTheWayOrder(alongTheWayDecisionStop.order)}
                disabled={mapActionPending}
                fixedSize={false}
              />
            </div>
          ) :
          mapPrimaryAction && (() => {
            // Ending the trip short of the dropoff is a cancellation, so it asks
            // for a reason instead of completing the order.
            const interrupting = Boolean(mapPrimaryAction.requiresDestinationArrival && !hasReachedDestination)
            return (
              <Button
                // Номер заказа нужен и здесь: когда в салоне двое, «Прервать
                // поездку» без него не говорит, чью именно поездку прерываем.
                text={interrupting ?
                  `${t(TRANSLATION.INTERRUPT_TRIP)}${mapPrimaryAction.orderSuffix}` :
                  mapPrimaryAction.text}
                className={`finish-drive-button ${
                  interrupting ? 'finish-drive-button--interrupted' : mapPrimaryAction.className
                }`}
                onClick={interrupting ? onInterruptTripClick : mapPrimaryAction.onClick}
                disabled={mapActionPending || (mapPrimaryAction.requiresPickupArrival && !hasReachedPickup)}
                fixedSize={false}
              />
            )
          })()
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

function getOrderMarkerHtml(
  order: IOrder,
  performing: boolean,
  resolvedDestinationAddress?: string,
  poolIds: Array<IOrder['b_id']> = [],
  profitBucket?: number,
) {
  const rankClass = getProfitRankClass(order)
  // Перцентильный класс (p0..p4) раскрашивает хинт относительно других видимых
  // заказов и визуально перекрывает абсолютный low/medium/high (правила ниже в scss).
  const percentileClass = profitBucket !== undefined ? ` order-marker--profit-p${profitBucket}` : ''
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
  const { suffix: shortOrderId } = getOrderIdParts(order.b_id, poolIds)

  const negativeClass = profit !== undefined && profit < 0 ? ' order-marker--profit-negative' : ''

  return `<div class='order-marker${rankClass ? ` order-marker--profit--${rankClass}` : ''}${percentileClass}${negativeClass}'>
    <div class='order-marker-hint order-marker-hint--destination-only'>
      ${shortOrderId ? `<div class='order-marker-hint__id'>№${escapeHtml(shortOrderId)}</div>` : ''}
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
