import {Coordinate,coordinate} from './model'
/** Open paths are editable; malformed JSON or malformed coordinate pairs are not. */
export function parseZonePoints(text:string):Coordinate[]|null {
 try{const points:unknown=JSON.parse(text);return Array.isArray(points)&&points.every(coordinate)?points:null}catch{return null}
}
export function closedBoundary(points:Coordinate[]):boolean {
 const first=points[0],last=points[points.length-1]
 return points.length>3&&coordinate(first)&&coordinate(last)&&first[0]===last[0]&&first[1]===last[1]
}
export function moveVertex(points:Coordinate[],index:number,point:Coordinate):Coordinate[] {
 if(!Number.isInteger(index)||index<0||index>=points.length||!coordinate(point))return points
 const result=points.slice();result[index]=point
 if(closedBoundary(points)&&(index===0||index===points.length-1))result[0]=result[result.length-1]=point
 return result
}
export function insertVertex(points:Coordinate[],after:number,point:Coordinate):Coordinate[] {
 if(!Number.isInteger(after)||after<0||after>=points.length-1||!coordinate(point))return points
 return [...points.slice(0,after+1),point,...points.slice(after+1)]
}
export function canRemoveVertex(points:Coordinate[],index:number):boolean {
 return Number.isInteger(index)&&index>=0&&index<(closedBoundary(points)?points.length-1:points.length)&&(!closedBoundary(points)||points.length>4)
}
export function removeVertex(points:Coordinate[],index:number):Coordinate[] {
 if(!canRemoveVertex(points,index))return points
 if(!closedBoundary(points))return points.filter((_,i)=>i!==index)
 const result=points.slice(0,-1).filter((_,i)=>i!==index)
 return [...result,result[0]]
}
