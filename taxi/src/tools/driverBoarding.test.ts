import { confirmDriverBoarding, isBoardingCodeAccepted } from './driverBoarding'

describe('isBoardingCodeAccepted', () => {

  it('принимает код, совпавший с кодом заказа', () => {
    expect(isBoardingCodeAccepted('1234', '1234')).toBe(true)
    expect(isBoardingCodeAccepted('1234', ' 12-34 ')).toBe(true)
  })

  it('не принимает несовпавший или некорректный по форме код', () => {
    expect(isBoardingCodeAccepted('1234', '4321')).toBe(false)
    expect(isBoardingCodeAccepted('1234', '12')).toBe(false)
    expect(isBoardingCodeAccepted('1234', '')).toBe(false)
  })

  it('без кода в заказе проверку формы оставляет за собой, а сверку — за бэкендом', () => {
    expect(isBoardingCodeAccepted(undefined, '1234')).toBe(true)
    expect(isBoardingCodeAccepted(undefined, '12')).toBe(false)
  })

})

describe('confirmDriverBoarding', () => {

  const setup = (confirmBoarding: ReturnType<typeof jest.fn>) => {
    const calls: string[] = []
    const syncOrderState = jest.fn(() => { calls.push('sync') })
    const onBoarded = jest.fn(() => { calls.push('boarded') })

    return {
      calls,
      syncOrderState,
      onBoarded,
      run: () => confirmDriverBoarding({
        orderId: '42',
        code: '1234',
        confirmBoarding,
        syncOrderState,
        onBoarded,
      }),
    }
  }

  // Test 1 / Test 6 ТЗ: успешное подтверждение доходит до локальной синхронизации
  // и до закрытия карточки, и делает это ровно один раз.
  it('после успеха синхронизирует состояние заказа и закрывает посадку', async() => {
    const confirmBoarding = jest.fn(async() => { /* backend accepted */ })
    const { run, calls, syncOrderState, onBoarded } = setup(confirmBoarding)

    await run()

    expect(confirmBoarding).toHaveBeenCalledTimes(1)
    expect(confirmBoarding).toHaveBeenCalledWith('42', '1234')
    expect(syncOrderState).toHaveBeenCalledWith('42')
    expect(onBoarded).toHaveBeenCalledWith('42')
    expect(calls).toEqual(['sync', 'boarded'])
  })

  // Test 7 ТЗ: оптимистического перехода нет — до ответа бэкенда локальное
  // состояние не трогаем.
  it('не синхронизирует состояние, пока команда не завершилась', async() => {
    let release = () => { /* заполняется ниже */ }
    const confirmBoarding = jest.fn(() => new Promise<void>(resolve => { release = resolve }))
    const { run, syncOrderState, onBoarded } = setup(confirmBoarding)

    const completion = run()
    await Promise.resolve()

    expect(confirmBoarding).toHaveBeenCalledTimes(1)
    expect(syncOrderState).not.toHaveBeenCalled()
    expect(onBoarded).not.toHaveBeenCalled()

    release()
    await completion

    expect(syncOrderState).toHaveBeenCalledTimes(1)
    expect(onBoarded).toHaveBeenCalledTimes(1)
  })

  // Test 2 ТЗ: неверный код (бэкенд отверг команду) не переводит заказ в Started.
  it('при ошибке команды не трогает локальное состояние и пробрасывает ошибку', async() => {
    const failure = new Error('WRONG_BOARDING_CODE')
    const confirmBoarding = jest.fn(async() => { throw failure })
    const { run, syncOrderState, onBoarded } = setup(confirmBoarding)

    await expect(run()).rejects.toBe(failure)

    expect(confirmBoarding).toHaveBeenCalledTimes(1)
    expect(syncOrderState).not.toHaveBeenCalled()
    expect(onBoarded).not.toHaveBeenCalled()
  })

})
