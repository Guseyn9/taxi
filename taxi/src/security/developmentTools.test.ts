import { developmentToolsEnabled } from './developmentTools'
it('hides tools on every production host and on remote development hosts',()=>{
 for(const host of ['localhost','127.0.0.1','taxi-morocco-frontend.vercel.app'])expect(developmentToolsEnabled(true,host)).toBe(false)
 expect(developmentToolsEnabled(false,'taxi-morocco-frontend.vercel.app')).toBe(false)
 expect(developmentToolsEnabled(false,'localhost')).toBe(true)
})
