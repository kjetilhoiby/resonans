import { VectorTile, type VectorTileFeature } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { WARM } from '$lib/components/charts/warmMapStyle';

/**
 * Tegner OpenFreeMaps vektorfliser som SVG på serveren, i den varme paletten fra
 * `warmMapStyle.ts` — så forhåndsbildet (`live-og.ts`) og delingssiden har SAMME
 * kart, uten en nettleser og uten en tredje kartleverandør.
 *
 * Bevisst enkelt: flater, vann, veier og stier. Ingen tekst — bildet har sitt
 * eget tekstfelt, og etiketter i et forhåndsbilde på 1200 px blir uansett
 * smuler i en meldingstråd.
 *
 * Koordinater: kalleren regner i en «verden» på 256 px per flis ved zoom `z`
 * (samme som satori-bildet alltid har gjort). MapLibre — og flisene — regner i
 * 512 px, så stilens zoom er `z - 1`, og det er den bredder og minzoom leses mot.
 */

const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const MAX_TILE_ZOOM = 14;
const TILEJSON_TTL_MS = 30 * 60_000;

let tileTemplate: { url: string; fetchedAt: number } | null = null;

/** OpenFreeMap roterer datert utgave i URL-en; TileJSON sier hvilken som gjelder. */
async function currentTileTemplate(): Promise<string | null> {
	if (tileTemplate && Date.now() - tileTemplate.fetchedAt < TILEJSON_TTL_MS) return tileTemplate.url;
	try {
		const res = await fetch(TILEJSON_URL, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return tileTemplate?.url ?? null;
		const json = (await res.json()) as { tiles?: string[] };
		const url = json.tiles?.[0];
		if (!url) return tileTemplate?.url ?? null;
		tileTemplate = { url, fetchedAt: Date.now() };
		return url;
	} catch {
		return tileTemplate?.url ?? null;
	}
}

/**
 * Dekodede fliser, nøklet på URL (som bærer OpenFreeMaps daterte utgave, så en
 * ny utgave er nye nøkler). Samme strøk tegnes igjen og igjen — hjem, jobb,
 * banen — og flisehentingen var mesteparten av tida bildet tok. Taket er fast:
 * en flis er ~50–150 kB, og containeren har vært OOM-drept før.
 */
const TILE_CACHE_MAX = 120;
const tileCache = new Map<string, VectorTile>();

async function fetchTile(template: string, z: number, x: number, y: number): Promise<VectorTile | null> {
	const n = 2 ** z;
	if (y < 0 || y >= n) return null;
	const wx = ((x % n) + n) % n;
	const url = template.replace('{z}', String(z)).replace('{x}', String(wx)).replace('{y}', String(y));
	const cached = tileCache.get(url);
	if (cached) {
		tileCache.delete(url);
		tileCache.set(url, cached);
		return cached;
	}
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		const tile = new VectorTile(new PbfReader(new Uint8Array(await res.arrayBuffer())));
		tileCache.set(url, tile);
		while (tileCache.size > TILE_CACHE_MAX) {
			const oldest = tileCache.keys().next().value;
			if (oldest === undefined) break;
			tileCache.delete(oldest);
		}
		return tile;
	} catch {
		return null;
	}
}

/** MapLibres `['interpolate', ['exponential', 1.5], ['zoom'], z0, w0, z1, w1]`. */
export function lineWidthAt(styleZoom: number, z0: number, w0: number, z1: number, w1: number): number {
	if (styleZoom <= z0) return w0;
	if (styleZoom >= z1) return w1;
	const base = 1.5;
	const t = (base ** (styleZoom - z0) - 1) / (base ** (z1 - z0) - 1);
	return w0 + (w1 - w0) * t;
}

type Bucket =
	| { kind: 'fill'; color: string; opacity?: number; stroke?: string }
	| { kind: 'line'; color: string; width: number; dash?: string };

/** Tegnerekkefølgen — samme som lagene i `WARM_MAP_STYLE`. */
function buckets(styleZoom: number): Record<string, Bucket> {
	const w = (z0: number, w0: number, z1: number, w1: number) => lineWidthAt(styleZoom, z0, w0, z1, w1);
	return {
		residential: { kind: 'fill', color: WARM.residential },
		farmland: { kind: 'fill', color: WARM.farmland },
		grass: { kind: 'fill', color: WARM.grass },
		wood: { kind: 'fill', color: WARM.wood },
		wetland: { kind: 'fill', color: WARM.wetland },
		sand: { kind: 'fill', color: WARM.sand },
		ice: { kind: 'fill', color: WARM.ice },
		park: { kind: 'fill', color: WARM.park },
		water: { kind: 'fill', color: WARM.water },
		waterway: { kind: 'line', color: WARM.waterway, width: w(10, 0.6, 18, 3) },
		building: { kind: 'fill', color: WARM.building, stroke: WARM.buildingOutline },
		path: { kind: 'line', color: WARM.path, width: w(13, 0.6, 18, 1.8), dash: '3 2.5' },
		rail: { kind: 'line', color: WARM.rail, width: w(10, 0.6, 18, 2) },
		minorCasing: { kind: 'line', color: WARM.roadCasing, width: w(13, 1.4, 18, 10) },
		majorCasing: { kind: 'line', color: WARM.roadCasing, width: w(8, 1, 18, 16) },
		motorwayCasing: { kind: 'line', color: WARM.motorwayCasing, width: w(5, 1, 18, 18) },
		minor: { kind: 'line', color: WARM.roadMinor, width: w(13, 0.8, 18, 8) },
		major: { kind: 'line', color: WARM.roadMajor, width: w(8, 0.6, 18, 13) },
		motorway: { kind: 'line', color: WARM.motorway, width: w(5, 0.6, 18, 15) }
	};
}

