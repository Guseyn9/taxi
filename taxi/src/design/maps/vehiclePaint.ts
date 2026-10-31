/** Tint only the red body paint. Windows, tyres, alpha and ginger livery are preserved. */
export function paintPixel(r:number,g:number,b:number,color:string):[number,number,number] {
 const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min
 if(!delta||max===0||delta/max<.32)return [r,g,b]
 let hue=max===r?((g-b)/delta+6)%6:max===g?(b-r)/delta+2:(r-g)/delta+4
 if(hue>.25&&hue<5.75)return [r,g,b]
 const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
 const hi=Math.max(...channels),lo=Math.min(...channels),d=hi-lo
 const h=!d?0:hi===channels[0]?((channels[1]-channels[2])/d+6)%6:hi===channels[1]?(channels[2]-channels[0])/d+2:(channels[0]-channels[1])/d+4
 const saturation=hi?d/hi:0,value=Math.min(1,max/255*hi/.85),chroma=value*saturation,x=chroma*(1-Math.abs(h%2-1)),m=value-chroma
 const rgb=h<1?[chroma,x,0]:h<2?[x,chroma,0]:h<3?[0,chroma,x]:h<4?[0,x,chroma]:h<5?[x,0,chroma]:[chroma,0,x]
 return rgb.map(v=>Math.round((v+m)*255)) as [number,number,number]
}

/** Grand's blue side band is distinct from the city's Petit paint. */
export function paintLiveryPixel(r:number,g:number,b:number,color:string,stripe?:string):[number,number,number]{
 if(stripe&&r>g*1.35&&g>b*1.5&&g>45){
  const shade=Math.max(.3,Math.min(1.2,Math.max(r,g,b)/235))
  return [1,3,5].map(i=>Math.min(255,Math.round(parseInt(stripe.slice(i,i+2),16)*shade))) as [number,number,number]
 }
 return paintPixel(r,g,b,color)
}
