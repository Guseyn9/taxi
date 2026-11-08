import {bookingBlock} from './bookingReadiness'
const point={latitude:30.42,longitude:-9.6,address:'Confirmed'}
const ready={from:point,to:point,fromZoneStatus:'ready',toZoneStatus:'ready',zonesReady:true,hasClass:true,phoneValid:true,pending:false}
test.each([
 ['ready',{},null],['pickup',{from:null},'pickup'],['typed address',{from:{address:'Agadir'}},'pickup'],
 ['destination',{to:null},'destination'],['resolving',{from:{...point,isAddressResolving:true}},'addressLoading'],
 ['failed zone',{fromZoneStatus:'error',zonesReady:false},'zoneError'],['checking zone',{toZoneStatus:'checking',zonesReady:false},'zonesLoading'],
 ['no class',{hasClass:false},'noClass'],['phone',{phoneValid:false},'phone'],['pending',{pending:true},'pending'],
])('%s explains the actual blocking condition',(_,override,expected)=>expect(bookingBlock({...ready,...override})).toBe(expected))
