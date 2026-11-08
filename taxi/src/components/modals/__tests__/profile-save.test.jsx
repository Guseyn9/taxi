import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ProfileModalContent } from '../ProfileModal'
import { backendGateway } from '../../../platform/adapters/LegacyBackendGateway'
import { EUserRoles, EUserCheckStates, EStatuses } from '../../../types/types'
let mockForm
jest.mock('react-redux', () => ({ connect: () => Component => Component }))
jest.mock('../../../platform/adapters/LegacyBackendGateway', () => ({ backendGateway: { getImageFile: jest.fn(), uploadFile: jest.fn(), editUser: jest.fn() } }))
jest.mock('../../../state', () => ({ __esModule: true, default: {} }))
jest.mock('../../../state/user', () => ({ userSelectors: {}, userActionCreators: {} }))
jest.mock('../../../state/cars', () => ({ carsSelectors: {}, carsActionCreators: {} }))
jest.mock('../../../state/orders', () => ({ ordersSelectors: {} }))
jest.mock('../../../state/config', () => ({ configSelectors: {}, configActionCreators: {} }))
jest.mock('../../../state/modals', () => ({ modalsSelectors: {}, modalsActionCreators: {} }))
jest.mock('../../../state/modals/reducer', () => ({ defaultProfileModal: {} }))
jest.mock('../../../localization', () => ({ t: key => key, TRANSLATION: {} }))
jest.mock('../../../tools/apiMessages', () => ({ getApiErrorMessage: value => value.message }))
jest.mock('../../../tools/utils', () => ({ getBase64: jest.fn() }))
jest.mock('../../../tools/phoneUtils', () => ({ formatPhoneNumber: x => x, normalizePhoneNumber: x => x }))
jest.mock('../../../security/fileUpload', () => ({ validateUploadBatch: jest.fn() }))
jest.mock('../../JSONForm', () => ({ __esModule: true, default: props => { mockForm = props; return <div data-testid="form"/> } }))
jest.mock('../../DriverStatusAvatar', () => ({ __esModule: true, default: () => null }))
jest.mock('../Overlay', () => ({ __esModule: true, default: ({children}) => <div>{children}</div> }))
async function setup(run, extra = {}) {
  global.IS_REACT_ACT_ENVIRONMENT = true
  const host = document.createElement('div');document.body.appendChild(host); const root = createRoot(host)
  const props = { user: { u_id: 1, u_role: EUserRoles.Driver, u_check_state: EUserCheckStates.Required, u_details: {} }, car: { c_id: 7, seats: 4 }, activeOrders: [], language: { iso: 'ru' }, isOpen: true, getUserCars: jest.fn(), updateUser: jest.fn(), setMessageModal: jest.fn(), setProfileModal: jest.fn(), editCar: jest.fn().mockResolvedValue({code:'200'}), createUserCar: jest.fn(), ...extra }
  backendGateway.editUser.mockResolvedValue({code:'200',status:'success'})
  backendGateway.uploadFile.mockResolvedValue({dl_id:'42'})
  try {
    await act(async() => root.render(<ProfileModalContent {...props}/>))
    const values = {...mockForm.defaultValues, u_car:{...mockForm.defaultValues.u_car,seats:5},u_details:{...mockForm.defaultValues.u_details,passport_photo:[[null,new File(['x'],'a.png',{type:'image/png'})]]}}
    await run({props,values,host})
  } finally { act(() => root.unmount());host.remove();jest.clearAllMocks();delete global.IS_REACT_ACT_ENVIRONMENT }
}
it('reports partial save after car success, refreshes data and blocks duplicate retry', async() => setup(async({props,values,host}) => {
  backendGateway.uploadFile.mockRejectedValueOnce(new Error('upload refused'))
  await act(async() => mockForm.onSubmit(values))
  expect(props.editCar).toHaveBeenCalledTimes(1)
  expect(backendGateway.editUser).not.toHaveBeenCalled()
  expect(props.updateUser).toHaveBeenCalledTimes(1)
  expect(props.getUserCars).toHaveBeenCalledTimes(2)
  expect(props.setMessageModal).toHaveBeenLastCalledWith(expect.objectContaining({message:'profile_partial_save'}))
  expect(host.textContent).toContain('profile_partial_save')
  expect(mockForm.fields.find(field => field.type === 'submit').disabled).toBe(true)
  await act(async() => mockForm.onSubmit(values))
  expect(props.editCar).toHaveBeenCalledTimes(1)
}))
it('does not continue after a malformed upload acknowledgement', async() => setup(async({props,values}) => {
  backendGateway.uploadFile.mockResolvedValueOnce({})
  await act(async() => mockForm.onSubmit(values))
  expect(backendGateway.editUser).not.toHaveBeenCalled()
  expect(props.setMessageModal).toHaveBeenLastCalledWith(expect.objectContaining({message:'profile_partial_save'}))
}))
it('reports unconfirmed car mutation and never sends dependent document writes', async() => setup(async({props,values}) => {
  props.editCar.mockRejectedValueOnce(new Error('timeout'))
  await act(async() => mockForm.onSubmit(values))
  expect(backendGateway.uploadFile).not.toHaveBeenCalled()
  expect(props.setMessageModal).toHaveBeenLastCalledWith(expect.objectContaining({message:'profile_car_unconfirmed'}))
  await act(async() => mockForm.onSubmit(values))
  expect(props.editCar).toHaveBeenCalledTimes(1)
}))
it('retains the successful profile flow', async() => setup(async({props,values}) => {
  await act(async() => mockForm.onSubmit(values))
  expect(props.editCar).toHaveBeenCalledTimes(1)
  expect(backendGateway.editUser).toHaveBeenCalledWith(expect.objectContaining({u_details:expect.objectContaining({passport_photo:['42']})}))
  expect(props.setMessageModal).toHaveBeenLastCalledWith(expect.objectContaining({status:EStatuses.Success}))
}))
it('does not announce success for an empty profile response after saving the vehicle', async() => setup(async({props,values}) => {
  backendGateway.editUser.mockResolvedValueOnce(undefined)
  await act(async() => mockForm.onSubmit(values))
  expect(props.setMessageModal).toHaveBeenLastCalledWith(expect.objectContaining({message:'profile_partial_save',status:EStatuses.Fail}))
}))
