import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import interRegular from '@fontsource/inter/files/inter-latin-500-normal.woff?inline';
import interBold from '@fontsource/inter/files/inter-latin-700-normal.woff?inline';
import { describeLiveShare } from '$lib/domain/live-share';
import { allInMainlandNorway } from '$lib/domain/norway-coverage';

/**
 * OG-forhåndsvisningen (kart + rute + posisjon + ankomsttid) for en delt
 * live-sesjon. Delt mellom /api/live/[token]/og.png (eldre lenker) og
 * /api/share-link/[token]/og.png (nye delelenker).
 *
 * Bakgrunnskartet er Kartverkets topografiske gråtonekart når hele turen ligger i
 * Norge (ferskt, rolig, med stier), ellers Esris lysegrå «Canvas»-kart, som er
 * globalt og like dempet. Se `norway-coverage.ts` for hvorfor valget må gjøres
 * per tur.
 *
 * CARTOs `light_all` sto her fram til oktober 2026. Den svarer nå med en fliser
 * påskrevet «API KEY REQUIRED» — med status 200, så ingenting feilet: bildet
 * bare viste et vannmerke der kartet skulle vært.
 *
 * Teksten står I bildet også, ikke bare i og:title: mange meldingsapper viser
 * bare bildet, og da er ankomsttida det mottakeren ser først.
 */

const IMG_W = 1200;
const IMG_H = 630;
const TILE_SIZE = 256;

const KARTVERKET_TILE = (z: number, x: number, y: number) =>
	`https://cache.kartverket.no/v1/wmts/1.0.0/topograatone/default/webmercator/${z}/${y}/${x}.png`;
const ESRI_GRAY_TILE = (z: number, x: number, y: number) =>
	`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/${z}/${y}/${x}`;

/** Rolige farger — samme som delingssiden (SharedTripPositionView). */
const INK = '#1d2733';
const MUTED = '#5f6b76';
const ACCENT = '#2f5f8f';
const PAPER = '#f4f3ef';

export interface LiveOgSession {
	routeCoordinates: [number, number][] | null;
	lastLat: number | null;
	lastLon: number | null;
	destLat: number | null;
	destLon: number | null;
	destLabel: string | null;
	etaSeconds: number | null;
	lastPingAt: Date | null;
	endedAt: Date | null;
	endedReason: string | null;
}

function worldX(lon: number, z: number) {
	return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
}
function worldY(lat: number, z: number) {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * TILE_SIZE;
}

async function fetchTileDataUri(url: string): Promise<string> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
		if (!res.ok) return '';
		// Esri svarer med JPEG, Kartverket med PNG — en feil type gir en tom flis.
		const type = res.headers.get('content-type')?.split(';')[0] || 'image/png';
		return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
	} catch {
		return '';
	}
}

function dataUriToBuffer(uri: string): Buffer {
	return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
}

const FONTS = [
	{ name: 'Inter', data: dataUriToBuffer(interRegular), weight: 500 as const, style: 'normal' as const },
	{ name: 'Inter', data: dataUriToBuffer(interBold), weight: 700 as const, style: 'normal' as const }
];

type SatoriNode = {
	type: string;
	props: Record<string, unknown>;
};

/** Tekstfeltet nede til venstre: ankomsttida er det største. */
function textPanel(session: LiveOgSession): SatoriNode {
	const summary = describeLiveShare(session);
	const dest = session.destLabel?.trim() || null;

	let kicker: string | null;
	let headline: string;
	let sub: string | null;
	if (summary.state === 'arrived') {
		kicker = null;
		headline = 'Jeg er framme';
		sub = [summary.arrivalClock ? `kl. ${summary.arrivalClock}` : null, dest].filter(Boolean).join(' · ') || null;
	} else if (summary.state === 'ended') {
		kicker = null;
		headline = summary.title;
		sub = dest;
	} else if (summary.arrivalClock) {
		kicker = 'Jeg er på vei';
		headline = `Framme ca. kl. ${summary.arrivalClock}`;
		sub = dest ? `til ${dest}` : null;
	} else {
		kicker = null;
		headline = 'Jeg er på vei';
		sub = dest ? `til ${dest}` : 'Følg turen live';
	}

	const children: SatoriNode[] = [];
	if (kicker) {
		children.push({
			type: 'div',
			props: {
				style: { fontSize: 26, fontWeight: 500, color: MUTED, marginBottom: 6 },
				children: kicker
			}
		});
	}
	children.push({
		type: 'div',
		props: {
			style: { fontSize: 54, fontWeight: 700, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 },
			children: headline
		}
	});
	if (sub) {
		children.push({
			type: 'div',
			props: {
				style: { fontSize: 28, fontWeight: 500, color: MUTED, marginTop: 10 },
				children: sub
			}
		});
	}

	return {
		type: 'div',
		props: {
			style: {
				position: 'absolute',
				left: 40,
				bottom: 40,
				maxWidth: 760,
				display: 'flex',
				flexDirection: 'column',
				padding: '26px 34px 28px',
				background: 'rgba(255,255,255,0.94)',
				borderRadius: 22,
				boxShadow: '0 6px 28px rgba(29,39,51,0.16)'
			},
			children
		}
	};
}

