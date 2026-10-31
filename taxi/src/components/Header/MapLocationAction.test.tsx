import React,{act} from 'react'
import {createRoot,Root} from 'react-dom/client'
import MapLocationAction from './MapLocationAction'
let host:HTMLDivElement,root:Root
beforeEach(()=>{(global as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');host.className='layout';host.innerHTML='<header><div data-header-location-slot></div></header><main></main>';document.body.appendChild(host);root=createRoot(host.querySelector('main')!)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT})
it('keeps exactly one GPS action in the header and retains its click and busy state',async()=>{
 const locate=jest.fn();const render=(busy=false)=><MapLocationAction enabled><button onClick={locate} disabled={busy} aria-busy={busy}>Locate</button></MapLocationAction>
 await act(async()=>root.render(render()))
 expect(host.querySelector('main button')).toBeNull();expect(host.querySelectorAll('button')).toHaveLength(1)
 await act(async()=>(host.querySelector('header button') as HTMLButtonElement).click());expect(locate).toHaveBeenCalledTimes(1)
 await act(async()=>root.render(render(true)));expect((host.querySelector('header button') as HTMLButtonElement).disabled).toBe(true)
})
it('moves the action into a replacement header slot after language/config reload',async()=>{
 await act(async()=>root.render(<MapLocationAction enabled><button>Locate</button></MapLocationAction>))
 const old=host.querySelector('header')!
 await act(async()=>{const replacement=document.createElement('header');replacement.innerHTML='<div data-header-location-slot></div>';old.replaceWith(replacement);await Promise.resolve()})
 expect(host.querySelector('header button')?.textContent).toBe('Locate');expect(old.querySelector('button')).toBeNull();expect(host.querySelectorAll('button')).toHaveLength(1)
})
it('leaves modal map controls in their map and removes the header action on unmount',async()=>{
 await act(async()=>root.render(<MapLocationAction enabled><button>Locate</button></MapLocationAction>))
 await act(async()=>root.render(<MapLocationAction enabled={false}><button>Locate</button></MapLocationAction>))
 expect(host.querySelector('header button')).toBeNull();expect(host.querySelector('main button')?.textContent).toBe('Locate')
 await act(async()=>root.render(null));expect(host.querySelectorAll('button')).toHaveLength(0)
})
