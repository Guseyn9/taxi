export interface MapBox {left:number;top:number;width:number;height:number}
export interface SheetBox {top:number;right:number}
/** Screen point shared by the locator artwork and From/To coordinate callback. */
export function visibleMapPoint(box:MapBox,sheet:SheetBox|null,desktop:boolean):[number,number]{
 const left=desktop&&sheet?Math.max(0,Math.min(box.width-80,sheet.right-box.left)):0
 const bottom=!desktop&&sheet?Math.max(80,Math.min(box.height,sheet.top-box.top)):box.height
 return [(left+box.width)/2,bottom/2]
}
