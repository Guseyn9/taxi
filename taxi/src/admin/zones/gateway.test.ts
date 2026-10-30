jest.mock('axios',()=>({__esModule:true,default:{get:jest.fn(),post:jest.fn()}}))
jest.mock('../../config',()=>({__esModule:true,default:{API_URL:'https://test.invalid/api/v1'}}))
jest.mock('../../tools/api',()=>({apiMethod:(method:any)=>(...args:any[])=>{const formData=new FormData();formData.append('token','test-session');formData.append('u_hash','test-hash');return method({formData},...args)}}))
import axios from 'axios'
import {readZoneCatalog,saveZone} from './gateway'
const client=axios as any
beforeEach(()=>jest.clearAllMocks())
it('reads the existing polygon catalog with a bounded request',async()=>{
 client.get.mockResolvedValue({data:{code:'200',status:'success',data:{data:{map_place_polygons:{'79':{var:'agadir'}}}}}})
 await expect(readZoneCatalog()).resolves.toEqual([{id:'79',var:'agadir'}])
 expect(client.get).toHaveBeenCalledWith('https://test.invalid/api/v1/data',{params:{fields:'map_place_polygons'},timeout:10000})
})
it('uses the supplied admin API schema, existing session auth and no replay on timeout',async()=>{
 client.post.mockRejectedValue(new Error('timeout'))
 await expect(saveZone({id:'79',var:'agadir',json:{lat:30,lng:-9,radius:200}},'circle')).rejects.toThrow('timeout')
 expect(client.post).toHaveBeenCalledTimes(1)
 const [url,form,options]=client.post.mock.calls[0]
 expect(url).toBe('https://test.invalid/api/v1/data');expect(options.timeout).toBe(15000)
 expect(form.get('token')).toBe('test-session');expect(form.get('u_hash')).toBe('test-hash')
 expect(JSON.parse(form.get('data')).map_place_polygons[0]).toEqual(expect.objectContaining({id:'79',var:'agadir',json:{lat:30,lng:-9,radius:200}}))
})
it('does not treat HTTP 200 backend refusal as a successful save',async()=>{
 client.post.mockResolvedValue({data:{code:'403',status:'error'}})
 await expect(saveZone({var:'agadir',json:{lat:30,lng:-9,radius:200}},'circle')).rejects.toThrow()
})
