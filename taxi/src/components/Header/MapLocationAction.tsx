import React,{useLayoutEffect,useState} from 'react'
import {createPortal} from 'react-dom'

/** The map owns the GPS action; the header only provides its visual position. */
export default function MapLocationAction({enabled,children}:{enabled:boolean,children:React.ReactNode}){
 const [target,setTarget]=useState<HTMLElement|null>(null)
 useLayoutEffect(()=>{
  if(!enabled){setTarget(null);return}
  const layout=document.querySelector('.layout')
  if(!layout)return
  const update=()=>{
   const next=layout.querySelector<HTMLElement>('[data-header-location-slot]')
   setTarget(previous=>previous===next?previous:next)
  }
  update()
  // Header is replaced when service configuration or language changes.
  const observer=new MutationObserver(update)
  observer.observe(layout,{childList:true,subtree:true})
  return ()=>observer.disconnect()
 },[enabled])
 if(!enabled)return <>{children}</>
 return target?createPortal(children,target):null
}
