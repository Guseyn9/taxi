/** Available page height, excluding browser chrome and keyboard; pinch zoom stays accessible. */
export function visibleAppHeight(innerHeight:number,viewportHeight?:number,scale=1){
 const base=Number.isFinite(innerHeight)&&innerHeight>0?innerHeight:0
 if(scale!==1||!Number.isFinite(viewportHeight)||!viewportHeight||viewportHeight<=0)return Math.round(base)
 return Math.round(base?Math.min(base,viewportHeight):viewportHeight)
}
