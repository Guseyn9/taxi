import { AppInteractionContract } from '../../map-channel/AppInteractionContract'
import { PlatformInterfaceRuntime } from '../PlatformInterfaceRuntime'
import { createPlatformSnapshot } from '../snapshot'
import { SnapshotSurface } from '../surfaces/SnapshotSurface'
import { SurfaceRegistry } from '../SurfaceRegistry'

describe('SnapshotSurface', () => {
  it('provides read-only state projections to HUD, List and Chat implementations', async() => {
    const snapshot = createPlatformSnapshot({
      revision: 7,
      state: { order: { id: '42', status: 'assigned' } },
      availableActions: ['order_open_chat'],
    })
    const contract = new AppInteractionContract({ log: jest.fn(), error: jest.fn() })
    const registry = new SurfaceRegistry()
    const runtime = new PlatformInterfaceRuntime(
      contract,
      { load: jest.fn().mockResolvedValue(snapshot) },
      registry,
      { log: jest.fn(), error: jest.fn() },
    )
    const surface = new SnapshotSurface('shared.chat', 'chat', runtime)
    registry.register(surface)

    const unmount = runtime.mountSurface(surface.id)
    await runtime.start()

    expect(surface.getSnapshot()).toBe(snapshot)
    expect(surface.getAvailableActions()).toEqual(['order_open_chat'])
    expect(surface.selectState(state => state.order.status)).toBe('assigned')

    unmount()
  })
})
