const { createMapStyle } = require('./rsale-style')
const { isInMoroccoView, moroccoCities, canApplyInitialOverview, MOROCCO_TILE_BOUNDS, moroccoMinimumZoom } = require('./morocco')

describe('RSALE Morocco map adaptation', () => {
  it('does not replace a camera already moved to GPS or a selected address', () => {
    expect(canApplyInitialOverview(true, false)).toBe(true)
    expect(canApplyInitialOverview(true, true)).toBe(false)
    expect(canApplyInitialOverview(false, false)).toBe(false)
  })
  it.each(['en', 'fr', 'ru', 'ar'])('prefers the requested map label language %s', locale => {
    const label = createMapStyle(locale).layers.find(layer => layer.id === 'place-labels')
    expect(label.layout['text-field'][1]).toEqual(['get', `name:${locale}`])
  })
  it('uses the provider but requests tiles only inside the Morocco region', () => {
    const style = createMapStyle('fr')
    expect(style.sources.basemap).toMatchObject({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' })
    expect(style.sources.basemap.bounds).toEqual(MOROCCO_TILE_BOUNDS)
    expect(style.sources.basemap.minzoom).toBe(5)
    expect(style.glyphs).toMatch(/^https:\/\/tiles.openfreemap.org\/fonts\//)
  })
  it('keeps a wide viewport within the region and handles hidden-map sizes safely', () => {
    expect(moroccoMinimumZoom(7.2)).toBe(8)
    expect(moroccoMinimumZoom(3)).toBe(6)
    expect(moroccoMinimumZoom(Infinity)).toBe(6)
    expect(moroccoMinimumZoom(NaN)).toBe(6)
    expect(moroccoMinimumZoom(22)).toBe(19)
  })
  it('accepts every Morocco city preset but rejects old Accra and invalid cached GPS', () => {
    for (const city of moroccoCities) expect(isInMoroccoView([...city.position])).toBe(true)
    expect(isInMoroccoView([5.55602, -0.1969])).toBe(false)
    expect(isInMoroccoView([NaN, -7])).toBe(false)
    expect(isInMoroccoView(null)).toBe(false)
  })
})
