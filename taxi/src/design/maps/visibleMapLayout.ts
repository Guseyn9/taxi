type Box = {top:number; left:number; right:number; bottom:number; width:number; height:number}
/** Ignore hidden panels: their zero-sized box must not shrink a fullscreen map. */
export function visibleMapLayout(map:Box, sheet:Box|undefined, card:Box|undefined, desktop:boolean, fullscreen:boolean, availableFrame:Box = map) {
  // The Leaflet child is resized by this result. Measuring that child again
  // would cap every later expansion at its previous (smaller) height.
  map = availableFrame
  const visibleCard = !fullscreen && card && card.width > 0 && card.height > 0
  const visibleSheet = !fullscreen && sheet && sheet.width > 0 && sheet.height > 0
  const visibleHeight = !desktop && visibleCard ? Math.max(48, Math.min(map.height, card!.top - map.top)) : map.height
  const coveredBottom = !desktop && visibleSheet ? Math.max(0, Math.min(map.height, map.top + visibleHeight - sheet!.top)) : 0
  const coveredLeft = desktop && visibleSheet ? Math.max(0, Math.min(sheet!.right - map.left + 16, map.width - 240)) : 0
  return {visibleHeight,coveredBottom,coveredLeft}
}
