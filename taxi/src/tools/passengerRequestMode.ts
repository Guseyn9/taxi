import {IOrder} from '../types/types'
import {isOfferOrder,isVotingOrder} from './driverOffer'

export type PassengerRequestMode = 'order' | 'vote' | 'offer'

/** A selected booking owns its mode; a new draft must never override it. */
export function passengerRequestMode({order,draft,selectedMode,preferOffer=false}:{
  order?: IOrder|null
  draft?: {isOffer?:boolean,isVoting?:boolean}|null
  selectedMode?: PassengerRequestMode|null
  preferOffer?:boolean
}):PassengerRequestMode {
  if(order)return isOfferOrder(order)?'offer':isVotingOrder(order)?'vote':'order'
  if(draft)return draft.isOffer?'offer':draft.isVoting?'vote':'order'
  return selectedMode??(preferOffer?'offer':'order')
}
