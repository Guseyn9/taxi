import { AppInteractionContract } from '../../map-channel/AppInteractionContract'
import { MapChannel } from '../../map-channel/MapChannel'
import { DRIVER_MAP_SURFACE_ID, MapSurface } from '../surfaces/map/MapSurface'

const TIMESTAMP = '2026-08-08T10:00:00.000Z'
const CORRELATION_ID = 'pi-map-test-1'

const createSubject = () => {
  const logger = { log: jest.fn(), error: jest.fn() }
  const contract = new AppInteractionContract(logger)
  const channel = new MapChannel(
    contract,
    () => TIMESTAMP,
    () => CORRELATION_ID,
    logger,
  )
  const surface = new MapSurface(contract, channel)
  return { channel, contract, logger, surface }
}

describe('MapSurface lifecycle', () => {
  it('has the stable id and kind declared by Surface Model', () => {
    const { surface } = createSubject()

    expect(surface.id).toBe(DRIVER_MAP_SURFACE_ID)
    expect(surface.kind).toBe('map')
    expect(surface.isMounted()).toBe(false)
  })

  it('requires UI bindings before mount', () => {
    const { surface } = createSubject()

    expect(() => surface.mount())
      .toThrow('MapSurface bindings must be configured before mount')
  })

  it('mounts the existing Action -> Event -> UI chain', () => {
    const { channel, surface } = createSubject()
    const setOrderCardModal = jest.fn()
    surface.setBindings({ mockEnabled: false, setOrderCardModal })

    const unmount = surface.mount()
    channel.selectOrder('42')

    expect(surface.isMounted()).toBe(true)
    expect(setOrderCardModal).toHaveBeenCalledTimes(1)
    expect(setOrderCardModal).toHaveBeenCalledWith({ isOpen: true, orderId: '42' })

    unmount()
    expect(surface.isMounted()).toBe(false)
  })

  it('uses fresh bindings without rebuilding the channel subscription', () => {
    const { channel, surface } = createSubject()
    const setOrderCardModal = jest.fn()
    surface.setBindings({ mockEnabled: true, setOrderCardModal })
    const unmount = surface.mount()

    channel.selectOrder('42')
    expect(setOrderCardModal).not.toHaveBeenCalled()

    surface.setBindings({ mockEnabled: false, setOrderCardModal })
    channel.selectOrder('42')
    expect(setOrderCardModal).toHaveBeenCalledTimes(1)

    unmount()
  })

  it('stops both handler and UI subscription after final unmount', () => {
    const { channel, surface } = createSubject()
    const setOrderCardModal = jest.fn()
    surface.setBindings({ mockEnabled: false, setOrderCardModal })

    const unmount = surface.mount()
    unmount()
    unmount()
    channel.selectOrder('42')

    expect(setOrderCardModal).not.toHaveBeenCalled()
  })

  it('reference-counts concurrent mounts and registers one pipeline', () => {
    const { channel, surface } = createSubject()
    const setOrderCardModal = jest.fn()
    surface.setBindings({ mockEnabled: false, setOrderCardModal })

    const unmountFirst = surface.mount()
    const unmountSecond = surface.mount()

    channel.selectOrder('42')
    expect(setOrderCardModal).toHaveBeenCalledTimes(1)

    unmountFirst()
    channel.selectOrder('43')
    expect(setOrderCardModal).toHaveBeenCalledTimes(2)

    unmountSecond()
    channel.selectOrder('44')
    expect(setOrderCardModal).toHaveBeenCalledTimes(2)
  })

  it('can be mounted again after StrictMode-style cleanup', () => {
    const { channel, surface } = createSubject()
    const setOrderCardModal = jest.fn()
    surface.setBindings({ mockEnabled: false, setOrderCardModal })

    surface.mount()()
    const finalUnmount = surface.mount()
    channel.selectOrder('42')

    expect(setOrderCardModal).toHaveBeenCalledTimes(1)
    finalUnmount()
  })
})
