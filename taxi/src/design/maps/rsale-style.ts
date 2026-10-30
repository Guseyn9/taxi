import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import { MOROCCO_TILE_BOUNDS } from './morocco';

export const MAP_ATTRIBUTION = '<a href="https://openfreemap.org/">OpenFreeMap</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://openmaptiles.org/">OpenMapTiles</a>';

/** Display tiles are limited to the Morocco region. Routing is independent. */
export function createMapStyle(locale = 'fr'): StyleSpecification {
	const name: ExpressionSpecification = ['coalesce', ['get', `name:${locale}`], ['get', 'name:latin'], ['get', 'name']];
	return {
		version: 8,
		name: 'Drive Morocco',
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {
			basemap: {
				type: 'vector', url: 'https://tiles.openfreemap.org/planet',
				bounds: [...MOROCCO_TILE_BOUNDS],
				minzoom: 5, maxzoom: 14, attribution: MAP_ATTRIBUTION
			}
		},
		layers: [
			{ id: 'background', type: 'background', paint: { 'background-color': '#faf9f7' } },
			{ id: 'landcover', type: 'fill', source: 'basemap', 'source-layer': 'landcover', paint: { 'fill-color': '#eeece9', 'fill-opacity': 0.7 } },
			{ id: 'landuse', type: 'fill', source: 'basemap', 'source-layer': 'landuse', paint: { 'fill-color': '#f1efec' } },
			{ id: 'parks', type: 'fill', source: 'basemap', 'source-layer': 'park', paint: { 'fill-color': '#e7ebe3' } },
			{ id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': '#dce7e9' } },
			{ id: 'waterways', type: 'line', source: 'basemap', 'source-layer': 'waterway', paint: { 'line-color': '#dce7e9', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 16, 3] } },
			{ id: 'boundaries', type: 'line', source: 'basemap', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 6], paint: { 'line-color': '#b9b4ae', 'line-width': 1, 'line-dasharray': [3, 3] } },
			{ id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#e5e1dc', 'fill-outline-color': '#d7d1ca' } },
			{ id: 'road-casing', type: 'line', source: 'basemap', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'class'], 'rail'], ['!=', ['get', 'class'], 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e1dbd4', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 3, 16, 9, 19, 24] } },
			{ id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'transportation', filter: ['all', ['!=', ['get', 'class'], 'rail'], ['!=', ['get', 'class'], 'ferry']], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk', 'primary'], '#ffe2c8', '#ffffff'], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.5, 16, 6, 19, 20] } },
			{ id: 'rail', type: 'line', source: 'basemap', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#bfbcb7', 'line-width': 1, 'line-dasharray': [3, 3] } },
			{ id: 'street-labels', type: 'symbol', source: 'basemap', 'source-layer': 'transportation_name', minzoom: 13, filter: ['!=', ['get', 'class'], 'ferry'], layout: { 'symbol-placement': 'line', 'text-field': [...name], 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#787878', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
			{ id: 'place-labels', type: 'symbol', source: 'basemap', 'source-layer': 'place', layout: { 'text-field': [...name], 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 16], 'text-max-width': 9 }, paint: { 'text-color': '#555555', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } }
		]
	};
}
