import { PassengerSurface } from '../surfaces/passenger/PassengerSurface'

jest.mock('../surfaces/passenger/PassengerPresentation', () => ({
  resolvePassengerUiConfig: () => ({
    state: 'CANDIDATE_SELECTION',
    showCancel: true,
    showChat: false,
    visibleBlocks: ['map', 'candidateList', 'cancelButton'],
  }),
}))

describe('PassengerSurface available actions', () => {
  it('removes controls that are not allowed by the current Snapshot', () => {
    const runtime = {
      getState: () => ({
        status: 'ready',
        error: null,
        snapshot: {
          revision: 1,
          state: {},
          availableActions: ['order_cancel_by_client'],
          updatedAt: null,
        },
      }),
    }
    const surface = new PassengerSurface(runtime)

    const presentation = surface.resolve({ selectedOrder: null })

    expect(presentation.uiConfig.visibleBlocks).toEqual(['map', 'cancelButton'])
    expect(presentation.uiConfig.showCancel).toBe(true)
    expect(presentation.availableActions).toEqual(['order_cancel_by_client'])
  })
})
