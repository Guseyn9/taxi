import React,{act,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {useReleaseCanceledPassengerChoice,isCanceledPassengerChoice} from './useReleaseCanceledPassengerChoice'
import {setPassengerConfirmedChoice,getPassengerConfirmedChoice} from './driverOffer'
import {EBookingDriverState as Driver,EBookingStates as Booking} from '../types/types'
import {passengerGateway} from '../platform/adapters/LegacyPassengerGateway'
jest.mock('../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{getOrder:jest.fn()}}))

test('releases a canceled driver after the backend returns the order to search, including persisted choice',async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true
  localStorage.clear()
  const host=document.createElement('div'),root=createRoot(host)
  const order={b_id:'1931',b_state:Booking.Processing,drivers:[{u_id:'1306',c_state:Driver.Canceled},{u_id:'1307',c_state:Driver.Considering}]}
  const listener=jest.fn();window.addEventListener('passengerCanceledDriverChoice',listener)
  setPassengerConfirmedChoice('1931','1306')
  function State({value}){const [stored,release]=useState('1306');const choice=useReleaseCanceledPassengerChoice(value,stored,release);return <span>{choice||'search'}</span>}
  try{
    await act(async()=>root.render(<State value={{...order,drivers:undefined}}/>))
    expect(getPassengerConfirmedChoice('1931')).toBe('1306')
    await act(async()=>root.render(<State value={order}/>))
    expect(getPassengerConfirmedChoice('1931')).toBeNull()
    expect(host.textContent).toBe('search')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toEqual(expect.objectContaining({orderId:'1931',userId:'1306'}))
    await act(async()=>root.render(<State value={{...order}}/>))
    expect(listener).toHaveBeenCalledTimes(1)
  }finally{act(()=>root.unmount());window.removeEventListener('passengerCanceledDriverChoice',listener);localStorage.clear();delete global.IS_REACT_ACT_ENVIRONMENT}
})

test('reads an omitted driver from the full booking before releasing a choice',async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();jest.clearAllMocks()
  const host=document.createElement('div'),root=createRoot(host)
  const active={b_id:'1932',b_state:Booking.Processing,drivers:[{u_id:'1307',c_state:Driver.Considering}]}
  const assigned={...active,b_state:Booking.Approved,drivers:[{u_id:'1306',c_state:Driver.Performer}]}
  const canceled={...active,drivers:[{u_id:'1306',c_state:Driver.Canceled},...active.drivers]}
  passengerGateway.getOrder.mockResolvedValueOnce(assigned).mockResolvedValueOnce(canceled)
  setPassengerConfirmedChoice('1932','1306')
  function State({value}){const [stored,release]=useState('1306');const choice=useReleaseCanceledPassengerChoice(value,stored,release);return <span>{choice||'search'}</span>}
  try{
    await act(async()=>root.render(<State value={active}/>))
    expect(host.textContent).toBe('1306');expect(getPassengerConfirmedChoice('1932')).toBe('1306')
    await act(async()=>root.render(<State value={{...active}}/>))
    expect(host.textContent).toBe('search');expect(getPassengerConfirmedChoice('1932')).toBeNull()
    expect(passengerGateway.getOrder).toHaveBeenCalledTimes(2)
  }finally{act(()=>root.unmount());localStorage.clear();delete global.IS_REACT_ACT_ENVIRONMENT}
})

test('coalesces a pending read and ignores its result after another driver is chosen',async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;jest.clearAllMocks()
  const host=document.createElement('div'),root=createRoot(host),release=jest.fn()
  let resolve;const request=new Promise(yes=>{resolve=yes});passengerGateway.getOrder.mockReturnValue(request)
  const active={b_id:'1932',b_state:Booking.Processing,drivers:[{u_id:'1307',c_state:Driver.Considering}]}
  function State({value,driver}){useReleaseCanceledPassengerChoice(value,driver,release);return null}
  try{
    await act(async()=>root.render(<State value={active} driver="1306"/>))
    await act(async()=>root.render(<State value={{...active}} driver="1306"/>))
    expect(passengerGateway.getOrder).toHaveBeenCalledTimes(1)
    await act(async()=>root.render(<State value={active} driver="1307"/>))
    await act(async()=>{resolve({...active,drivers:[{u_id:'1306',c_state:Driver.Canceled}]});await request})
    expect(release).not.toHaveBeenCalled()
  }finally{act(()=>root.unmount());delete global.IS_REACT_ACT_ENVIRONMENT}
})

test('a failed read does not clear the stored choice',async()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;localStorage.clear();jest.clearAllMocks()
  const host=document.createElement('div'),root=createRoot(host),release=jest.fn()
  passengerGateway.getOrder.mockRejectedValue(new Error('Network Error'))
  setPassengerConfirmedChoice('1932','1306')
  function State(){useReleaseCanceledPassengerChoice({b_id:'1932',b_state:Booking.Processing,drivers:[]},'1306',release);return null}
  try{
    await act(async()=>root.render(<State/>))
    expect(release).not.toHaveBeenCalled();expect(getPassengerConfirmedChoice('1932')).toBe('1306')
  }finally{act(()=>root.unmount());localStorage.clear();delete global.IS_REACT_ACT_ENVIRONMENT}
})

test.each([
  ['empty read',{b_state:Booking.Processing},'1306'],
  ['another driver canceled',{b_state:Booking.Processing,drivers:[{u_id:'1307',c_state:Driver.Canceled}]},'1306'],
  ['chosen driver is still assigned',{b_state:Booking.Approved,drivers:[{u_id:'1306',c_state:Driver.Performer}]},'1306'],
  ['no local choice',{b_state:Booking.Processing,drivers:[{u_id:'1306',c_state:Driver.Canceled}]},null],
  ['terminal booking',{b_state:Booking.Canceled,drivers:[{u_id:'1306',c_state:Driver.Canceled}]},'1306'],
])('does not release a choice on %s',(_,order,id)=>expect(isCanceledPassengerChoice(order,id)).toBe(false))
