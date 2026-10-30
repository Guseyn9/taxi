import {passengerRequestMode} from './passengerRequestMode'
import {IOrder} from '../types/types'

const standard={b_id:'standard',b_cars_count:1} as IOrder
const vote={b_id:'vote',b_voting:true,b_cars_count:1} as IOrder
const offer={b_id:'offer',b_cars_count:0} as IOrder

it('switches existing bookings independently of an Offer draft and keeps all three modes',()=>{
  const modes=[standard,vote,offer,standard].map(order=>passengerRequestMode({order,selectedMode:'offer',draft:{isOffer:true}}))
  expect(modes).toEqual(['order','vote','offer','order'])
})
it('a pending submission owns its mode before the booking is loaded',()=>{
  expect(passengerRequestMode({draft:{isVoting:true},selectedMode:'offer'})).toBe('vote')
  expect(passengerRequestMode({draft:{},selectedMode:'offer'})).toBe('order')
  expect(passengerRequestMode({draft:{isOffer:true},selectedMode:'order'})).toBe('offer')
})
it('only a new draft uses the remembered choice and its location default',()=>{
  expect(passengerRequestMode({selectedMode:'vote',preferOffer:true})).toBe('vote')
  expect(passengerRequestMode({preferOffer:true})).toBe('offer')
  expect(passengerRequestMode({})).toBe('order')
})
