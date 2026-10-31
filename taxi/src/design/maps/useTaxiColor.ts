import SITE_CONSTANTS from '../../siteConstants'
import {taxiColor,TaxiKind} from './taxiPalette'
/** The test camera preset must never choose an operating livery. */
export function useTaxiColor(point?:readonly number[]|null,kind:TaxiKind='petit'){
 return taxiColor({point,kind,palette:SITE_CONSTANTS.PALETTE?.primary?.main})
}
