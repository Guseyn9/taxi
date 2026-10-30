import React,{act,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {useSwipe} from '../tools/swipe'

test('a hidden or detached booking panel survives a queued resize and expansion',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true
 const previousObserver=global.ResizeObserver
 const resizeCallbacks=[]
 global.ResizeObserver=class {constructor(callback){resizeCallbacks.push(callback)}observe(){}disconnect(){}}
 const host=document.createElement('div');document.body.appendChild(host)
 const root=createRoot(host)
 function Fixture(){
  const panel=useRef(null),body=useRef(null),content=useRef(null)
  const {isExpanded,setIsExpanded}=useSwipe(panel,body,content)
  return <div ref={panel} style={{display:'none'}}><div ref={body}><div ref={content}/><button onClick={()=>setIsExpanded(true)}>{String(isExpanded)}</button></div></div>
 }
 try {
  await act(async()=>root.render(<Fixture/>))
  expect(host.firstChild.offsetParent).toBeNull()
  await act(async()=>{resizeCallbacks.forEach(callback=>callback());host.querySelector('button').click()})
  expect(host.querySelector('button').textContent).toBe('true')
  await act(async()=>root.unmount())
  expect(()=>resizeCallbacks.forEach(callback=>callback())).not.toThrow()
 } finally {
  host.remove();global.ResizeObserver=previousObserver;delete global.IS_REACT_ACT_ENVIRONMENT
 }
})
