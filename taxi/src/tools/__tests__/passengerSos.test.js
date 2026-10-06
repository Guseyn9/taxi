import fs from 'fs'
import path from 'path'
import { isCancelSucceeded, submitPassengerSos } from '../passengerSos'
import reducer, { record } from '../../state/modals/reducer'
import { setSosModal, closeAllModals, setAlarmModal } from '../../state/modals/actionCreators'

describe('isCancelSucceeded', () => {
  it('принимает только code 200 без status=error', () => {
    expect(isCancelSucceeded({ code: '200', status: 'success', sql: 'COMMIT' })).toBe(true)
    expect(isCancelSucceeded({ code: 200 })).toBe(true)
  })

  it('отклоняет бизнес-ошибку backend, пришедшую с HTTP 200', () => {
    expect(isCancelSucceeded({ code: '404', status: 'error', message: 'wrong booking state' })).toBe(false)
    expect(isCancelSucceeded({ code: '200', status: 'error' })).toBe(false)
  })

  it('отклоняет пустой и неожиданный ответ', () => {
    expect(isCancelSucceeded(undefined)).toBe(false)
    expect(isCancelSucceeded(null)).toBe(false)
    expect(isCancelSucceeded({})).toBe(false)
  })
})

describe('submitPassengerSos', () => {
  it('отправляет ровно один cancel с выбранной причиной и возвращает ответ', async() => {
    const response = { code: '200', status: 'success' }
    const cancel = jest.fn().mockResolvedValue(response)

    await expect(submitPassengerSos(cancel, '16376', 'Mistakenly ordered')).resolves.toBe(response)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('16376', 'Mistakenly ordered')
  })

  it('AC-11: бизнес-ошибка backend — отказ, а не молчаливый успех', async() => {
    const cancel = jest.fn().mockResolvedValue({ code: '404', status: 'error', message: 'wrong booking state' })

    await expect(submitPassengerSos(cancel, '16376', 'Waiting for long')).rejects.toThrow(/set_cancel_state rejected/)
  })

  it('AC-11: сетевая ошибка пробрасывается, повторная отправка возможна', async() => {
    const cancel = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ code: '200', status: 'success' })

    await expect(submitPassengerSos(cancel, '16376', 'Very expensive')).rejects.toThrow('network down')
    await expect(submitPassengerSos(cancel, '16376', 'Very expensive')).resolves.toEqual({ code: '200', status: 'success' })
    expect(cancel).toHaveBeenCalledTimes(2)
  })
})

describe('modals reducer: sosModal', () => {
  it('по умолчанию закрыт и не зависит от alarmModal', () => {
    const state = new record()
    expect(state.get('sosModal')).toEqual({ isOpen: false })

    const withAlarm = reducer(state, setAlarmModal({ isOpen: true }))
    expect(withAlarm.get('sosModal').isOpen).toBe(false)
  })

  it('открывается с orderId и не открывает alarmModal', () => {
    const state = reducer(new record(), setSosModal({ isOpen: true, orderId: '16376' }))
    expect(state.get('sosModal')).toEqual({ isOpen: true, orderId: '16376' })
    expect(state.get('alarmModal').isOpen).toBe(false)
  })

  it('closeAllModals закрывает sosModal', () => {
    const opened = reducer(new record(), setSosModal({ isOpen: true, orderId: '16376' }))
    expect(reducer(opened, closeAllModals()).get('sosModal').isOpen).toBe(false)
  })
})

describe('маршрутизация SOS: Passenger -> PassengerSosModal, Driver -> AlarmModal', () => {
  const read = file => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8')

  const passengerEntryPoints = [
    'components/MiniOrders/index.tsx',
    'components/PassengerLiveOrder/index.tsx',
    'components/modals/OnTheWayModal.tsx',
    'platform/adapters/LegacyPassengerChannelStoreAdapter.ts',
  ]
  const driverEntryPoints = [
    'pages/Order/index.tsx',
    'components/modals/CardModal.tsx',
  ]

  it.each(passengerEntryPoints)('%s открывает SOS-модал, а не таймер AlarmModal', file => {
    const source = read(file)
    expect(source).toMatch(/setSosModal/)
    expect(source).not.toMatch(/setAlarmModal/)
  })

  it.each(driverEntryPoints)('%s (Driver) остаётся на AlarmModal и не получает Passenger SOS', file => {
    const source = read(file)
    expect(source).toMatch(/setAlarmModal/)
    expect(source).not.toMatch(/setSosModal/)
  })

  it('data-testid="sos-alarm-modal" только у PassengerSosModal', () => {
    expect(read('components/modals/PassengerSosModal.tsx')).toMatch(/data-testid="sos-alarm-modal"/)
    expect(read('components/modals/AlarmModal.tsx')).not.toMatch(/sos-alarm-modal/)
  })
})
