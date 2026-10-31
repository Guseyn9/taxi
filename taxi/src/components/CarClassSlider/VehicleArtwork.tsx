import React,{useEffect,useState} from 'react'
import {safeTaxiColor,vehicleAsset} from '../../design/maps/taxiPalette'
import {paintPixel,paintGrandPixel} from '../../design/maps/vehiclePaint'
const images=new Map<string,Promise<HTMLImageElement>>()
const painted=new Map<string,string>()
const pending=new Map<string,Promise<string>>()
function load(src:string){
 if(!images.has(src))images.set(src,new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=src}))
 return images.get(src)!
}
function artwork(kind:string,color:string){
 const key=`${kind}:${color}`,src=vehicleAsset(kind as 'petit'|'grand')
 if((color==='#a90000'&&kind==='petit')||(color==='#ffffff'&&kind==='grand'))return Promise.resolve(src)
 if(painted.has(key))return Promise.resolve(painted.get(key)!)
 if(pending.has(key))return pending.get(key)!
 const job=load(src).then(img=>{
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Vehicle artwork unavailable')
  ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height)
  for(let i=0;i<pixels.data.length;i+=4){if(!pixels.data[i+3])continue;const rgb=(kind==='grand'?paintGrandPixel:paintPixel)(pixels.data[i],pixels.data[i+1],pixels.data[i+2],color);pixels.data[i]=rgb[0];pixels.data[i+1]=rgb[1];pixels.data[i+2]=rgb[2]}
  ctx.putImageData(pixels,0,0);const uri=canvas.toDataURL('image/png');if(painted.size>=12)painted.delete(painted.keys().next().value!);painted.set(key,uri);return uri
 }).finally(()=>pending.delete(key))
 pending.set(key,job);return job
}
export default function VehicleArtwork({kind,color,className}:{kind:'petit'|'grand',color:string,className?:string}){
 const paint=(safeTaxiColor(color)||'#666670').toLowerCase(),key=`${kind}:${paint}`
 const [result,setResult]=useState<{key:string,src:string}|null>(null)
 useEffect(()=>{let alive=true;artwork(kind,paint).then(src=>{if(alive)setResult({key,src})}).catch(()=>{if(alive)setResult(null)});return()=>{alive=false}},[kind,paint,key])
 const src=(paint==='#a90000'&&kind==='petit')||(paint==='#ffffff'&&kind==='grand')?vehicleAsset(kind):painted.get(key)||(result?.key===key?result.src:undefined)
 return <img className={className} src={src} alt="" width={192} height={96} decoding="async" data-vehicle-paint={paint} style={{visibility:src?'visible':'hidden'}}/>
}
