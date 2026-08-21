import React, { createContext, useEffect, useRef, useState } from 'react'
import DriverOrders from './Orders'
import DriverMap from './Map'
import { t, TRANSLATION } from '../../localization'
import { connect, ConnectedProps } from 'react-redux'
import { IRootState } from '../../state'
import { useQuery } from '../../tools/hooks'
import './styles.scss'
import { ordersSelectors, ordersActionCreators } from '../../state/orders'
import { modalsActionCreators } from '../../state/modals'
import { userSelectors } from '../../state/user'
import { carsActionCreators, carsSelectors } from '../../state/cars'
import { canDriverTakeOrderBySeats, getDriverFreeSeats } from '../../tools/driverCapacity'
import SITE_CONSTANTS from '../../siteConstants'
import { EBookingDriverState, EBookingStates, EStatuses, EUserRoles, IAddressPoint, IOrder } from '../../types/types'
import cn from 'classnames'
import ErrorFrame from '../../components/ErrorFrame'
import images from '../../constants/images'
import { withLayout } from '../../HOCs/withLayout'
import { addHiddenOrder } from '../../tools/utils'
import { useLiveEstimatedOrders } from '../../tools/liveOrderProfit'
import { backendGateway } from '../../platform/adapters/LegacyBackendGateway'
import { clearEmulatorClientChoseOtherDriver, getOfferEvent, getStoredDriverOffer, hasEmulatorClientChoseOtherDriver, isOfferOrder, isVotingOrder, subscribeEmulatorClientChoseOtherDriver, updateStoredDriverOfferStatus } from '../../tools/driverOffer'
import { orderControlModeSelectors } from '../../state/orderControlMode'
import { EOrderControlMode } from '../../state/orderControlMode/constants'
import OrderModeDecisionModal from '../../components/OrderModeDecisionModal'
import OrderModeToast from '../../components/OrderModeToast'
import { requestOrderModeDecision } from '../../tools/orderModeDecision'
import { getOrderIdText } from '../../tools/orderId'
import { wasOrderCancelledByDriver } from '../../tools/driverSelfCancel'

/** Задержка перед авто-взятием заказа в Строгом режиме (сглаживает цепочку действий). */
const STRICT_TAKE_DELAY_MS = 5000
import { BROWSER_EMULATOR_STATE_EVENT, getVisibleBrowserEmulatorOrderIds, isAnyBrowserEmulatorModeRunning, isExternalEmulatorEnabled } from '../../tools/emulatorMode'
import { writeFlowEvent } from '../../tools/flowLog'
import { writeRawLog } from '../../tools/rawLog'
import { PLATFORM_ROUTES, usePlatformNavigate } from '../../platform/platform-interface'

const mapStateToProps = (state: IRootState) => ({
  activeOrders: ordersSelectors.activeOrders(state),
  readyOrders: ordersSelectors.readyOrders(state),
  historyOrders: ordersSelectors.historyOrders(state),
  user: userSelectors.user(state),
  orderControlMode: orderControlModeSelectors.orderControlMode(state),
  driverCar: carsSelectors.userDrivenCar(state),
})

const mapDispatchToProps = {
  watchActiveOrders: ordersActionCreators.watchActiveOrders,
  watchReadyOrders: ordersActionCreators.watchReadyOrders,
  watchHistoryOrders: ordersActionCreators.watchHistoryOrders,
  setLoginModal: modalsActionCreators.setLoginModal,
  setMessageModal: modalsActionCreators.setMessageModal,
  setRatingModal: modalsActionCreators.setRatingModal,
  closeAllModals: modalsActionCreators.closeAllModals,
  clearOrders: ordersActionCreators.clearOrders,
  getUserCars: carsActionCreators.getUserCars,
}

const connector = connect(mapStateToProps, mapDispatchToProps)

export const OrderAddressContext = createContext<{ ordersAddressRef: React.RefObject<{
  [orderId: string]: IAddressPoint;
}> }|null>(null)

export enum EDriverTabs {
  Map = 'map',
  Lite = 'lite',
  Detailed = 'detailed'
}

interface IProps extends ConnectedProps<typeof connector> {}

const DRIVER_MAP_VOTING_PARTICIPATION_STORAGE_KEY = 'driverVotingParticipations'


