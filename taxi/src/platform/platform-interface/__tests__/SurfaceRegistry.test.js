import { SurfaceRegistry } from '../SurfaceRegistry'

const createSurface = (id, kind = 'map') => ({
  id,
  kind,
  isMounted: () => false,
  mount: () => () => undefined,
})

describe('SurfaceRegistry', () => {
  it('registers and resolves a surface by stable id', () => {
    const registry = new SurfaceRegistry()
    const surface = createSurface('driver.map')

    registry.register(surface)

    expect(registry.has('driver.map')).toBe(true)
    expect(registry.get('driver.map')).toBe(surface)
    expect(registry.require('driver.map')).toBe(surface)
    expect(registry.list()).toEqual([surface])
  })

  it('rejects duplicate ids instead of silently replacing a surface', () => {
    const registry = new SurfaceRegistry()
    registry.register(createSurface('driver.map'))

    expect(() => registry.register(createSurface('driver.map')))
      .toThrow('Surface already registered: driver.map')
  })

  it('fails explicitly when a required surface is missing', () => {
    const registry = new SurfaceRegistry()

    expect(() => registry.require('missing'))
      .toThrow('Surface is not registered: missing')
  })

  it('registration cleanup is idempotent and does not remove a replacement', () => {
    const registry = new SurfaceRegistry()
    const surface = createSurface('driver.map')
    const unregister = registry.register(surface)

    unregister()
    unregister()

    expect(registry.has('driver.map')).toBe(false)
    const replacement = createSurface('driver.map')
    registry.register(replacement)
    unregister()
    expect(registry.get('driver.map')).toBe(replacement)
  })
})
