'use strict'
// One canonical build configuration; retained src/config files are forwarding
// compatibility entrypoints, never a second editable webpack configuration.
const fs = require('node:fs'), path = require('node:path')
const retired = [
  'src/lib/react-dev-utils', 'src/lib/react-leaflet-fullscreen-plugin', 'scripts/scripts',
  'src/tsconfig.json', 'scripts/tsconfig.json', 'public/tsconfig.json', 'package_fixed.json',
]
const compatibility = [
  'env.js', 'getHttpsConfig.js', 'modules.js', 'paths.js', 'pnpTs.js',
  'webpack.config.js', 'webpackDevServer.config.js', 'jest/cssTransform.js', 'jest/fileTransform.js',
]
const entries = [
  'src/index.tsx', 'src/config.ts', 'src/lib/ui-utils.ts', 'tsconfig.json',
  'scripts/start.js', 'scripts/build.js', 'scripts/test.js',
  'config/env.js', 'config/paths.js', 'config/webpack.config.js', 'config/webpackDevServer.config.js',
  'lib/react-dev-utils/package.json', 'lib/react-leaflet-fullscreen-plugin/package.json',
]
function checkEntryPoints(root) {
  const failures = []
  for (const name of retired) if (fs.existsSync(path.join(root, name))) failures.push('Retired duplicate exists: ' + name)
  for (const name of entries) if (!fs.existsSync(path.join(root, name))) failures.push('Canonical entrypoint missing: ' + name)
  for (const name of compatibility) {
    const file = path.join(root, 'src/config', name)
    if (!fs.existsSync(file)) { failures.push('Compatibility entrypoint missing: src/config/' + name); continue }
    const source = fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\s/g, '')
    const target = name.startsWith('jest/') ? '../../../config/' : '../../config/'
    const expected = "'usestrict';module.exports=require('" + target + name + "');"
    if (source !== expected) failures.push('Compatibility entrypoint must only forward: src/config/' + name)
  }
  const manifest = path.join(root, 'package.json')
  if (!fs.existsSync(manifest)) failures.push('package.json missing')
  else {
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'))
    for (const name of ['react-dev-utils', 'react-leaflet-fullscreen-plugin']) {
      if (pkg.dependencies?.[name] !== './lib/' + name) failures.push('Vendored package must use canonical lib/: ' + name)
    }
    for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
      if (/scripts\/scripts|src\/config\/|package_fixed/.test(value)) failures.push('Script uses a retired entrypoint: ' + name)
    }
  }
  return { ok: failures.length === 0, canonicalEntries: entries, compatibilityEntryCount: compatibility.length, retiredPaths: retired, failures }
}
function assertEntryPoints(root) {
  const result = checkEntryPoints(root)
  if (!result.ok) throw new Error('Frontend entrypoint check failed:\n' + result.failures.join('\n'))
  return result
}
if (require.main === module) {
  try { console.log(JSON.stringify(assertEntryPoints(path.resolve(__dirname, '..')))) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
module.exports = { checkEntryPoints, assertEntryPoints }