/** Hvilke bøtter en feature havner i (en vei gir både kant og fyll). */
export function classifyFeature(layer: string, cls: unknown, styleZoom: number): string[] {
	const c = typeof cls === 'string' ? cls : '';
	switch (layer) {
		case 'landuse':
			return ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail'].includes(c)
				? ['residential']
				: [];
		case 'landcover':
			if (c === 'farmland') return ['farmland'];
			if (c === 'grass' || c === 'scrub' || c === 'heath') return ['grass'];
			if (c === 'wood') return ['wood'];
			if (c === 'wetland') return ['wetland'];
			if (c === 'sand' || c === 'rock') return ['sand'];
			if (c === 'ice') return ['ice'];
			return [];
		case 'park':
			return ['park'];
		case 'water':
			return ['water'];
		case 'waterway':
			return ['waterway'];
		case 'building':
			return styleZoom >= 14 ? ['building'] : [];
		case 'transportation':
			if (c === 'motorway') return styleZoom >= 5 ? ['motorwayCasing', 'motorway'] : [];
			if (['primary', 'trunk', 'secondary', 'tertiary'].includes(c)) {
				return styleZoom >= 8 ? ['majorCasing', 'major'] : [];
			}
			if (['minor', 'service', 'track'].includes(c)) return styleZoom >= 13 ? ['minorCasing', 'minor'] : [];
			if (c === 'path') return styleZoom >= 13 ? ['path'] : [];
			if (c === 'rail') return styleZoom >= 10 ? ['rail'] : [];
			return [];
		default:
			return [];
	}
}

const LAYERS = ['landuse', 'landcover', 'park', 'water', 'waterway', 'building', 'transportation'];

export interface BasemapView {
	/** Zoom i 256-px-verdenen. */
	zoom: number;
	/** Bildets øvre venstre hjørne i verdenspiksler. */
	originX: number;
	originY: number;
	width: number;
	height: number;
}

/**
 * SVG-innhold (uten `<svg>`-rot) for kartet i visningen. Bakgrunnen er alltid
 * med; feiler flisene, står papirfargen igjen — et rolig kart uten innhold,
 * ikke et vannmerke.
 */
export async function renderVectorBasemap(view: BasemapView): Promise<string> {
	const styleZoom = view.zoom - 1;
	const tz = Math.max(0, Math.min(MAX_TILE_ZOOM, Math.floor(styleZoom)));
	// Én flis ved tz dekker så mange verdenspiksler ved view.zoom:
	const tileWorld = 256 * 2 ** (view.zoom - tz);

	const background = `<rect x="0" y="0" width="${view.width}" height="${view.height}" fill="${WARM.land}"/>`;
	const template = await currentTileTemplate();
	if (!template) return background;

	const x0 = Math.floor(view.originX / tileWorld);
	const y0 = Math.floor(view.originY / tileWorld);
	const x1 = Math.floor((view.originX + view.width) / tileWorld);
	const y1 = Math.floor((view.originY + view.height) / tileWorld);

	const jobs: Array<Promise<{ x: number; y: number; tile: VectorTile | null }>> = [];
	for (let x = x0; x <= x1; x++) {
		for (let y = y0; y <= y1; y++) {
			jobs.push(fetchTile(template, tz, x, y).then((tile) => ({ x, y, tile })));
		}
	}
	const tiles = await Promise.all(jobs);

	const spec = buckets(styleZoom);
	const paths: Record<string, string[]> = {};
	const r = (v: number) => Math.round(v * 10) / 10;

	for (const { x, y, tile } of tiles) {
		if (!tile) continue;
		for (const layerName of LAYERS) {
			const layer = tile.layers[layerName];
			if (!layer) continue;
			const k = tileWorld / layer.extent;
			const ox = x * tileWorld - view.originX;
			const oy = y * tileWorld - view.originY;
			for (let i = 0; i < layer.length; i++) {
				const feature: VectorTileFeature = layer.feature(i);
				const targets = classifyFeature(layerName, feature.properties.class, styleZoom);
				if (targets.length === 0) continue;
				const isPolygon = feature.type === 3;
				if (feature.type === 1) continue;
				let d = '';
				for (const ring of feature.loadGeometry()) {
					if (ring.length < 2) continue;
					d += `M${r(ox + ring[0].x * k)} ${r(oy + ring[0].y * k)}`;
					for (let j = 1; j < ring.length; j++) d += `L${r(ox + ring[j].x * k)} ${r(oy + ring[j].y * k)}`;
					if (isPolygon) d += 'Z';
				}
				if (!d) continue;
				for (const t of targets) {
					// Fyll hører til flater, linjer til linjer — en vannflate er ikke en elv.
					if ((spec[t].kind === 'fill') !== isPolygon) continue;
					(paths[t] ??= []).push(d);
				}
			}
		}
	}

	let out = background;
	for (const [key, b] of Object.entries(spec)) {
		const d = paths[key];
		if (!d || d.length === 0) continue;
		if (b.kind === 'fill') {
			out += `<path d="${d.join('')}" fill="${b.color}"${b.opacity ? ` fill-opacity="${b.opacity}"` : ''}${
				b.stroke ? ` stroke="${b.stroke}" stroke-width="0.6"` : ''
			}/>`;
		} else {
			out += `<path d="${d.join('')}" fill="none" stroke="${b.color}" stroke-width="${r(b.width)}" stroke-linecap="round" stroke-linejoin="round"${
				b.dash ? ` stroke-dasharray="${b.dash}"` : ''
			}/>`;
		}
	}
	return out;
}
