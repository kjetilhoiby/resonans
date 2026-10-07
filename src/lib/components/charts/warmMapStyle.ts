import type { StyleSpecification } from 'maplibre-gl';

/**
 * Varm, lys kartstil — delingssiden for live posisjon («Jeg er på vei») og
 * forhåndsbildet til samme lenke.
 *
 * Paletten er ÉN kilde for to tegnere: MapLibre i nettleseren (`WARM_MAP_STYLE`)
 * og serverens egen SVG-tegning av de samme vektorflisene
 * (`$lib/server/vector-basemap.ts`). Endrer du en farge her, endres begge.
 *
 * Bakgrunnen: første utgave brukte Kartverkets gråtonekart. Det var ferskt og
 * rolig, men grått og «kommunalt» — et plankart, ikke noe man har lyst til å
 * sende til noen. Her er grunnen papirvarm, skog og park salviegrønne, vann
 * dempet blågrønt, og ruta i aksentfargen fra designspråket «blekk på krem»
 * (`/design/moodboard`): komplementær til vannet, og den eneste mettede fargen
 * på kartet.
 */
export const WARM = {
	land: '#f2ede3',
	residential: '#ece5d8',
	farmland: '#efe9d6',
	wood: '#d6e1c6',
	grass: '#e0e8cf',
	park: '#d2dfc0',
	wetland: '#dce5d4',
	sand: '#eee5cf',
	ice: '#f8f8f6',
	water: '#b6d2d9',
	waterway: '#a5c7d0',
	building: '#e2d7c5',
	buildingOutline: '#d5c8b2',
	roadCasing: '#ddd0bb',
	roadMinor: '#ffffff',
	roadMajor: '#fffaf1',
	motorway: '#f4dcb6',
	motorwayCasing: '#dcbb8a',
	path: '#c3b297',
	rail: '#c2b5a2',
	boundary: '#b9ab96',
	labelTown: '#4a4038',
	labelOther: '#7a6e60',
	labelWater: '#5b8792',
	labelHalo: '#f2ede3',

	/** Markørene — ruta og posisjonen er det eneste mettede på kartet. */
	route: '#ec5a2e',
	routeCasing: '#ffffff',
	destination: '#23443d',
	ink: '#1b1a17',
	muted: '#786c5e',
	line: '#e7dfd1'
} as const;

const NAME = ['coalesce', ['get', 'name:nb'], ['get', 'name:latin'], ['get', 'name']];
const ROUND = { 'line-join': 'round', 'line-cap': 'round' } as const;

function width(...stops: number[]): unknown {
	return ['interpolate', ['exponential', 1.5], ['zoom'], ...stops];
}

