import { NavigationRegistry } from '../navigation/NavigationRegistry'
import { NavigationRuntime } from '../navigation/NavigationRuntime'

describe('NavigationRuntime', () => {
  it('resolves route ids and delegates navigation to the attached adapter', () => {
    const registry = new NavigationRegistry()
    registry.register({ id: 'passenger.order', path: '/passenger-order' })
    const runtime = new NavigationRuntime(registry)
    const adapter = { navigate: jest.fn(), go: jest.fn() }
    runtime.attach(adapter)

    runtime.navigate('passenger.order', { replace: true })

    expect(adapter.navigate).toHaveBeenCalledWith('/passenger-order', { replace: true })
  })

  it('builds and recognizes routes with parameters', () => {
    const registry = new NavigationRegistry()
    registry.register({ id: 'driver.order', path: '/driver-order/:id' })
    const runtime = new NavigationRuntime(registry)
    const adapter = { navigate: jest.fn(), go: jest.fn() }
    runtime.attach(adapter)

    runtime.navigate('driver.order', { params: { id: 42 } })
    runtime.sync('/driver-order/42')

    expect(adapter.navigate).toHaveBeenCalledWith('/driver-order/42', { replace: undefined })
    expect(runtime.getState().routeId).toBe('driver.order')
  })

  it('serializes query parameters without exposing React Router to callers', () => {
    const registry = new NavigationRegistry()
    registry.register({ id: 'driver.orders', path: '/driver-order' })
    const runtime = new NavigationRuntime(registry)
    const adapter = { navigate: jest.fn(), go: jest.fn() }
    runtime.attach(adapter)

    runtime.navigate('driver.orders', {
      query: { tab: 'map', debug: true, ignored: null },
    })

    expect(adapter.navigate).toHaveBeenCalledWith(
      '/driver-order?tab=map&debug=true',
      { replace: undefined },
    )
  })

  it('publishes synchronized browser locations as read-only state', () => {
    const registry = new NavigationRegistry()
    registry.register({ id: 'driver.orders', path: '/driver-order' })
    const runtime = new NavigationRuntime(registry)
    const listener = jest.fn()
    runtime.subscribe(listener)

    runtime.sync('/driver-order')

    expect(runtime.getState()).toEqual({ routeId: 'driver.orders', path: '/driver-order' })
    expect(Object.isFrozen(runtime.getState())).toBe(true)
    expect(listener).toHaveBeenCalledWith(runtime.getState())
  })

  it('delegates legacy paths and browser history without exposing the router', () => {
    const registry = new NavigationRegistry()
    const runtime = new NavigationRuntime(registry)
    const adapter = { navigate: jest.fn(), go: jest.fn() }
    runtime.attach(adapter)

    runtime.navigatePath('/legacy-screen', { replace: true })
    runtime.go(-1)

    expect(adapter.navigate).toHaveBeenCalledWith('/legacy-screen', { replace: true })
    expect(adapter.go).toHaveBeenCalledWith(-1)
  })

  it('fails fast for an unknown route or missing adapter', () => {
    const registry = new NavigationRegistry()
    registry.register({ id: 'sandbox', path: '/sandbox' })
    const runtime = new NavigationRuntime(registry)

    expect(() => runtime.navigate('missing')).toThrow('Navigation route is not registered: missing')
    expect(() => runtime.navigate('sandbox')).toThrow('Navigation adapter is not attached')
  })
})
