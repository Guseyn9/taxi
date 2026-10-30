import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {useDriverDepartures} from './driverPickupJourney'

it('updates an already-mounted map when another surface departs, restores on remount, and isolates accounts',async()=>{
  (global as any).IS_REACT_ACT_ENVIRONMENT=true
  sessionStorage.clear()
  const host=document.createElement('div');document.body.appendChild(host)
  const root=createRoot(host)
  function Surface({owner,name}:{owner:string,name:string}){
    const journey=useDriverDepartures(owner)
    return <button data-surface={name} onClick={()=>journey.depart('18515')}>{journey.ids.join(',')||'parked'}</button>
  }
  const render=(owner='a')=><><Surface owner={owner} name="map"/><Surface owner={owner} name="card"/><Surface owner="b" name="other"/></>
  try{
    await act(async()=>root.render(render()))
    await act(async()=>host.querySelector<HTMLButtonElement>('[data-surface=card]')!.click())
    expect(host.querySelector('[data-surface=map]')!.textContent).toBe('18515')
    expect(host.querySelector('[data-surface=other]')!.textContent).toBe('parked')
    await act(async()=>root.render(render('b')))
    expect(host.querySelector('[data-surface=map]')!.textContent).toBe('parked')
    await act(async()=>root.render(render('a')))
    expect(host.querySelector('[data-surface=map]')!.textContent).toBe('18515')
  }finally{await act(async()=>root.unmount());host.remove();delete (global as any).IS_REACT_ACT_ENVIRONMENT}
})
