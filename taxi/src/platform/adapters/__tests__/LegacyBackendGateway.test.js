import * as API from '../../../API'
import {
  BACKEND_EVENTS,
  LegacyBackendGateway,
} from '../LegacyBackendGateway'

jest.mock('../../../API', () => ({
  activateChatServer: jest.fn(),
  arrivedVotingOrder: jest.fn(),
  cancelVotingParticipation: jest.fn(),
  checkRefCode: jest.fn(),
  confirmVotingCode: jest.fn(),
  cancelDrive: jest.fn(),
  createUserCar: jest.fn(),
  chooseCandidate: jest.fn(),
  editCar: jest.fn(),
  editUser: jest.fn(),
  getAuthorizedUser: jest.fn(),
  getCar: jest.fn(),
  getCars: jest.fn(),
  geocode: jest.fn(),
  getImageFile: jest.fn(),
  getOrder: jest.fn(),
  getPointSuggestions: jest.fn(),
  getUser: jest.fn(),
  getUsers: jest.fn(),
  getUserCar: jest.fn(),
  getWashTrips: jest.fn(),
  makeRoutePoints: jest.fn(),
  participateVotingOrder: jest.fn(),
  postDrive: jest.fn(),
  releaseCandidateChoice: jest.fn(),
  reverseGeocode: jest.fn(),
  sendOrderOffer: jest.fn(),
  setOrderRating: jest.fn(),
  setOrderState: jest.fn(),
  setOutDrive: jest.fn(),
  setWaitingTime: jest.fn(),
  takeOrder: jest.fn(),
  uploadFile: jest.fn(),
  updateOrderCustomerPrice: jest.fn(),
}))

describe('LegacyBackendGateway events', () => {
  afterEach(() => jest.restoreAllMocks())

  it('publishes a normalized failure event and rejects with InteractionError', async() => {
    jest.spyOn(API, 'editUser').mockRejectedValueOnce(new Error('network down'))
    const gateway = new LegacyBackendGateway()
    const publish = jest.fn()
    gateway.setEventPublisher(publish)

    await expect(gateway.editUser({ u_name: 'Ivan' })).rejects.toEqual(expect.objectContaining({
      code: 'BACKEND_TRANSPORT_ERROR',
      message: 'network down',
    }))

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: BACKEND_EVENTS.Failed,
      payload: {
        operation: 'editUser',
        code: 'BACKEND_TRANSPORT_ERROR',
        message: 'network down',
      },
    }))
  })

  it('publishes completion without exposing backend response data', async() => {
    jest.spyOn(API, 'getOrder').mockResolvedValueOnce({ b_id: '42' })
    const gateway = new LegacyBackendGateway()
    const publish = jest.fn()
    gateway.setEventPublisher(publish)

    await expect(gateway.getOrder('42')).resolves.toEqual({ b_id: '42' })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: BACKEND_EVENTS.Completed,
      payload: { operation: 'getOrder' },
    }))
  })

  it('treats an HTTP-200 error payload as a failed request', async() => {
    jest.spyOn(API, 'getOrder').mockResolvedValueOnce({
      status: 'error',
      message: 'wrong role',
    })
    const gateway = new LegacyBackendGateway()
    const publish = jest.fn()
    gateway.setEventPublisher(publish)

    await expect(gateway.getOrder('42')).rejects.toEqual(expect.objectContaining({
      code: 'BACKEND_RESPONSE_ERROR',
      message: 'wrong role',
    }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: BACKEND_EVENTS.Failed,
      payload: expect.objectContaining({ operation: 'getOrder' }),
    }))
  })
})
