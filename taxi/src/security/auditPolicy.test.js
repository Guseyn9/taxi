import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'

const app=path.resolve(__dirname,'../..')
test('both live workflows share the same non-cancelling lock',()=>{
 const root=path.join(app,'../.github/workflows')
 const workflows=['e2e.yml','trip-finish-isolated.yml'].map(name=>yaml.safeLoad(fs.readFileSync(path.join(root,name),'utf8')))
 expect(workflows[0].concurrency.group).toBe(workflows[1].concurrency.group)
 expect(workflows.every(w=>w.concurrency['cancel-in-progress']===false)).toBe(true)
 expect(workflows.every(w=>w.concurrency.queue==='max')).toBe(true)
})
test('authenticated E2E network traces and auth state are excluded from artifacts',()=>{
 const config=fs.readFileSync(path.join(app,'playwright.config.ts'),'utf8')
 expect(config).not.toMatch(/trace:\s*'retain-on-failure'/)
 expect(config).not.toMatch(/trace:\s*'on'/)
 const workflow=fs.readFileSync(path.join(app,'../.github/workflows/e2e.yml'),'utf8')
 expect(workflow).not.toMatch(/taxi\/e2e\/\.auth/)
 expect(workflow).not.toMatch(/taxi\/\*\*/)
 expect(workflow).not.toMatch(/^\s+taxi\/e2e-results\/\s*$/m)
 expect(workflow).toContain('taxi/e2e-results/results.json')
 expect(workflow).toContain("steps.privacy.outcome == 'success'")
 expect(config).not.toContain("['list']")
})
