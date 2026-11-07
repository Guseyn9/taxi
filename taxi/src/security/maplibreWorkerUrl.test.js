const adapt = require('../../tools/maplibre-worker-url-loader.cjs')

test('keeps static module assets while resolving runtime workers against this origin', () => {
  expect(adapt("new URL(url, import.meta.url);new URL('./worker.mjs', import.meta.url)"))
    .toBe("new URL(url,globalThis.location.href);new URL('./worker.mjs', import.meta.url)")
  const base = 'https://taxi.example.invalid/driver-order'
  expect(new URL('/maps/maplibre-gl-worker.mjs', base).href).toBe('https://taxi.example.invalid/maps/maplibre-gl-worker.mjs')
})