const Driver: React.FC<IProps> = ({
  activeOrders,
  readyOrders,
  historyOrders,
  user,
  orderControlMode,
  driverCar,
  watchActiveOrders,
  watchHistoryOrders,
  watchReadyOrders,
  setLoginModal,
  setMessageModal,
  setRatingModal,
  closeAllModals,
  clearOrders,
  getUserCars,
}) => {

  const { tab = EDriverTabs.Lite } = useQuery()

  const navigate = usePlatformNavigate()

  const ordersAddressRef = useRef<{ [orderId:string]: IAddressPoint }>({})
  const previousVotingParticipations = useRef<IOrder[]>([])
  const shownVotingTimeoutNotifications = useRef<Record<string, true>>({})
  const previousDriverTripOrders = useRef<IOrder[]>([])
  const previousDriverRelatedOrders = useRef<IOrder[]>([])
  const shownDriverFinishedRatings = useRef<Record<string, true>>({})
  const shownDriverOfferNotifications = useRef<Record<string, string>>({})
  const shownDriverClosedNotifications = useRef<Record<string, true>>({})
  const shownEmulatorOtherChoiceNotifications = useRef<Record<string, true>>({})
  const autoAcceptedOrderIds = useRef<Record<string, true>>({})
  const autoAcceptInFlight = useRef(false)
  const realisticDeclinedOrderIds = useRef<Record<string, true>>({})
  const strictTakeTimers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => () => {
    strictTakeTimers.current.forEach(clearTimeout)
    strictTakeTimers.current = []
  }, [])
  const [emulatorOrdersEnabled, setEmulatorOrdersEnabled] = useState(() => isAnyBrowserEmulatorModeRunning() || isExternalEmulatorEnabled())

  // Выгода заказа зависит от расстояния до точки «Откуда», а такси едет — значит
  // и выгода должна пересчитываться. Селекторы считают её от GPS браузера,
  // который во время прогона эмулятора стоит на месте, поэтому списку и карте
  // отдаём заказы, пересчитанные от положения маркера водителя.
  const liveActiveOrders = useLiveEstimatedOrders(activeOrders)
  const liveReadyOrders = useLiveEstimatedOrders(readyOrders)

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver)
      return undefined

    const syncEmulatorMode = (event?: Event) => {
      const enabled = isAnyBrowserEmulatorModeRunning() || isExternalEmulatorEnabled()
      setEmulatorOrdersEnabled(enabled)
      clearOrders()
      closeAllModals()
      const payload = {
        source: 'driver-page',
        screen: 'Driver',
        uiState: enabled ? 'EmulatorOrdersEnabled' : 'EmulatorOrdersDisabled',
        enabled,
        visibleEmulatorOrderIds: getVisibleBrowserEmulatorOrderIds(),
        eventDetail: (event as CustomEvent | undefined)?.detail ?? null,
      }
      writeFlowEvent(enabled ? 'EMULATOR_MODE_CHANGED' : 'EMULATOR_STOP_CLEARED_UI_STATE', { data: payload })
      writeRawLog(enabled ? 'EMULATOR_MODE_CHANGED' : 'EMULATOR_STOP_CLEARED_UI_STATE', payload)
    }

    syncEmulatorMode()
    window.addEventListener(BROWSER_EMULATOR_STATE_EVENT, syncEmulatorMode)
    return () => window.removeEventListener(BROWSER_EMULATOR_STATE_EVENT, syncEmulatorMode)
  }, [user?.u_role, clearOrders, closeAllModals])

  // Машины водителя нужны и без эмулятора: по ним считается вместимость салона,
  // от которой зависит, какие заказы вообще можно показывать.
  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver)
      return
    getUserCars()
  }, [user?.u_role, user?.u_id, getUserCars])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !emulatorOrdersEnabled)
      return
    return watchActiveOrders()
  }, [user?.u_role, emulatorOrdersEnabled, watchActiveOrders])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !emulatorOrdersEnabled)
      return
    return watchReadyOrders()
  }, [user?.u_role, emulatorOrdersEnabled, watchReadyOrders])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !emulatorOrdersEnabled)
      return
    return watchHistoryOrders()
  }, [user?.u_role, emulatorOrdersEnabled, watchHistoryOrders])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id || !activeOrders)
      return

    const notifyTimeout = (order: IOrder) => {
      if (shownVotingTimeoutNotifications.current[order.b_id])
        return

      shownVotingTimeoutNotifications.current[order.b_id] = true
      addHiddenOrder(order.b_id, user.u_id)
      closeAllModals()
      setMessageModal({
        isOpen: true,
        status: EStatuses.Warning,
        message: [
          t(TRANSLATION.DRIVER_VOTING_CLOSED_TIMEOUT),
          getOrderIdText(order.b_id, activeOrders.map(item => item.b_id)),
        ].filter(Boolean).join(' '),
      })
    }

    const activeOrderIds = new Set(activeOrders.map(order => order.b_id))
    for (const previousOrder of previousVotingParticipations.current) {
      if (
        !activeOrderIds.has(previousOrder.b_id) &&
        isDriverVotingCandidate(previousOrder, user.u_id) &&
        isVotingOrderExpired(previousOrder)
      )
        notifyTimeout(previousOrder)
    }

    for (const order of activeOrders) {
      if (
        isDriverVotingCandidate(order, user.u_id) &&
        isVotingOrderExpired(order)
      )
        notifyTimeout(order)
    }

    previousVotingParticipations.current = activeOrders
      .filter(order => isDriverVotingCandidate(order, user.u_id))
  }, [activeOrders, user?.u_id, user?.u_role, setMessageModal, closeAllModals])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id || !activeOrders)
      return

    const showFinishedRating = (orderID: IOrder['b_id']) => {
      if (shownDriverFinishedRatings.current[orderID])
        return
      shownDriverFinishedRatings.current[orderID] = true
      closeAllModals()
      setRatingModal({ isOpen: true, orderID })
    }

    const activeOrderIds = new Set(activeOrders.map(order => order.b_id))
    for (const previousOrder of previousDriverTripOrders.current) {
      if (activeOrderIds.has(previousOrder.b_id))
        continue

      backendGateway.getOrder(previousOrder.b_id)
        .then(order => {
          if (
            order?.b_completed ||
            order?.drivers?.some(driver =>
              driver.u_id === user.u_id &&
              driver.c_state === EBookingDriverState.Finished,
            )
          )
            showFinishedRating(previousOrder.b_id)
        })
        .catch(error => console.error(error))
    }

    for (const order of activeOrders) {
      if (order.drivers?.some(driver =>
        driver.u_id === user.u_id &&
        driver.c_state === EBookingDriverState.Finished,
      ))
        showFinishedRating(order.b_id)
    }

    previousDriverTripOrders.current = activeOrders.filter(order =>
      order.drivers?.some(driver =>
        driver.u_id === user.u_id &&
        [
          EBookingDriverState.Performer,
          EBookingDriverState.Arrived,
          EBookingDriverState.Started,
        ].includes(driver.c_state),
      ),
    )
  }, [activeOrders, user?.u_id, user?.u_role, setRatingModal, closeAllModals])

  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id || !activeOrders)
      return

    const notifyClientCancelled = (orderID: IOrder['b_id']) => {
      if (shownDriverClosedNotifications.current[orderID])
        return

      shownDriverClosedNotifications.current[orderID] = true
      addHiddenOrder(orderID, user.u_id)
      // Заказ, отменённый самим водителем, уже подтверждён своим окном —
      // сообщать про отмену клиентом нечего.
      if (wasOrderCancelledByDriver(orderID, user.u_id))
        return

      closeAllModals()
      setMessageModal({
        isOpen: true,
        status: EStatuses.Warning,
        message: [
          t(TRANSLATION.DRIVER_ORDER_CANCELLED_BY_CLIENT),
          getOrderIdText(orderID, activeOrders.map(item => item.b_id)),
        ].filter(Boolean).join(' '),
      })
    }

    const activeOrderIds = new Set(activeOrders.map(order => order.b_id))
    for (const previousOrder of previousDriverRelatedOrders.current) {
      if (activeOrderIds.has(previousOrder.b_id))
        continue
      if (isVotingOrderExpired(previousOrder))
        continue

      backendGateway.getOrder(previousOrder.b_id)
        .then(order => {
          if (!order || order.b_state === EBookingStates.Canceled)
            notifyClientCancelled(previousOrder.b_id)
        })
        .catch(error => console.error(error))
    }

    for (const order of activeOrders)
      if (
        isDriverRelatedToOrder(order, user.u_id) &&
        order.b_state === EBookingStates.Canceled
      )
        notifyClientCancelled(order.b_id)

    previousDriverRelatedOrders.current = activeOrders.filter(order =>
      isDriverRelatedToOrder(order, user.u_id),
    )
  }, [activeOrders, user?.u_id, user?.u_role, setMessageModal, closeAllModals])

  // driver-offer-realtime-watch
  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id || !activeOrders)
      return

    for (const order of activeOrders) {
      if (!isOfferOrder(order))
        continue

      const myDriver = order.drivers?.find(driver => driver.u_id === user.u_id)
      if (!myDriver)
        continue

      const event = getOfferEvent(order, user.u_id) || (
        myDriver.c_state === EBookingDriverState.Performer ? 'accepted' :
          myDriver.c_state === EBookingDriverState.Canceled ? 'rejected' :
            undefined
      )
      if (!event)
        continue

      const key = `${order.b_id}:${event}`
      if (shownDriverOfferNotifications.current[order.b_id] === key)
        continue
      shownDriverOfferNotifications.current[order.b_id] = key

      if (event === 'accepted') {
        updateStoredDriverOfferStatus(order.b_id, user.u_id, 'accepted')
        setMessageModal({
          isOpen: true,
          status: EStatuses.Success,
          message: [t(TRANSLATION.DRIVER_OFFER_ACCEPTED), getOrderIdText(order.b_id, activeOrders.map(item => item.b_id))]
            .filter(Boolean).join(' '),
        })
        continue
      }

      if (event === 'rejected') {
        updateStoredDriverOfferStatus(order.b_id, user.u_id, 'rejected')
        addHiddenOrder(order.b_id, user.u_id)
        closeAllModals()
        setMessageModal({
          isOpen: true,
          status: EStatuses.Warning,
          message: [t(TRANSLATION.DRIVER_OFFER_REJECTED), getOrderIdText(order.b_id, activeOrders.map(item => item.b_id))]
            .filter(Boolean).join(' '),
        })
        continue
      }

      if (event === 'expired') {
        updateStoredDriverOfferStatus(order.b_id, user.u_id, 'expired')
        setMessageModal({
          isOpen: true,
          status: EStatuses.Warning,
          message: [t(TRANSLATION.DRIVER_OFFER_EXPIRED), getOrderIdText(order.b_id, activeOrders.map(item => item.b_id))]
            .filter(Boolean).join(' '),
        })
      }
    }
  }, [activeOrders, user?.u_id, user?.u_role, setMessageModal, closeAllModals])

  // Реакция "клиент выбрал другого водителя", которую клиентский эмулятор симулирует
  // локально (голосование/предложение без реального второго водителя).
  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id)
      return

    const userId = user.u_id

    const notifyOtherChosen = (orderId: string) => {
      if (!orderId || !hasEmulatorClientChoseOtherDriver(orderId))
        return
      if (shownEmulatorOtherChoiceNotifications.current[orderId])
        return

      shownEmulatorOtherChoiceNotifications.current[orderId] = true
      clearEmulatorClientChoseOtherDriver(orderId)

      const relatedOrder = (activeOrders || []).find(order => String(order.b_id) === String(orderId))
      addHiddenOrder(orderId, userId)
      closeAllModals()
      setMessageModal({
        isOpen: true,
        status: EStatuses.Warning,
        message: [
          relatedOrder?.b_voting ?
            t(TRANSLATION.DRIVER_VOTING_CLOSED_BY_OTHER) :
            t('driver_offer_client_selected_other'),
          getOrderIdText(orderId, (activeOrders || []).map(item => item.b_id)),
        ].filter(Boolean).join(' '),
      })
    }

    const candidateIds = new Set<string>([
      ...getStoredDriverVotingParticipationIds(),
      ...(activeOrders || [])
        .filter(order => isDriverRelatedToOrder(order, userId))
        .map(order => String(order.b_id)),
    ])
    candidateIds.forEach(orderId => notifyOtherChosen(orderId))

    return subscribeEmulatorClientChoseOtherDriver(notifyOtherChosen)
  }, [activeOrders, user?.u_id, user?.u_role, setMessageModal, closeAllModals])

  // Взятие заказа в авто-режимах. Кандидат — первый подходящий обычный заказ
  // (не голосование, не оффер, где водитель ещё не участник). Голосование/офферы
  // не трогаем; второй заказ во время активной поездки не берём.
  // Строгий — берём сразу + уведомление. Реалистичный — показываем окно с выбором
  // (по таймеру берётся автоматически). После взятия уводим водителя на «Карту»,
  // чтобы поехал маркер и продолжился авто-прогресс поездки.
  useEffect(() => {
    if (user?.u_role !== EUserRoles.Driver || !user.u_id)
      return
    if (orderControlMode === EOrderControlMode.Manual)
      return
    if (!readyOrders || readyOrders.length === 0)
      return
    if (autoAcceptInFlight.current)
      return

    const userId = user.u_id

    const busy = (activeOrders || []).some(order =>
      order.drivers?.some(driver =>
        driver.u_id === userId &&
        [
          EBookingDriverState.Performer,
          EBookingDriverState.Arrived,
          EBookingDriverState.Started,
        ].includes(driver.c_state),
      ),
    )
    if (busy)
      return

    const freeSeats = getDriverFreeSeats(driverCar, activeOrders, userId)

    const candidate = readyOrders.find(order =>
      !isVotingOrder(order) &&
      !isOfferOrder(order) &&
      !order.drivers?.some(driver => driver.u_id === userId) &&
      canDriverTakeOrderBySeats(order, freeSeats, userId) &&
      !autoAcceptedOrderIds.current[order.b_id] &&
      !realisticDeclinedOrderIds.current[order.b_id],
    )
    if (!candidate)
      return

    const orderId = candidate.b_id

    const performTake = (notify: boolean) => {
      autoAcceptedOrderIds.current[orderId] = true
      autoAcceptInFlight.current = true

      backendGateway.takeOrder(orderId, { performers_price: 0 }, false)
        .then(() => {
          if (notify)
            setMessageModal({
              isOpen: true,
              status: EStatuses.Success,
              message: [t(TRANSLATION.ORDER_AUTO_ACCEPTED), getOrderIdText(orderId, (activeOrders || []).map(item => item.b_id))]
                .filter(Boolean).join(' '),
            })
          navigate(PLATFORM_ROUTES.DriverOrders, { query: { tab: EDriverTabs.Map } })
        })
        .catch(error => {
          // Не удалось взять (например, заказ уже разобрали) — разрешаем повтор.
          delete autoAcceptedOrderIds.current[orderId]
          console.error(error)
        })
        .finally(() => {
          autoAcceptInFlight.current = false
        })
    }

    if (orderControlMode === EOrderControlMode.Strict) {
      // Задержка перед взятием: резервируем кандидата и держим эффект «занятым»,
      // чтобы не перезапускать взятие и не подвешивать UI мгновенной цепочкой.
      autoAcceptedOrderIds.current[orderId] = true
      autoAcceptInFlight.current = true
      const timer = setTimeout(() => performTake(true), STRICT_TAKE_DELAY_MS)
      strictTakeTimers.current.push(timer)
      return
    }

    // Realistic: окно с выбором и таймером.
    requestOrderModeDecision({
      id: `${orderId}:take`,
      orderLabel: [
        t(TRANSLATION.ORDER_MODE_ORDER_WORD),
        getOrderIdText(orderId, (activeOrders || []).map(item => item.b_id)),
      ].filter(Boolean).join(' '),
      title: t(TRANSLATION.ORDER_MODE_DECISION_TAKE_TITLE),
      description: t(TRANSLATION.ORDER_MODE_DECISION_TAKE_DESC),
      actionText: t(TRANSLATION.TAKE_ORDER),
      cancelText: t(TRANSLATION.DONT_GO),
      seconds: 5,
      onConfirm: () => performTake(false),
      onCancel: () => {
        realisticDeclinedOrderIds.current[orderId] = true
      },
    })
  }, [orderControlMode, readyOrders, activeOrders, driverCar, user?.u_id, user?.u_role, navigate, setMessageModal])

  if (user?.u_role !== EUserRoles.Driver) {
    return (
      <ErrorFrame
        renderImage={() => (
          <div className="errorIcon" onClick={() => setLoginModal(true)}>
            <img src={images.avatar} alt={t(TRANSLATION.ERROR)} style={{ marginTop: '50px' }}/>
          </div>
        )}
        title={t(TRANSLATION.UNAUTHORIZED_ACCESS)}
      />
    )
  }

  const onFirstTabClick = () => {
    navigate(PLATFORM_ROUTES.DriverOrders, { query: { tab: EDriverTabs.Lite } })
  }

  const onSecondTabClick = () => {
    navigate(PLATFORM_ROUTES.DriverOrders, { query: { tab: EDriverTabs.Detailed } })
  }

  return (
    <>
      <OrderModeDecisionModal />
      <OrderModeToast />
      <div className="driver-tabs">
        <button
          onClick={onFirstTabClick}
          className={cn('driver-tabs__tab', { 'driver-tabs__tab--active': tab === EDriverTabs.Lite })}
        >
          {t(TRANSLATION.LIGHT)}
        </button>
        <button
          onClick={onSecondTabClick}
          className={cn('driver-tabs__tab', { 'driver-tabs__tab--active': tab === EDriverTabs.Detailed })}
        >
          {t(TRANSLATION.ALL)}
        </button>
        <button
          onClick={() => navigate(
            PLATFORM_ROUTES.DriverOrders,
            { query: { tab: EDriverTabs.Map } },
          )}
          className={cn('driver-tabs__tab', { 'driver-tabs__tab--active': tab === EDriverTabs.Map })}
        >
          {t(TRANSLATION.MAP)}
        </button>
      </div>
      {(tab === EDriverTabs.Lite || tab === EDriverTabs.Detailed) &&
        <OrderAddressContext.Provider value={{ ordersAddressRef }}>
          <DriverOrders
            user={user}
            type={tab}
            activeOrders={liveActiveOrders}
            readyOrders={liveReadyOrders}
            historyOrders={historyOrders}
          />
        </OrderAddressContext.Provider>
      }
      {tab === EDriverTabs.Map &&
        <OrderAddressContext.Provider value={{ ordersAddressRef }}>
          <DriverMap
            user={user}
            activeOrders={liveActiveOrders}
            readyOrders={liveReadyOrders}
          />
        </OrderAddressContext.Provider>
      }
    </>
  )
}

