import {bookingFramePoints} from './bookingFrame'
it('frames all approaching drivers, including one beyond the passenger route, instead of the destination',()=>{
 const pickup=[30.4167,-9.6],destination=[30.45,-9.65],first=[30.414,-9.608],second=[30.422,-9.603]
 const points=bookingFramePoints(pickup,destination,[first,second,[NaN,0]],true)
 expect(points).toEqual([pickup,first,second]);expect(points).not.toContainEqual(destination)
})
it('keeps the booked route framing after a driver is assigned',()=>{
 expect(bookingFramePoints([30.4,-9.6],[30.5,-9.7],[[30.3,-9.5]],false)).toEqual([[30.4,-9.6],[30.5,-9.7]])
})

it('ignores placeholder and out-of-service positions when framing responders',()=>{expect(bookingFramePoints([30.4,-9.6],[30.5,-9.7],[[0,0],[5.6,-.2]],true)).toEqual([[30.4,-9.6]])})
