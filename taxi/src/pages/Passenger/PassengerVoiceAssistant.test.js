import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
let mockHandler
const mockGeocode=jest.fn()
jest.mock('../../platform/adapters/LegacyPassengerGateway',()=>({passengerGateway:{geocode:(...args)=>mockGeocode(...args)}}))
jest.mock('../../platform/platform-interface',()=>({platformInterface:{runtime:{registerHandler:handler=>{mockHandler=handler;return()=>{mockHandler=null}}}}}))
jest.mock('../../platform/voice-channel/BrowserVoiceChannel',()=>({VOICE_TRANSCRIPT_RECEIVED:'voice.transcript.received',BrowserVoiceChannel:class{
 isRecognitionSupported(){return true} speak(){return Promise.resolve()} listenOnce(){return new Promise(()=>{})} stop(){}
}}))
import {PassengerVoiceAssistant} from './PassengerVoiceAssistant'
import {isConfirmation,isRejection} from './voiceIntent'
let host,root,from,to,submit
const address={lat:'30.42',lon:'-9.6',display_name:'Avenue Hassan II'}
const render=(languageIso='ru')=>act(async()=>root.render(<PassengerVoiceAssistant languageIso={languageIso} getMapSearchCenter={()=>[30.42,-9.6]} setFrom={from} setTo={to} onSubmitOrder={submit}/>))
const emit=text=>act(async()=>mockHandler({type:'voice.transcript.received',payload:{text}}))
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);from=jest.fn();to=jest.fn();submit=jest.fn().mockResolvedValue(true);mockGeocode.mockReset();mockGeocode.mockResolvedValue(address)})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete global.IS_REACT_ACT_ENVIRONMENT})
it('does not turn a negative or ambiguous sentence into confirmation',()=>{
 for(const text of ['не подтверждаю','я не подтверждаю','do not confirm','not yes','no confirmar','это да но адрес неверный'])expect(isConfirmation(text)).toBe(false)
 expect(isRejection('не подтверждаю')).toBe(true)
 for(const text of ['Подтверждаю!','yes','confirmer','أؤكد','sí'])expect(isConfirmation(text)).toBe(true)
})
it('stopped geocoding cannot change the route or revive dialogue',async()=>{
 let resolve;mockGeocode.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await act(async()=>host.querySelector('button').click())
 let pending;await act(async()=>{pending=mockHandler({type:'voice.transcript.received',payload:{text:'address'}})})
 await act(async()=>host.querySelector('button').click())
 await act(async()=>{resolve(address);await pending})
 expect(from).not.toHaveBeenCalled();expect(to).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled()
 expect(host.querySelector('button').getAttribute('aria-pressed')).toBe('false')
})
it('locale switch invalidates an outstanding address request',async()=>{
 let resolve;mockGeocode.mockImplementation(()=>new Promise(done=>{resolve=done}))
 await render();await act(async()=>host.querySelector('button').click())
 let pending;await act(async()=>{pending=mockHandler({type:'voice.transcript.received',payload:{text:'address'}})})
 await render('fr');await act(async()=>{resolve(address);await pending})
 expect(from).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled()
})
it('fills both fields, requires explicit confirmation and submits once',async()=>{
 await render();await act(async()=>host.querySelector('button').click())
 await emit('address A');await emit('address B')
 expect(from).toHaveBeenCalledTimes(1);expect(to).toHaveBeenCalledTimes(1);expect(submit).not.toHaveBeenCalled()
 await emit('проверь адрес');expect(submit).not.toHaveBeenCalled()
 await emit('подтверждаю');await emit('подтверждаю')
 expect(submit).toHaveBeenCalledTimes(1)
})
