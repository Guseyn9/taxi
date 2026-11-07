import axios from 'axios'
import {postDrive,confirmDrive,getOrders,updateOrderCustomerPrice,takeOrder,sendOrderOffer,participateVotingOrder,cancelDrive} from './order'
import {getUserCar} from './car'
import {EOrderTypes} from '../types/types'
let mockUser={u_id:'client-1',u_role:1}
jest.mock('axios',()=>({__esModule:true,default:{post:jest.fn()}}))
jest.mock('./httpPolicy',()=>({}))
jest.mock('../state',()=>({__esModule:true,default:{getState:()=>({})}}))
jest.mock('../state/user',()=>({userSelectors:{user:()=>mockUser,tokens:()=>({token:'test-token',u_hash:'test-hash'})}}))
jest.mock('../config',()=>({__esModule:true,default:{API_URL:'https://local.example.test/api/v1'}}))
jest.mock('../siteConstants',()=>({__esModule:true,default:{TEST_USER_IDS:[]}}))
jest.mock('../localization',()=>({t:value=>value,TRANSLATION:{}}))
jest.mock('../tools/utils',()=>({cloneFormData:original=>{const copy=new FormData();original.forEach((v,k)=>copy.append(k,v));return copy}}))
jest.mock('./car',()=>({getUserCar:jest.fn()}))
jest.mock('../tools/driverOffer',()=>({setPassengerConfirmedChoice:jest.fn()}))
jest.mock('../tools/emulatorMode',()=>({isAnyBrowserEmulatorOrder:()=>false,isBrowserEmulatorRunning:()=>false,saveBrowserEmulatorOrderId:jest.fn()}))
jest.mock('../tools/orderInteractionLog',()=>({recordOrderInteraction:jest.fn()}))
const success=(data={})=>({data:{code:'200',status:'success',data}})
const read=(confirmed,id='42')=>success({booking:{[id]:{b_id:id,b_confirm_state:confirmed?1:0,b_state:1,b_voting:1}}})
const error={code:'404',status:'error',message:'wrong b_options keys'}
const formAt=i=>axios.post.mock.calls[i][1]
const actions=()=>axios.post.mock.calls.map(([,form])=>form.get('action'))
beforeEach(()=>{localStorage.clear();sessionStorage.clear();jest.clearAllMocks();mockUser={u_id:'client-1',u_role:1};getUserCar.mockResolvedValue({c_id:'car-7',registration_plate:'1234'})})
test('creation preserves explicit Offer options and posts once',async()=>{
 axios.post.mockResolvedValueOnce(success({b_id:42}))
 await expect(postDrive({b_cars_count:1,b_options:{customer_price:150.25,offer_mode:'OFFER'}})).resolves.toMatchObject({b_id:'42'})
 expect(axios.post).toHaveBeenCalledTimes(1)
 expect(JSON.parse(formAt(0).get('data'))).toMatchObject({b_cars_count:'1',b_options:{customer_price:150.25,offer_mode:'OFFER'}})
})
test('creation refusal does not retry with altered or omitted options',async()=>{
 axios.post.mockResolvedValueOnce({data:error})
 await expect(postDrive({b_options:{customer_price:150,offer_mode:'OFFER'}})).rejects.toEqual(error)
 expect(axios.post).toHaveBeenCalledTimes(1)
})
test('confirmation reads first and skips a confirmed booking',async()=>{
 axios.post.mockResolvedValueOnce(read(true))
 await expect(confirmDrive('42')).resolves.toMatchObject({reconciled:true})
 expect(actions()).toEqual([null])
})
test('confirmation refusal is not swallowed or blindly retried',async()=>{
 axios.post.mockResolvedValueOnce(read(false)).mockResolvedValueOnce({data:error}).mockResolvedValueOnce(read(false))
 await expect(confirmDrive('42')).rejects.toEqual(error)
 expect(actions()).toEqual([null,'set_confirm_state',null])
 expect(formAt(2).has('data')).toBe(false)
})
test('lost confirmation response is reconciled by a read without repeating POST',async()=>{
 axios.post.mockResolvedValueOnce(read(false)).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(read(true))
 await expect(confirmDrive('42')).resolves.toMatchObject({reconciled:true})
 expect(actions()).toEqual([null,'set_confirm_state',null])
})
test('failed second creation step preserves the known booking ID for recovery',async()=>{
 axios.post.mockResolvedValueOnce(success({b_id:42})).mockResolvedValueOnce(read(false)).mockResolvedValueOnce({data:error}).mockResolvedValueOnce(read(false))
 await expect(postDrive({b_voting:true,b_services:[5]})).resolves.toMatchObject({b_id:'42',confirmationPending:true})
 expect(actions()).toEqual([null,null,'set_confirm_state',null])
 expect(axios.post.mock.calls.filter(([url])=>url==='https://local.example.test/api/v1/drive')).toHaveLength(1)
})
test('unknown confirmation state does not permit a write',async()=>{
 axios.post.mockResolvedValueOnce(success({booking:{}}))
 await expect(confirmDrive('42')).rejects.toThrow('confirmation state is unavailable')
 expect(actions()).toEqual([null])
})
test('only an owning client sees unconfirmed Voting in its active list',async()=>{
 const rows=[{b_id:'42',u_id:'client-1',b_voting:1,b_confirm_state:0},{b_id:'43',u_id:'other',b_voting:1,b_confirm_state:0},{b_id:'44',u_id:'client-1',b_voting:0,b_confirm_state:0}]
 axios.post.mockResolvedValueOnce(success({booking:rows,user:{}}))
 expect((await getOrders(EOrderTypes.Active)).data.booking.map(o=>o.b_id)).toEqual(['42'])
 mockUser={u_id:'client-1',u_role:2}
 axios.post.mockResolvedValueOnce(success({booking:rows,user:{}}))
 expect((await getOrders(EOrderTypes.Active)).data.booking).toEqual([])
})
test('price edit uses the option assignment operator and sends no stale address or count',async()=>{
 axios.post.mockResolvedValueOnce(success())
 await updateOrderCustomerPrice({b_id:'42',b_start_address:'stale',b_cars_count:3},'150,25')
 expect(JSON.parse(formAt(0).get('data'))).toEqual({b_options:[['=',['customer_price'],150.25]]})
})
test('taking a booking sends one-car price and ETA with no invented vehicle PIN',async()=>{
 axios.post.mockResolvedValueOnce(success({}))
 await takeOrder('42',{performers_price:0,offerEta:'5 minutes'})
 expect(axios.post).toHaveBeenCalledTimes(1)
 expect(formAt(0).has('b_driver_code')).toBe(false)
 expect(JSON.parse(formAt(0).get('data'))).toMatchObject({c_id:'car-7',c_options:{performers_price:0,driver_offer_eta:'5 minutes'}})
})
test('Offer and Voting retain ETA and decimal fare inside c_options',async()=>{
 axios.post.mockResolvedValue(success({}))
 await sendOrderOffer('42',{price:180.5,eta:'10 minutes',comment:'gate'})
 await participateVotingOrder('43',22.5,'5 minutes')
 expect(JSON.parse(formAt(0).get('data')).c_options).toEqual({performers_price:180.5,driver_offer_eta:'10 minutes',driver_offer_comment:'gate'})
 expect(JSON.parse(formAt(1).get('data')).c_options).toEqual({performers_price:22.5,driver_offer_eta:'5 minutes'})
 expect(formAt(1).get('performer')).toBe('0')
})
test('an empty confirmation acknowledgement is not mistaken for success',async()=>{
 axios.post.mockResolvedValueOnce(read(false)).mockResolvedValueOnce({data:{}}).mockResolvedValueOnce(read(false))
 await expect(confirmDrive('42')).rejects.toEqual({})
 expect(actions()).toEqual([null,'set_confirm_state',null])
})

test.each(['200','404'])('cancellation rejects a resolved business error code=%s without retry',async code=>{
 axios.post.mockResolvedValueOnce({data:{code,status:'error',message:'wrong booking state'}})
 await expect(cancelDrive('42','waited too long')).rejects.toMatchObject({code:'BACKEND_RESPONSE_ERROR'})
 expect(axios.post).toHaveBeenCalledTimes(1);expect(actions()).toEqual(['set_cancel_state'])
})

test.each([null,{}, {status:'success'}, {code:'200',status:'failed'}])('cancellation never treats an unacknowledged mutation response as success: %j',async response=>{
 axios.post.mockResolvedValueOnce({data:response})
 await expect(cancelDrive('42')).rejects.toMatchObject({code:'BACKEND_RESPONSE_ERROR'})
 expect(axios.post).toHaveBeenCalledTimes(1)
})