export async function renderLiveSessionOgPng(session: LiveOgSession): Promise<Uint8Array> {
	const routeCoords = session.routeCoordinates && session.routeCoordinates.length >= 2
		? session.routeCoordinates
		: null;

	// Alt som skal synes på kartet: ruta, posisjonen og målet.
	const points: [number, number][] = [...(routeCoords ?? [])];
	if (session.lastLat !== null && session.lastLon !== null) points.push([session.lastLat, session.lastLon]);
	if (session.destLat !== null && session.destLon !== null) points.push([session.destLat, session.destLon]);
	if (points.length === 0) points.push([59.91, 10.75]);

	const useKartverket = allInMainlandNorway(points);
	const tileUrl = useKartverket ? KARTVERKET_TILE : ESRI_GRAY_TILE;
	const attribution = useKartverket ? '© Kartverket' : '© Esri · © OpenStreetMap';

	// Innholdet skal ligge OVER tekstfeltet, ikke bak det.
	const panelReserve = 190;
	const fitW = IMG_W * 0.72;
	const fitH = (IMG_H - panelReserve) * 0.78;

	let zoom = 13;
	if (points.length > 1) {
		zoom = 4;
		for (let z = 16; z >= 4; z--) {
			const xs = points.map(([, lon]) => worldX(lon, z));
			const ys = points.map(([lat]) => worldY(lat, z));
			if (Math.max(...xs) - Math.min(...xs) <= fitW && Math.max(...ys) - Math.min(...ys) <= fitH) {
				zoom = z;
				break;
			}
		}
	}

	const xs = points.map(([, lon]) => worldX(lon, zoom));
	const ys = points.map(([lat]) => worldY(lat, zoom));
	const contentX = (Math.min(...xs) + Math.max(...xs)) / 2;
	const contentY = (Math.min(...ys) + Math.max(...ys)) / 2;
	// Øvre venstre hjørne av bildet i verdenspiksler.
	const originX = contentX - IMG_W / 2;
	const originY = contentY - (IMG_H - panelReserve) / 2 - 10;
	const px = (lat: number, lon: number): [number, number] => [
		worldX(lon, zoom) - originX,
		worldY(lat, zoom) - originY
	];

	const sX = Math.floor(originX / TILE_SIZE);
	const sY = Math.floor(originY / TILE_SIZE);
	const eX = Math.floor((originX + IMG_W) / TILE_SIZE);
	const eY = Math.floor((originY + IMG_H) / TILE_SIZE);
	const tileJobs: Array<{ x: number; y: number }> = [];
	for (let x = sX; x <= eX; x++) for (let y = sY; y <= eY; y++) tileJobs.push({ x, y });

	const tileResults = await Promise.all(
		tileJobs.map(({ x, y }) => fetchTileDataUri(tileUrl(zoom, x, y)).then((uri) => ({ x, y, uri })))
	);

	const tileImages: SatoriNode[] = tileResults
		.filter((t) => t.uri)
		.map((t) => ({
			type: 'img',
			props: {
				src: t.uri,
				width: TILE_SIZE,
				height: TILE_SIZE,
				style: {
					position: 'absolute',
					left: `${t.x * TILE_SIZE - originX}px`,
					top: `${t.y * TILE_SIZE - originY}px`,
					width: `${TILE_SIZE}px`,
					height: `${TILE_SIZE}px`,
					opacity: useKartverket ? 0.72 : 1
				}
			}
		}));

	const svgChildren: SatoriNode[] = [];

	if (routeCoords) {
		const pts = routeCoords.map(([lat, lon]) => px(lat, lon).join(',')).join(' ');
		const line = (stroke: string, width: number) => ({
			type: 'polyline',
			props: {
				points: pts,
				fill: 'none',
				stroke,
				'stroke-width': String(width),
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round'
			}
		});
		svgChildren.push(line('white', 13), line(ACCENT, 7));
	}

	if (session.destLat !== null && session.destLon !== null) {
		const [dx, dy] = px(session.destLat, session.destLon);
		svgChildren.push(
			{ type: 'circle', props: { cx: String(dx), cy: String(dy), r: '15', fill: 'white' } },
			{ type: 'circle', props: { cx: String(dx), cy: String(dy), r: '10', fill: 'white', stroke: INK, 'stroke-width': '5' } }
		);
	}

	if (session.lastLat !== null && session.lastLon !== null) {
		const [ux, uy] = px(session.lastLat, session.lastLon);
		svgChildren.push(
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '30', fill: ACCENT, 'fill-opacity': '0.16' } },
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '17', fill: 'white' } },
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '11', fill: ACCENT } }
		);
	}

	const svgOverlay: SatoriNode = {
		type: 'svg',
		props: {
			xmlns: 'http://www.w3.org/2000/svg',
			width: IMG_W,
			height: IMG_H,
			viewBox: `0 0 ${IMG_W} ${IMG_H}`,
			style: { position: 'absolute', top: 0, left: 0 },
			children: svgChildren
		}
	};

	const credit: SatoriNode = {
		type: 'div',
		props: {
			style: {
				position: 'absolute',
				right: 16,
				bottom: 12,
				fontSize: 15,
				fontWeight: 500,
				color: MUTED
			},
			children: attribution
		}
	};

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: `${IMG_W}px`,
					height: `${IMG_H}px`,
					position: 'relative',
					display: 'flex',
					background: PAPER,
					fontFamily: 'Inter'
				},
				children: [...tileImages, svgOverlay, textPanel(session), credit]
			}
		},
		{ width: IMG_W, height: IMG_H, fonts: FONTS }
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: IMG_W } });
	return new Uint8Array(resvg.render().asPng());
}
