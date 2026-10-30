import React,{useRef} from 'react'
export default function SheetHandle({collapsed,onChange,iso}:{collapsed:boolean;onChange:(collapsed:boolean)=>void;iso?:string}){
 const pointerStart=useRef<number|null>(null),dragged=useRef(false)
 const ru=(iso||'').startsWith('ru'),fr=(iso||'').startsWith('fr'),ar=(iso||'').startsWith('ar')
 const expand=ru?'Развернуть форму':fr?'Afficher le formulaire':ar?'إظهار النموذج':'Expand booking form'
 const collapse=ru?'Свернуть форму':fr?'Réduire le formulaire':ar?'طي النموذج':'Collapse booking form'
 return <button className="passenger-sheet-handle" type="button" aria-label={collapsed?expand:collapse} aria-expanded={!collapsed}
 onPointerDown={e=>{pointerStart.current=e.clientY;dragged.current=false;e.currentTarget.setPointerCapture?.(e.pointerId)}}
 onPointerUp={e=>{if(pointerStart.current!==null&&Math.abs(e.clientY-pointerStart.current)>24){dragged.current=true;onChange(e.clientY>pointerStart.current)}pointerStart.current=null}}
 onPointerCancel={()=>{pointerStart.current=null;dragged.current=false}}
 onClick={()=>{if(!dragged.current)onChange(!collapsed);dragged.current=false}}><span aria-hidden="true"/>{collapsed&&<strong>{expand}</strong>}</button>
}
