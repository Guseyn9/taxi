import {
  createPlatformInterfaceComposition,
} from '../compositionRoot'
import { DRIVER_MAP_SURFACE_ID } from '../surfaces/map/MapSurface'
import { PASSENGER_SIMPLE_SURFACE_ID } from '../surfaces/passenger/PassengerSurface'
import {
  DRIVER_HUD_SURFACE_ID,
  DRIVER_LIST_SURFACE_ID,
  SHARED_CHAT_SURFACE_ID,
} from '../surfaces/standard'

describe('Platform Interface composition root', () => {
  it('registers Map Surface and routes its channel through PI Runtime', () => {
    const composition = createPlatformInterfaceComposition()

    expect(composition.surfaceRegistry.require(DRIVER_MAP_SURFACE_ID))
      .toBe(composition.mapSurface)
    expect(composition.mapSurface.channel).toBe(composition.mapChannel)
    expect(composition.contract).toBe(composition.runtime)
    expect(composition.applicationContract).not.toBe(composition.runtime)
    expect(composition.surfaceRegistry.require(PASSENGER_SIMPLE_SURFACE_ID))
      .toBe(composition.passengerSurface)
    expect(composition.surfaceRegistry.require(DRIVER_HUD_SURFACE_ID))
      .toBe(composition.hudSurface)
    expect(composition.surfaceRegistry.require(DRIVER_LIST_SURFACE_ID))
      .toBe(composition.listSurface)
    expect(composition.surfaceRegistry.require(SHARED_CHAT_SURFACE_ID))
      .toBe(composition.chatSurface)
    expect(composition.navigationRegistry.list()).toHaveLength(5)
  })
})
