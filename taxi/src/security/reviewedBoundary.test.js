const crypto=require('crypto')
const {assessReviewedBoundary,classifyBoundaryDifferences}=require('../../tools/lib/reviewed-boundary.cjs')
const hash=s=>crypto.createHash('sha256').update(s).digest('hex')
const manifest=()=>({schemaVersion:1,paths:{'src/API/order.ts':{baselineSha256:hash('before'),currentSha256:hash('after'),reason:'Single request, explicit contract',evidence:['src/API/order.transport.test.js']}},exceptions:{'src/API/order.ts :: _postDrive':'src/API/order.ts'}})
const readers=(baseline='before',current='after',evidence=true)=>({readBaseline:()=>baseline,readCurrent:()=>current,hasEvidence:()=>evidence})
it('admits only a reviewed difference at the exact original and current versions',()=>{
 const m=manifest(),r=assessReviewedBoundary(m,readers())
 expect(r.errors).toEqual([])
 expect(classifyBoundaryDifferences(['src/API/order.ts :: _postDrive','src/API/order.ts :: newMutation'],m,r)).toMatchObject({reviewed:[{key:'src/API/order.ts :: _postDrive'}],remaining:['src/API/order.ts :: newMutation']})
})
it('rejects altered current code even when the path is already reviewed',()=>{
 const m=manifest(),r=assessReviewedBoundary(m,readers('before','after + retryWithoutPin()'))
 expect(r.errors).toEqual(['src/API/order.ts :: reviewed implementation changed'])
 expect(classifyBoundaryDifferences(Object.keys(m.exceptions),m,r).remaining).toHaveLength(1)
})
it('rejects changed baseline, removed evidence or deleted source',()=>{
 for(const args of [['changed','after',true],['before','after',false],['before',null,true]])
  expect(assessReviewedBoundary(manifest(),readers(...args)).errors.length).toBeGreaterThan(0)
})
it('rejects an exception that targets a different source file',()=>{
 const m=manifest();m.exceptions['src/API/other.ts :: write']='src/API/order.ts'
 expect(assessReviewedBoundary(m,readers()).errors).toContain('src/API/other.ts :: write :: invalid exception target')
})
it('requires new helper files to remain absent in the baseline',()=>{
 const m=manifest();m.paths['src/API/order.ts'].baselineSha256=null
 expect(assessReviewedBoundary(m,readers(null,'after')).errors).toEqual([])
 expect(assessReviewedBoundary(m,readers('upstream helper','after')).errors).toEqual(['src/API/order.ts :: reviewed baseline changed'])
})
