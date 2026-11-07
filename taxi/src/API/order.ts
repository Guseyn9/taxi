import { MutationReadbackGuard } from '../tools/mutationReadback'
import axios from 'axios'
import { bookingOptionAssignment, performerOptions } from './legacyContract'
import { normalizeMoney } from '../tools/money'
import { Stringify } from '../types'
import { objectFromEntries } from '../tools/compat'
import {
  EServices,
  EBookingDriverState,
  EOrderTypes,
  EUserRoles,
  EPaymentWays,
  IBookingAddresses,
  IBookingCoordinates,
  IOrder,
  IUser,
} from '../types/types'
import { IResponse } from '../types/api'
import { cloneFormData } from '../tools/utils'
import { convertOrder, reverseConvertOrder } from '../tools/convert'
import {
  addToFormData, apiMethod, IApiMethodArguments, IResponseFields,
} from '../tools/api'
import Config from '../config'
import SITE_CONSTANTS from '../siteConstants'
import { t, TRANSLATION } from '../localization'
import { getDriverDoorNumber, normalizeDriverDoorNumber } from '../tools/driverDoorNumber'
import store from '../state'
import { userSelectors } from '../state/user'
import { EBookingActions } from './constants'
import { getUserCar } from './car'
import {
  isAnyBrowserEmulatorOrder,
  isBrowserEmulatorRunning,
  saveBrowserEmulatorOrderId,
} from '../tools/emulatorMode'
import { setPassengerConfirmedChoice } from '../tools/driverOffer'
import { recordOrderInteraction } from '../tools/orderInteractionLog'

function normalizeId(value: unknown) {
  if (value === null || value === undefined || value === '') return ''
  return String(value).trim()
}

function normalizeTestUserIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value]

  return values.reduce<string[]>((result, item) => {
    String(item ?? '')
      .split(/[,\s;|]+/g)
      .map(normalizeId)
      .filter(Boolean)
      .forEach(id => result.push(id))
    return result
  }, [])
}

function getConfiguredTestUserIds() {
  const data = (window as any).data || {}
  const siteConstants = data.site_constants || {}

  return normalizeTestUserIds([
    SITE_CONSTANTS.TEST_USER_ID,
    ...(SITE_CONSTANTS.TEST_USER_IDS || []),
    siteConstants.test_user_id?.value,
    siteConstants.test_user_ids?.value,
    data.test_user_id,
    data.test_user_ids,
  ])
}


function makeDrivePostParams(formData: FormData, requestConverted: any) {
  const params = cloneFormData(formData)
  addToFormData(params, {
    data: JSON.stringify(objectFromEntries(
      [
        'b_start_address',
        'b_start_latitude',
        'b_start_longitude',
        'b_destination_address',
        'b_destination_latitude',
        'b_destination_longitude',
        'b_start_datetime',
        'b_custom_comment',
        'b_flight_number',
        'b_terminal',
        'b_passengers_count',
        'b_luggage_count',
        'b_placard',
        'b_car_class',
        'b_payment_way',
        'b_payment_card',
        'b_cars_count',
        'b_max_waiting',
        'b_options',
        'b_contact',
        'b_comments',
        'b_services',
        'b_location_class',
        'b_currency',
      ].filter(key => key in requestConverted).map(key => [key, requestConverted[key]]),
    )),
  })

  return params
}


function isBackendTestOrder(order: any, ownerUser?: any) {
  if (isAnyBrowserEmulatorOrder(order))
    return true

  const testUserIds = getConfiguredTestUserIds()
  if (!testUserIds.length)
    return false

  const orderUserId = normalizeId(order?.u_id ?? order?.user_id ?? ownerUser?.u_id)
  const referrerId = normalizeId(
    ownerUser?.referrer_id ??
    ownerUser?.u_referrer_id ??
    order?.referrer_id ??
    order?.u_referrer_id,
  )
  const directTestUserId = normalizeId(
    ownerUser?.test_user_id ??
    order?.test_user_id ??
    order?.b_test_user_id,
  )

  return [orderUserId, referrerId, directTestUserId].some(id => testUserIds.includes(id))
}

