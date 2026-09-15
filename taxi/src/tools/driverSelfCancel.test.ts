import {
  runDriverSelfCancellation,
  wasOrderCancelledByDriver,
} from './driverSelfCancel'

describe('runDriverSelfCancellation', () => {
  beforeEach(() => window.localStorage.clear())

  it.each(['FAILED', 'TIMEOUT', 'STATUS_LOOKUP', 'CANCELLED'])(
    'rolls the optimistic marker back after %s',
    async(result: string) => {
      const failure = new Error(result)
      const cancel = jest.fn(async() => {
        expect(wasOrderCancelledByDriver('42', '7')).toBe(true)
        throw failure
      })

      await expect(runDriverSelfCancellation('42', '7', cancel)).rejects.toBe(failure)

      expect(cancel).toHaveBeenCalledTimes(1)
      expect(wasOrderCancelledByDriver('42', '7')).toBe(false)
    },
  )

  it('keeps the marker after confirmed cancellation', async() => {
    await expect(runDriverSelfCancellation(
      '42',
      '7',
      async() => 'COMPLETED',
    )).resolves.toBe('COMPLETED')

    expect(wasOrderCancelledByDriver('42', '7')).toBe(true)
  })
})