export default withLayout(connector(Driver))


function getStoredDriverVotingParticipationIds(): string[] {
  try {
    const value = localStorage.getItem(DRIVER_MAP_VOTING_PARTICIPATION_STORAGE_KEY)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function isDriverMapEngagedOrder(order: IOrder, userID?: string) {
  if (!userID)
    return false

  const driver = order.drivers?.find(item => item.u_id === userID)
  if (!driver)
    return false

  if ([
    EBookingDriverState.Performer,
    EBookingDriverState.Arrived,
    EBookingDriverState.Started,
  ].includes(driver.c_state))
    return true

  if (driver.c_state !== EBookingDriverState.Considering)
    return false

  if (order.b_voting && getStoredDriverVotingParticipationIds().includes(String(order.b_id)))
    return true

  if (isOfferOrder(order) && getStoredDriverOffer(order.b_id, userID))
    return true

  return false
}

function isDriverVotingCandidate(order: IOrder, userID?: string) {
  if (!order.b_voting || !userID)
    return false

  return !!order.drivers?.some(driver =>
    driver.u_id === userID &&
    driver.c_state === EBookingDriverState.Considering,
  )
}

function isDriverRelatedToOrder(order: IOrder, userID?: string) {
  return !!userID && !!order.drivers?.some(driver => driver.u_id === userID)
}

function isVotingOrderExpired(order: IOrder) {
  if (hasVotingSelectedDriver(order))
    return false

  if (
    typeof order.remaining_lifetime_seconds === 'number' &&
    order.remaining_lifetime_seconds <= 0
  )
    return true

  const createdAt = Number(order.b_created || 0)
  const startAt = Number(order.b_start_datetime || 0)
  const startedAt = Math.max(createdAt, startAt)
  if (!startedAt)
    return false

  const waitingMs = (order.b_max_waiting || SITE_CONSTANTS.WAITING_INTERVAL) * 1000
  return startedAt + waitingMs <= Date.now()
}

function hasVotingSelectedDriver(order: IOrder) {
  return !!order.drivers?.some(driver => [
    EBookingDriverState.Performer,
    EBookingDriverState.Arrived,
    EBookingDriverState.Started,
    EBookingDriverState.Finished,
  ].includes(driver.c_state))
}
