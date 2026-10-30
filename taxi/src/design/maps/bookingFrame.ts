import {isInMoroccoView} from './morocco'
import {validMapPoint} from './locationPolicy'
export function bookingFramePoints(pickup:number[],destination:number[],drivers:readonly number[][],approach:boolean):[number,number][]{
 const points=approach?[pickup,...drivers]:[pickup,destination]
 return points.filter(point=>validMapPoint(point)&&isInMoroccoView(point)).map(point=>[point[0],point[1]])
}
