import React,{useEffect,useId,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {MapPin,ChevronDown,Check} from 'lucide-react'

type Region={id:string,label:string}
export default function RegionPicker({value,regions,label,onChange}:{value:string,regions:Region[],label:string,onChange:(value:string)=>void}) {
 const [open,setOpen]=useState(false)
 const [position,setPosition]=useState({top:0,left:0,width:280,maxHeight:360})
 const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),id=useId()
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true})}
 useEffect(()=>{
  if(!open)return
  const rect=trigger.current!.getBoundingClientRect(),width=Math.min(280,window.innerWidth-24)
  setPosition({top:rect.bottom+8,left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),width,maxHeight:Math.max(44,Math.min(360,window.innerHeight-rect.bottom-24))})
  const frame=requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>('[aria-selected=true]')?.focus())
  const outside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!panel.current?.contains(event.target as Node))close()}
  const resize=()=>close()
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',resize)
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',resize)}
 },[open])
 return <>
  <button type="button" ref={trigger} className="rs-map-region" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
   onClick={()=>setOpen(previous=>!previous)} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();event.stopPropagation();setOpen(true)}}}>
   <MapPin size={18} aria-hidden="true"/><span>{regions.find(region=>region.id===value)?.label}</span><ChevronDown size={16} aria-hidden="true"/>
  </button>
  {open&&createPortal(<div ref={panel} id={id} role="listbox" aria-label={label} className="rs-region-popup" style={position} onKeyDown={event=>{
   event.stopPropagation()
   if(event.key==='Escape'){event.preventDefault();close(true);return}
   if(event.key==='Tab'){close(true);return}
   const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=option]')),index=items.indexOf(document.activeElement as HTMLButtonElement)
   let next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null
   if(next===null&&event.key.length===1){const key=event.key.toLocaleLowerCase();for(let step=1;step<=items.length;step++){const candidate=(index+step)%items.length;if(items[candidate].textContent?.toLocaleLowerCase().startsWith(key)){next=candidate;break}}}
   if(next!==null){event.preventDefault();items[next]?.focus()}
  }}>
   <div className="rs-region-popup__title" role="presentation">{label}</div>
   {regions.map(region=><button type="button" role="option" tabIndex={region.id===value?0:-1} aria-selected={region.id===value} key={region.id} onClick={()=>{onChange(region.id);close(true)}}>
    <MapPin size={18} aria-hidden="true"/><span>{region.label}</span>{region.id===value&&<Check size={18} aria-hidden="true"/>}
   </button>)}
  </div>,document.body)}
 </>
}
