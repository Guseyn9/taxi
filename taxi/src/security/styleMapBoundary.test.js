/** @jest-environment node */
// Exercise the parser actually resolved by css-loader, not a separate mock.
const fs = require('fs')
const os = require('os')
const path = require('path')
const {createRequire} = require('module')
const postcss = createRequire(require.resolve('css-loader'))('postcss')

let directory
const localContent = 'SYNTHETIC_LOCAL_STYLE_CONTENT'
const outsideContent = 'SYNTHETIC_OUTSIDE_STYLE_CONTENT'
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'taxi-style-map-'))
  for (const name of ['styles', 'private']) fs.mkdirSync(path.join(directory, name))
  const map = content => JSON.stringify({version:3,file:'main.css',sources:['input.css'],sourcesContent:[content],names:[],mappings:'AAAA'})
  fs.writeFileSync(path.join(directory, 'styles/main.css.map'), map(localContent))
  fs.writeFileSync(path.join(directory, 'private/canary.map'), map(outsideContent))
})
afterAll(() => fs.rmSync(directory, {recursive:true, force:true}))

async function outputMap(annotation, from) {
  const result = await postcss([]).process('.probe{color:red}\n/*# sourceMappingURL='+annotation+' */', {
    from, to:path.join(directory, 'out.css'), map:{inline:false, annotation:false},
  })
  return JSON.stringify(result.map?.toJSON()) || ''
}
test('legitimate adjacent source maps retain their source content', async() => {
  expect(await outputMap('main.css.map', path.join(directory, 'styles/main.css'))).toContain(localContent)
})
test('CSS annotations cannot read a source map outside their own directory', async() => {
  expect(await outputMap('../private/canary.map', path.join(directory, 'styles/main.css'))).not.toContain(outsideContent)
})
test('missing from does not permit an absolute source-map read', async() => {
  expect(await outputMap(path.join(directory, 'private/canary.map'))).not.toContain(outsideContent)
})
