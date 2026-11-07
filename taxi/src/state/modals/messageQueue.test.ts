import reducer from './reducer'
import { ActionTypes } from './constants'
const show=(message:string)=>({type:ActionTypes.SET_MESSAGE_MODAL,payload:{isOpen:true,message}})
const dismiss=(id?:string)=>({type:ActionTypes.SET_MESSAGE_MODAL,payload:{isOpen:false,id}})
it('retains simultaneous operation errors in order until each is acknowledged',()=>{
 let state=reducer(undefined,show('cancel failed'));const first=state.messageModal.id
 state=reducer(state,show('upload failed'));state=reducer(state,show('connection lost'))
 expect(state.messageModal.message).toBe('cancel failed');expect(state.messageQueue).toHaveLength(2)
 state=reducer(state,dismiss(first));expect(state.messageModal.message).toBe('upload failed')
 state=reducer(state,dismiss(first));expect(state.messageModal.message).toBe('upload failed')
 state=reducer(state,dismiss(state.messageModal.id));expect(state.messageModal.message).toBe('connection lost')
 state=reducer(state,dismiss(state.messageModal.id));expect(state.messageModal.isOpen).toBe(false);expect(state.messageQueue).toHaveLength(0)
})
it('clears queued account messages on teardown and never reuses a prior dialog id',()=>{
 let state=reducer(undefined,show('old'));const id=state.messageModal.id
 state=reducer(state,show('old queued'));state=reducer(state,{type:ActionTypes.CLOSE_ALL_MODALS})
 expect(state.messageQueue).toHaveLength(0);expect(state.messageModal.isOpen).toBe(false)
 state=reducer(state,show('new'));state=reducer(state,dismiss(id));expect(state.messageModal.message).toBe('new')
})