export const WARM_MAP_STYLE = {
	version: 8,
	name: 'Resonans Varm',
	glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
	sources: {
		openmaptiles: {
			type: 'vector',
			url: 'https://tiles.openfreemap.org/planet',
			attribution: '© OpenStreetMap · OpenFreeMap'
		}
	},
	layers: [
		{ id: 'background', type: 'background', paint: { 'background-color': WARM.land } },
		{
			id: 'landuse-residential', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
			filter: ['in', 'class', 'residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail'],
			paint: { 'fill-color': WARM.residential }
		},
		{
			id: 'landcover-farmland', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['==', 'class', 'farmland'], paint: { 'fill-color': WARM.farmland }
		},
		{
			id: 'landcover-grass', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['in', 'class', 'grass', 'scrub', 'heath'], paint: { 'fill-color': WARM.grass }
		},
		{
			id: 'landcover-wood', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['==', 'class', 'wood'], paint: { 'fill-color': WARM.wood }
		},
		{
			id: 'landcover-wetland', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['==', 'class', 'wetland'], paint: { 'fill-color': WARM.wetland }
		},
		{
			id: 'landcover-sand', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['in', 'class', 'sand', 'rock'], paint: { 'fill-color': WARM.sand }
		},
		{
			id: 'landcover-ice', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
			filter: ['==', 'class', 'ice'], paint: { 'fill-color': WARM.ice }
		},
		{
			id: 'park', type: 'fill', source: 'openmaptiles', 'source-layer': 'park',
			paint: { 'fill-color': WARM.park }
		},
		{
			id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
			filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': WARM.water }
		},
		{
			id: 'waterway', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway',
			paint: { 'line-color': WARM.waterway, 'line-width': width(10, 0.6, 18, 3) }
		},
		{
			id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
			paint: { 'fill-color': WARM.building, 'fill-outline-color': WARM.buildingOutline }
		},
		{
			id: 'path', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 13,
			filter: ['==', 'class', 'path'],
			layout: ROUND,
			paint: { 'line-color': WARM.path, 'line-width': width(13, 0.6, 18, 1.8), 'line-dasharray': [2, 1.5] }
		},
		{
			id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 10,
			filter: ['==', 'class', 'rail'],
			paint: { 'line-color': WARM.rail, 'line-width': width(10, 0.6, 18, 2) }
		},
		{
			id: 'road-minor-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 13,
			filter: ['in', 'class', 'minor', 'service', 'track'], layout: ROUND,
			paint: { 'line-color': WARM.roadCasing, 'line-width': width(13, 1.4, 18, 10) }
		},
		{
			id: 'road-major-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 8,
			filter: ['in', 'class', 'primary', 'trunk', 'secondary', 'tertiary'], layout: ROUND,
			paint: { 'line-color': WARM.roadCasing, 'line-width': width(8, 1, 18, 16) }
		},
		{
			id: 'road-motorway-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 5,
			filter: ['==', 'class', 'motorway'], layout: ROUND,
			paint: { 'line-color': WARM.motorwayCasing, 'line-width': width(5, 1, 18, 18) }
		},
		{
			id: 'road-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 13,
			filter: ['in', 'class', 'minor', 'service', 'track'], layout: ROUND,
			paint: { 'line-color': WARM.roadMinor, 'line-width': width(13, 0.8, 18, 8) }
		},
		{
			id: 'road-major', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 8,
			filter: ['in', 'class', 'primary', 'trunk', 'secondary', 'tertiary'], layout: ROUND,
			paint: { 'line-color': WARM.roadMajor, 'line-width': width(8, 0.6, 18, 13) }
		},
		{
			id: 'road-motorway', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 5,
			filter: ['==', 'class', 'motorway'], layout: ROUND,
			paint: { 'line-color': WARM.motorway, 'line-width': width(5, 0.6, 18, 15) }
		},
		{
			id: 'boundary-country', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
			filter: ['<=', 'admin_level', 2],
			paint: { 'line-color': WARM.boundary, 'line-width': 1.2, 'line-dasharray': [3, 2] }
		},
		{
			id: 'water-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'water_name',
			layout: { 'text-field': NAME, 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
			paint: { 'text-color': WARM.labelWater, 'text-halo-color': WARM.labelHalo, 'text-halo-width': 1.2 }
		},
		{
			id: 'road-label', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 14,
			layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'symbol-placement': 'line' },
			paint: { 'text-color': WARM.labelOther, 'text-halo-color': WARM.labelHalo, 'text-halo-width': 1.4 }
		},
		{
			id: 'place-label-other', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
			filter: ['in', 'class', 'village', 'suburb', 'neighbourhood', 'hamlet'],
			layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
			paint: { 'text-color': WARM.labelOther, 'text-halo-color': WARM.labelHalo, 'text-halo-width': 1.4 }
		},
		{
			id: 'place-label-town', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
			filter: ['in', 'class', 'town', 'city'],
			layout: {
				'text-field': NAME,
				'text-font': ['Noto Sans Bold'],
				'text-size': ['interpolate', ['linear'], ['zoom'], 6, 12, 12, 17]
			},
			paint: { 'text-color': WARM.labelTown, 'text-halo-color': WARM.labelHalo, 'text-halo-width': 1.6 }
		}
	]
} as StyleSpecification;
