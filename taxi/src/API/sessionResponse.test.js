import axios from 'axios'
import './httpPolicy'
import { advanceSessionGeneration } from '../security/sessionLifecycle'
it('rejects an old response before endpoint-specific handlers run and accepts a new-session response',async()=>{
  let resolve,called=jest.fn()
  const request=axios.get('https://example.invalid/old',{adapter:config=>new Promise(yes=>{resolve=()=>yes({config,data:{old:true},status:200,statusText:'OK',headers:{}})})}).then(called)
  for(let i=0;i<4;i++)await Promise.resolve()
  advanceSessionGeneration();resolve()
  await expect(request).rejects.toThrow('Session changed');expect(called).not.toHaveBeenCalled()
  const response=await axios.get('https://example.invalid/new',{adapter:async config=>({config,data:{current:true},status:200,statusText:'OK',headers:{}})})
  expect(response.data.current).toBe(true)
})
