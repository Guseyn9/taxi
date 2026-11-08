/** @jest-environment node */
const config=require('../../../vercel.json')
function policyFor(path){
 let policy=''
 for(const row of config.headers)if(new RegExp('^'+row.source+'$').test(path)){
  for(const header of row.headers)if(header.key.toLowerCase()==='content-security-policy')policy=header.value
 }
 return policy
}
it('permits the map source on the deployed zone fixture while other QA pages stay offline',()=>{
 const policy=policyFor('/qa/zones/')
 expect(policy).toContain("connect-src 'self' https://tiles.openfreemap.org;")
 expect(policy).toContain("form-action 'none'")
 for(const path of ['/qa/','/qa/forms/'])expect(policyFor(path)).toContain("connect-src 'none'")
 expect(policy).not.toContain('itest24.com');expect(policy).not.toContain('connect-src *')
})