async function _postDrive(
  { formData }: IApiMethodArguments,
  data: IOrder,
): Promise<IResponseFields & {
  b_id: IOrder['b_id'],
  b_driver_code: IOrder['b_driver_code'],
  confirmationPending?: boolean,
}> {
  const defaults: Partial<IOrder> = {
    b_payment_way: EPaymentWays.Cash,
  }

  const emulatorTarget = isBrowserEmulatorRunning('drivers')
  const orderData: IOrder = {
    ...defaults,
    ...data,
    // В режиме эмулятора заказ остаётся обычным для backend,
    // а принадлежность к песочнице храним только локально по b_id.
    // Так служебные ключи не попадают в b_options/c_options и не видны в интерфейсе.
    b_options: data.b_options,
    b_services: data.b_voting && !data.b_services?.includes(EServices.Voting) ?
      [...(data.b_services ?? []), EServices.Voting] :
      data.b_services,
  }

  const converted = reverseConvertOrder(orderData)

  const postDriveRequest = async() => {
    const response = await axios.post(`${Config.API_URL}/drive`, makeDrivePostParams(formData, converted))
    if (response.data.status === 'error')
      throw response.data
    return response
  }

  const response = await postDriveRequest()

  const result = response.data.data
  result.b_id = result.b_id.toString()

  if (emulatorTarget)
    saveBrowserEmulatorOrderId('drivers', result.b_id)

  if (data.b_voting) {
    try {
      await _confirmDrive({formData} as IApiMethodArguments, result.b_id)
    } catch {
      // Creation is already committed. Preserve its ID, expose the unfinished
      // confirmation, and let the user retry that command rather than create again.
      result.confirmationPending = true
    }
  }

  return result
}
export const postDrive = apiMethod<typeof _postDrive>(_postDrive)

const _confirmDrive = async(args: IApiMethodArguments, id: IOrder['b_id']) => {
  const before = await _getOrder({formData:cloneFormData(args.formData)} as IApiMethodArguments, id)
  if (before?.b_confirm_state === true) return {code:'200',status:'success',reconciled:true}
  if (before?.b_confirm_state !== false) throw new Error('Order confirmation state is unavailable')
  const params = cloneFormData(args.formData)
  addToFormData(params, {action:EBookingActions.SetConfirmState})
  try {
    const {data} = await axios.post(`${Config.API_URL}/drive/get/${id}`, params)
    if (!data || data.status !== 'success' || String(data.code) !== '200')
      throw data ?? new Error('Order confirmation acknowledgement is unavailable')
    return data
  } catch (error) {
    // Lost acknowledgement and "already confirmed" are resolved by a read,
    // never by silently repeating a write or treating an error as success.
    try {
      const after = await _getOrder({formData:cloneFormData(args.formData)} as IApiMethodArguments, id)
      if (after?.b_confirm_state === true) return {code:'200',status:'success',reconciled:true}
    } catch { /* A failed read leaves the outcome unresolved. */ }
    throw error
  }
}
export const confirmDrive = apiMethod<typeof _confirmDrive>(_confirmDrive)

