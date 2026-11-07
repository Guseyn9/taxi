import { resolveButtonLayout, resolveOrderModes, resolveTripType, resolveAvailableClasses, resolveSubmitValidation } from '../orderFormResolvers'

jest.mock('../../../siteConstants', () => ({
  __esModule: true,
  default: {
    BOOKING_LOCATION_CLASSES: [
      { id: 'city', kind: 0 },
      { id: 'intercity', kind: 1 },
    ],
    CAR_CLASSES: {
      petit: { id: 'petit', max_seats: 4, booking_location_classes: ['city', 'intercity'] },
    },
    DEFAULT_CAR_CLASS: 'petit',
  },
}))

jest.mock('../../../tools/utils', () => ({
  firstItem: value => Array.from(value || [])[0],
}))

jest.mock('../util', () => ({
  availableCarClasses: jest.fn(() => [{ id: 'petit', max_seats: 4, booking_location_classes: ['city', 'intercity'] }]),
  carClassAllowedForRoute: () => true,
  carClassSupportsLocationClass: () => true,
  maxAvailableSeats: () => 4,
  polygonsLocationClasses: () => [{ id: 'city', kind: 0 }],
}))

describe('Order form resolver chain', () => {
  it('resolves trip type from location class kind', () => {
    expect(resolveTripType({ id: 'city', kind: 0 })).toBe('CITY')
    expect(resolveTripType({ id: 'intercity', kind: 1 })).toBe('INTERCITY')
    expect(resolveTripType(null)).toBe('UNKNOWN')
  })

  it('recommends offer mode for intercity routes', () => {
    const modes = resolveOrderModes({ time: 'now' }, { tripType: 'INTERCITY' }, { validatedSelectedClassId: 'x', fallbackClassId: 'x' })
    expect(modes.preferOfferMode).toBe(true)
    expect(modes.recommendedMode).toBe('offer')
    expect(modes.allowedModes).toEqual(['offer', 'order'])
  })

  it('keeps button layout deterministic for city routes', () => {
    const modes = { allowedModes: ['vote', 'offer', 'order'], recommendedMode: 'vote', preferOfferMode: false, reasons: [] }
    const layout = resolveButtonLayout(modes)
    expect(layout.primary).toEqual(['vote', 'order'])
    expect(layout.compactModes).toEqual(['offer'])
    expect(layout.emphasizedMode).toBe('vote')
  })
})

it('filters prohibited modes out of every button layout',()=>{
 const layout=resolveButtonLayout({allowedModes:['offer','order'],recommendedMode:'offer',preferOfferMode:true,reasons:['intercity']})
 expect(layout.items.map(x=>x.mode)).toEqual(['offer','order'])
 expect(layout.compactModes).not.toContain('vote')
})
it('delayed pickup cannot silently turn into immediate Voting',()=>{
 const modes=resolveOrderModes({time:Date.now()+3600000},{tripType:'CITY'},{validatedSelectedClassId:'x'})
 expect(modes.allowedModes).not.toContain('vote')
})

it('does not mask empty availability with a default or stale selected class',()=>{
 const util=require('../util');util.availableCarClasses.mockReturnValueOnce([])
 const facts={carClass:'petit',from:{latitude:30,longitude:-9},to:{latitude:31,longitude:-8},phone:'+212600000001'}
 const route={isLoading:false,effectiveLocationClass:'city',hasFrom:true,hasTo:true}
 const classes=resolveAvailableClasses(facts,route)
 expect(classes.fallbackClassId).toBeNull();expect(classes.validatedSelectedClassId).toBeNull()
 expect(resolveSubmitValidation(facts,route,classes).missing).toContain('carClass')
})
