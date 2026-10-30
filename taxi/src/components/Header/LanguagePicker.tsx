import React,{useEffect,useRef,useState} from 'react'
import {Globe2,Check} from 'lucide-react'
import {ILanguage} from '../../types/types'
export default function LanguagePicker({languages,language,label,onChange,onOpen,dismiss}:{languages:ILanguage[],language:ILanguage,label:string,onChange:(lang:ILanguage)=>void,onOpen?:()=>void,dismiss?:boolean}) {
 const [open,setOpen]=useState(false),host=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null)
 useEffect(()=>{if(dismiss)setOpen(false)},[dismiss])
 useEffect(()=>{
  if(!open)return
  host.current?.querySelector<HTMLButtonElement>('[aria-checked=true]')?.focus()
  const outside=(event:PointerEvent)=>{if(!host.current?.contains(event.target as Node))setOpen(false)}
  document.addEventListener('pointerdown',outside)
  return()=>document.removeEventListener('pointerdown',outside)
 },[open])
 return <div className="header-language" ref={host} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}>
  <button ref={trigger} type="button" className="header-language__trigger" aria-label={`${label}: ${language.native}`} aria-haspopup="menu" aria-expanded={open} onClick={()=>{if(!open)onOpen?.();setOpen(x=>!x)}}><Globe2 size={20} aria-hidden="true"/><span>{language.iso.split('-')[0].toUpperCase()}</span></button>
  {open&&<div role="menu" aria-label={label} className="header-language__panel" onKeyDown={event=>{
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus();return}
   const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'))
   const index=items.indexOf(document.activeElement as HTMLButtonElement)
   const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index+items.length-1)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null
   if(next!==null){event.preventDefault();items[next]?.focus()}
  }}><div className="header-language__title" role="presentation">{label}</div>{languages.map(item=><button key={item.id} type="button" role="menuitemradio" aria-checked={language.id===item.id} onClick={()=>{onChange(item);setOpen(false);trigger.current?.focus()}}><span>{item.native}</span>{language.id===item.id&&<Check size={18} aria-hidden="true"/>}</button>)}</div>}
 </div>
}