const _cancelDrive = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  reason?: IOrder['b_cancel_reason'],
) => {
  addToFormData(formData, {
    action: EBookingActions.SetCancelState,
    reason,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
export const cancelDrive = apiMethod<typeof _cancelDrive>(_cancelDrive)

export const getOrders: <TType extends EOrderTypes>(
  type?: TType,
  filter?: TType extends EOrderTypes.Ready ? {
    carClasses?: boolean
    locationClasses?: boolean
  } : undefined
) => Promise<IResponse<'200', {
  booking: IOrder[]
}> | IResponse<'404', {
  detail?: 'used_car_not_found'
}>> = apiMethod(async(
  { formData }: IApiMethodArguments,
  type: EOrderTypes = EOrderTypes.Active,
  filter: {
    carClasses?: boolean
    locationClasses?: boolean
  } = {},
) => {
  const currentUser = userSelectors.user(store.getState())
  const userID = currentUser?.u_id

  addToFormData(formData, {
    array_type: 'list',
  })

  const hiddenOrders = JSON.parse(localStorage.getItem('hiddenOrders') || '{}')
  const userHiddenOrders = hiddenOrders && userID && hiddenOrders[userID]

  const queryParams: string[] = []
  let URLAdditionalPath = ''
  switch (type) {
    case EOrderTypes.Active:
      queryParams.push('fields=00000000u1')
      break
    case EOrderTypes.Ready:
      URLAdditionalPath = '/now'
      break
    case EOrderTypes.History:
      URLAdditionalPath = '/archive'
      break
    default:
      return Promise.reject()
  }
  if (filter.carClasses)
    queryParams.push('filter=b_car_classes')
  if (filter.locationClasses)
    queryParams.push('filter=b_location_classes')
  if (
    getConfiguredTestUserIds().length &&
    !isBrowserEmulatorRunning('drivers') &&
    !isBrowserEmulatorRunning('clients')
  )
    queryParams.push('filter=test_user_id')

  const { data: response } = await axios.post(
    `${Config.API_URL}/drive${URLAdditionalPath}` +
    (queryParams.length > 0 ? `?${queryParams.join('&')}` : ''),
    formData,
    {timeout:15000},
  )
  if (response.code === '404' && [
    'used car not found',
    'empty driver location classes',
  ].includes(response.message))
    return { ...response, data: { detail: 'used_car_not_found' } }
  if (response.code !== '200')
    return response

  if (type === EOrderTypes.Active)
    for (const item of response.data.booking)
      item.user = response.data.user[item.u_id]

  return {
    ...response,
    data: {
      ...response.data,
      booking: response.data.booking
        ?.filter((item: IOrder) =>
          !(userHiddenOrders && userHiddenOrders.includes(item.b_id)),
        )
        .filter((item: any) =>
          isBrowserEmulatorRunning('drivers') ||
          isBrowserEmulatorRunning('clients') ||
          !isBackendTestOrder(item, response.data.user?.[item.u_id]),
        )
        .map((item: any) => convertOrder(item))
        .filter((item: IOrder) => item.b_confirm_state || (
          type === EOrderTypes.Active && currentUser?.u_role === EUserRoles.Client &&
          String(item.u_id) === String(userID) && item.b_voting && item.b_confirm_state === false
        ))
        .sort((a: IOrder, b: IOrder) =>
          a.b_start_datetime < b.b_start_datetime ? 1 : -1,
        ),
    },
  }
})

const _getOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
): Promise<IOrder | null> => {
  return axios.post(`${Config.API_URL}/drive/get/${id}?fields=00000000u1`, formData, {timeout:15000})
    .then(res => res.data.data)
    .then(res => (res.booking && res.booking[id] && convertOrder(res.booking[id])) || null)
}
export const getOrder = apiMethod<typeof _getOrder>(_getOrder)

const _editOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  data: IBookingAddresses & Stringify<IBookingCoordinates>,
): Promise<IResponseFields> => {
  addToFormData(formData, {
    action: EBookingActions.Edit,
    data: JSON.stringify(data),
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
export const editOrder = apiMethod<typeof _editOrder>(_editOrder)


function normalizeCustomerPrice(value: number | string) {
  return normalizeMoney(value) ?? 0
}

const _updateOrderCustomerPrice = (
  { formData }: IApiMethodArguments,
  order: IOrder,
  price: number | string,
): Promise<IResponseFields> => {
  const data = { b_options: bookingOptionAssignment('customer_price', normalizeCustomerPrice(price)) }

  addToFormData(formData, {
    action: EBookingActions.Edit,
    data: JSON.stringify(data),
  })

  return axios.post(`${Config.API_URL}/drive/get/${order.b_id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject(res) : res)
}
export const updateOrderCustomerPrice = apiMethod<typeof _updateOrderCustomerPrice>(_updateOrderCustomerPrice)

interface ITakeOrderResult {
  /** Индекс водителя */
  c_index: string,
  /** Текущее число машин поездки с booking_driver_states=3,4,5,6 */
  current_cars_count: string,
  /** Необходимое число машин поездки */
  b_cars_count: string,
  /** Если изменился статус поезки */
  b_state?: '1->2' | null
}

/**
 * Взятие заказа инструментировано здесь, а не в пяти местах вызова (экран
 * заказа, карта, контейнер водителя, карточка): это единственная точка, через
 * которую проходит любое взятие, и пропустить его тут нельзя.
 */
const _takeOrder = (
  args: IApiMethodArguments,
  id: IOrder['b_id'],
  options: {
    votingNumber?: string | number
    performers_price: number
    offerEta?: string
  },
  candidate?: boolean,
): Promise<ITakeOrderResult> => {
  recordOrderInteraction({
    step: 'TAKE_REQUESTED',
    orderId: id,
    surface: 'API',
    details: {
      candidate: Boolean(candidate),
      performersPrice: options.performers_price,
      hasVotingNumber: options.votingNumber !== undefined && options.votingNumber !== null,
    },
  })

  return takeOrderRequest(args, id, options, candidate)
    .then(result => {
      recordOrderInteraction({ step: 'TAKE_SUCCEEDED', orderId: id, surface: 'API' })
      return result
    })
    .catch(error => {
      recordOrderInteraction({
        step: 'TAKE_FAILED',
        orderId: id,
        surface: 'API',
        details: { message: error?.message ?? error?.error ?? String(error) },
      })
      return Promise.reject(error)
    })
}

const takeOrderRequest = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  options: {
    votingNumber?: string | number
    performers_price: number
    offerEta?: string
  },
  candidate?: boolean,
): Promise<ITakeOrderResult> => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID)
    return Promise.reject({ message: t(TRANSLATION.WRONG_USER_ROLE) })

  return getUserCar(userID as string)
    .then(car => {
      if (!car) return Promise.reject({ message: t(TRANSLATION.NOT_LINKED_CAR), error: 'used_car_not_found' })

      const boardingCode = normalizeDriverDoorNumber(options.votingNumber)

      const postTake = () => {
        const requestFormData = cloneFormData(formData)
        const fields: Record<string, any> = {
          action: EBookingActions.SetPerformer,
          performer: candidate ? '0' : '1',
          data: JSON.stringify(cleanDriverOfferOptions({
            c_id: car.c_id,
            c_payment_way: EPaymentWays.Cash,
            c_options: performerOptions(options.performers_price, options.offerEta),
          })),
        }

        // Keep an explicitly entered boarding code intact. Never retry without it
        // or substitute the vehicle number after a server refusal.
        if (boardingCode)
          fields.b_driver_code = boardingCode

        addToFormData(requestFormData, fields)

        return axios.post(`${Config.API_URL}/drive/get/${id}`, requestFormData)
          .then(res => res.data)
          .then(res => res.status === 'error' ? Promise.reject(res) : res)
      }

      return postTake()

    })
}
export const takeOrder = apiMethod<typeof _takeOrder>(_takeOrder)


type TDriverOfferPayload = {
  price?: number
  eta?: string
  freeSeats?: number
  comment?: string
}

const DRIVER_OFFER_MODE = 'OFFER'

function cleanDriverOfferComment(comment?: string) {
  return typeof comment === 'string' ? comment.trim() : ''
}

function cleanDriverOfferOptions(options: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = {}

  Object.keys(options).forEach(key => {
    const value = options[key]
    if (value === undefined || value === null || value === '')
      return

    cleaned[key] = value
  })

  return cleaned
}

function buildDriverOfferOptions(offer: TDriverOfferPayload) {
  return performerOptions(offer.price, offer.eta, offer.comment)
}

function buildVotingCandidateOptions(performersPrice?: number, eta?: string) {
  return performerOptions(performersPrice, eta)
}

function buildDriverOfferPerformerData(carID: string, offer: TDriverOfferPayload) {
  const comment = cleanDriverOfferComment(offer.comment)
  const cOptions = buildDriverOfferOptions(offer)

  // The passenger UI reads driver_offer_eta / driver_offer_comment from c_options.
  // These keys must be allowed in backend c_options_valid_keys for the active config.
  return cleanDriverOfferOptions({
    c_id: carID,
    c_payment_way: EPaymentWays.Cash,
    c_options: cOptions,
    driver_offer_price: offer.price,
    c_pickup_time: offer.eta,
    c_arrival_time: offer.eta,
    c_comment: comment,
  })
}

function buildVotingCandidateData(carID: string, performersPrice?: number, eta?: string) {
  return cleanDriverOfferOptions({
    c_id: carID,
    c_payment_way: EPaymentWays.Cash,
    c_options: buildVotingCandidateOptions(performersPrice, eta),
    c_pickup_time: eta,
    c_arrival_time: eta,
  })
}

const _sendOrderOffer = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  offer: TDriverOfferPayload,
) => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID)
    return Promise.reject({ message: t(TRANSLATION.WRONG_USER_ROLE) })

  return getUserCar(userID as string)
    .then(car => {
      if (!car) return Promise.reject({ message: t(TRANSLATION.NOT_LINKED_CAR), error: 'used_car_not_found' })

      const postOffer = () => {
        const requestFormData = cloneFormData(formData)
        addToFormData(requestFormData, {
          action: EBookingActions.SetPerformer,
          performer: '0',
          c_pickup_time: offer.eta,
          c_arrival_time: offer.eta,
          c_comment: cleanDriverOfferComment(offer.comment),
          data: JSON.stringify(buildDriverOfferPerformerData(car.c_id, offer)),
        })

        return axios.post(`${Config.API_URL}/drive/get/${id}`, requestFormData)
          .then(res => res.data)
          .then(res => res.status === 'error' ? Promise.reject(res) : res)
      }

      return postOffer()
    })
}
export const sendOrderOffer = apiMethod<typeof _sendOrderOffer>(_sendOrderOffer)

const _participateVotingOrder = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  performersPrice?: number,
  eta?: string,
) => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID)
    return Promise.reject({ message: t(TRANSLATION.WRONG_USER_ROLE) })

  return getUserCar(userID as string)
    .then(car => {
      if (!car) return Promise.reject({ message: t(TRANSLATION.NOT_LINKED_CAR), error: 'used_car_not_found' })

      const postVoting = () => {
        const requestFormData = cloneFormData(formData)
        addToFormData(requestFormData, {
          action: EBookingActions.SetPerformer,
          performer: '0',
          c_pickup_time: eta,
          c_arrival_time: eta,
          data: JSON.stringify(buildVotingCandidateData(car.c_id, performersPrice, eta)),
        })

        return axios.post(`${Config.API_URL}/drive/get/${id}`, requestFormData)
          .then(res => res.data)
          .then(res => res.status === 'error' ? Promise.reject(res) : res)
      }

      return postVoting()
    })
}
export const participateVotingOrder = apiMethod<typeof _participateVotingOrder>(_participateVotingOrder)

const _cancelVotingParticipation = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
) => {
  addToFormData(formData, {
    action: EBookingActions.SetCancelState,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject(res) : res)
}
export const cancelVotingParticipation = apiMethod<typeof _cancelVotingParticipation>(_cancelVotingParticipation)

export const arrivedVotingOrder = apiMethod(async(args: IApiMethodArguments, id: IOrder['b_id']) => {
  const order = await _getOrder(args, id)
  const userId = userSelectors.user(store.getState())?.u_id
  const driver = order?.drivers?.find(item => String(item.u_id) === String(userId))
  if (!driver || ![EBookingDriverState.Arrived, EBookingDriverState.Started].includes(driver.c_state))
    throw new Error('Arrival was not confirmed by the server')
  return { code: '200', status: 'success' }
})

const _confirmVotingCode = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  code: number | string,
) => {
  addToFormData(formData, { action: 'check_driver_code', b_driver_code: code })
  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject(res) : res)
}
export const confirmVotingCode = apiMethod<typeof _confirmVotingCode>(_confirmVotingCode)


function notifyLocalDriverEmulatorChoice(orderId: IOrder['b_id'], userId?: IUser['u_id']) {
  if (!orderId || !userId || typeof window === 'undefined')
    return

  // Browser-only hook for the embedded emulator. No localhost/server is needed on Vercel.
  window.dispatchEvent(new CustomEvent('driver-emulator-choice', {
    detail: { orderId: String(orderId), userId: String(userId) },
  }))
}

const _chooseCandidate = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  user?: IUser['u_id'],
): Promise<any> => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID) return Promise.reject({ message: t(TRANSLATION.WRONG_USER_ROLE) })

  addToFormData(formData, {
    action: EBookingActions.SetPerformer,
    performer: '1',
    u_id: user,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject(res) : res)
    .then(res => {
      setPassengerConfirmedChoice(id, user)
      notifyLocalDriverEmulatorChoice(id, user)
      return res
    })
}
export const chooseCandidate = apiMethod<typeof _chooseCandidate>(_chooseCandidate)

const _releaseCandidateChoice = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  user?: IUser['u_id'],
): Promise<any> => {
  const userID = userSelectors.user(store.getState())?.u_id
  if (!userID) return Promise.reject({ message: t(TRANSLATION.WRONG_USER_ROLE) })

  addToFormData(formData, {
    action: EBookingActions.SetPerformer,
    performer: '0',
    u_id: user,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
    .then(res => res.status === 'error' ? Promise.reject(res) : res)
}
export const releaseCandidateChoice = apiMethod<typeof _releaseCandidateChoice>(_releaseCandidateChoice)

const driverMutationGuard = new MutationReadbackGuard()

const _setOrderState = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  state: EBookingDriverState,
  driverCode?: number | string,
) => {
  const readForm = cloneFormData(formData)
  const driverId = userSelectors.user(store.getState())?.u_id
  const checking = (active: boolean) => {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('taxi:driver-state-check', {detail:{orderId:String(id),active}}))
  }
  let action
  switch (state) {
    case EBookingDriverState.Arrived:
      action = EBookingActions.SetArriveState
      break
    case EBookingDriverState.Started:
      action = EBookingActions.SetStartState
      break
    case EBookingDriverState.Finished:
      action = EBookingActions.SetCompleteState
      break
    default:
      return Promise.reject()
  }

  addToFormData(formData, {
    action,
    ...(state === EBookingDriverState.Started && driverCode !== undefined ? {
      b_driver_code: driverCode,
    } : {}),
  })

  return driverMutationGuard.run(`${Config.API_URL}:${driverId}:${id}`, state,
    () => axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
      .then(res => res.data)
      .then(res => res.status === 'error' ? Promise.reject(res) : res),
    async() => {
      // Read with auth fields only. Reusing the action form would resend the write.
      const order = await _getOrder({formData:readForm} as IApiMethodArguments, id)
      const ownDriver = order?.drivers?.find(driver => String(driver.u_id) === String(driverId))
      if (!ownDriver || !Number.isFinite(Number(ownDriver.c_state))) throw new Error('Driver state is unavailable')
      return Number(ownDriver.c_state)
    }, checking,
  ).then(result => 'value' in result ? result.value : {
    code:'200',status:'success',reconciled:true,data:{b_id:id,c_state:result.verifiedState},
  })
}
export const setOrderState = apiMethod<typeof _setOrderState>(_setOrderState)

const _setOrderRating = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  value: number,
) => {
  addToFormData(formData, {
    action: EBookingActions.SetRate,
    value,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
/**
 * @param value rating from 1 till 5
 */
export const setOrderRating = apiMethod<typeof _setOrderRating>(_setOrderRating)

const _setWaitingTime = (
  { formData }: IApiMethodArguments,
  id: IOrder['b_id'],
  previous: number,
  additional: number = 180,
) => {
  addToFormData(formData, {
    action: EBookingActions.SetWaitingTime,
    previous,
    additional,
  })

  return axios.post(`${Config.API_URL}/drive/get/${id}`, formData)
    .then(res => res.data)
}
/**
 * Adds time to wait
 * @param previous actual waiting time
 */
export const setWaitingTime = apiMethod<typeof _setWaitingTime>(_setWaitingTime)
