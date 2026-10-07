import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import interRegular from '@fontsource/inter/files/inter-latin-500-normal.woff?inline';
import { splitRouteAtPosition } from '$lib/domain/live-share';
import { WARM } from '$lib/components/charts/warmMapStyle';
import { renderVectorBasemap } from '$lib/server/vector-basemap';

/**
 * OG-forhåndsvisningen (kart + rute + posisjon + mål) for en delt
 * live-sesjon. Delt mellom /api/live/[token]/og.png (eldre lenker) og
 * /api/share-link/[token]/og.png (nye delelenker).
 *
 * Kartet tegnes av `vector-basemap.ts` fra de samme vektorflisene og i den samme
 * varme paletten som delingssiden, så miniatyren og siden ser like ut.
 *
 * Historikk, så ingen går tilbake: CARTOs `light_all` sto her til oktober 2026 og
 * svarte til slutt med fliser påskrevet «API KEY REQUIRED» — med status 200, så
 * ingenting feilet. Kartverkets gråtonekart tok over én dag, og ble forkastet som
 * grått og kommunalt; det var også blankt utenfor Norge.
 *
 * Bildet er BARE kart: rute, posisjon og mål. Teksten — «Jeg er på vei», ankomsttid,
 * mål — står i og:title/og:description under bildet og i delingsteksten fra Ekko,
 * og tidsstripa bor på delingssiden. Et tekstfelt i bildet ble prøvd og tatt ut:
 * det gjentok det som står rett under, og tok plassen fra kartet.
 */

const IMG_W = 1200;
const IMG_H = 630;
const TILE_SIZE = 256;

export interface LiveOgSession {
	routeCoordinates: [number, number][] | null;
	lastLat: number | null;
	lastLon: number | null;
	destLat: number | null;
	destLon: number | null;
	endedReason: string | null;
}

function worldX(lon: number, z: number) {
	return ((lon + 180) / 360) * Math.pow(2, z) * TILE_SIZE;
}
function worldY(lat: number, z: number) {
	const r = (lat * Math.PI) / 180;
	return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z) * TILE_SIZE;
}

function dataUriToBuffer(uri: string): Buffer {
	return Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64');
}

const FONTS = [
	{ name: 'Inter', data: dataUriToBuffer(interRegular), weight: 500 as const, style: 'normal' as const }
];

type SatoriNode = {
	type: string;
	props: Record<string, unknown>;
};

function polyline(points: string, stroke: string, width: number, opacity = 1): string {
	return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export async function renderLiveSessionOgPng(session: LiveOgSession): Promise<Uint8Array> {
	const routeCoords = session.routeCoordinates && session.routeCoordinates.length >= 2
		? session.routeCoordinates
		: null;
	const pos = session.lastLat !== null && session.lastLon !== null
		? ([session.lastLat, session.lastLon] as [number, number])
		: null;
	const dest = session.destLat !== null && session.destLon !== null
		? ([session.destLat, session.destLon] as [number, number])
		: null;
	const arrived = session.endedReason === 'arrived';

	// Alt som skal synes på kartet: ruta, posisjonen og målet.
	const points: [number, number][] = [...(routeCoords ?? [])];
	if (pos) points.push(pos);
	if (dest) points.push(dest);
	if (points.length === 0) points.push([59.91, 10.75]);

	// Hele bildet er kart; ruta fyller 80 % av flaten og ligger midt i. Zoomen er
	// en brøk, ikke et heltall — hele trinn er doblinger, og et trinn for langt ut
	// ga en rute som fylte en firedel av bildet. Kartet tåler det: tilene skaleres.
	let zoom = 14;
	if (points.length > 1) {
		const spanX = Math.max(...points.map(([, lon]) => worldX(lon, 0))) - Math.min(...points.map(([, lon]) => worldX(lon, 0)));
		const spanY = Math.max(...points.map(([lat]) => worldY(lat, 0))) - Math.min(...points.map(([lat]) => worldY(lat, 0)));
		const fitX = spanX > 0 ? Math.log2((IMG_W * 0.8) / spanX) : 16;
		const fitY = spanY > 0 ? Math.log2((IMG_H * 0.8) / spanY) : 16;
		zoom = Math.max(3, Math.min(16, fitX, fitY));
	}

	const xs = points.map(([, lon]) => worldX(lon, zoom));
	const ys = points.map(([lat]) => worldY(lat, zoom));
	const originX = (Math.min(...xs) + Math.max(...xs)) / 2 - IMG_W / 2;
	const originY = (Math.min(...ys) + Math.max(...ys)) / 2 - IMG_H / 2;
	const toXY = ([lat, lon]: readonly [number, number]): [string, string] => [
		(worldX(lon, zoom) - originX).toFixed(1),
		(worldY(lat, zoom) - originY).toFixed(1)
	];
	const toPts = (pts: ReadonlyArray<readonly [number, number]>) => pts.map((p) => toXY(p).join(',')).join(' ');

	const basemap = await renderVectorBasemap({ zoom, originX, originY, width: IMG_W, height: IMG_H });

	let overlay = '';
	if (routeCoords) {
		overlay += polyline(toPts(routeCoords), WARM.routeCasing, 14);
		if (pos && !arrived) {
			// Tilbakelagt heltrukket, gjenstående dempet — samme som på siden.
			const { done, remaining } = splitRouteAtPosition(routeCoords, pos[0], pos[1]);
			overlay += polyline(toPts(remaining), WARM.route, 7, 0.4);
			overlay += polyline(toPts(done), WARM.route, 7);
		} else {
			overlay += polyline(toPts(routeCoords), WARM.route, 7);
		}
	}
	if (dest) {
		const [dx, dy] = toXY(dest);
		overlay += `<circle cx="${dx}" cy="${dy}" r="16" fill="#fff"/>`;
		overlay += `<circle cx="${dx}" cy="${dy}" r="10" fill="#fff" stroke="${WARM.destination}" stroke-width="6"/>`;
	}
	if (pos && !arrived) {
		const [ux, uy] = toXY(pos);
		overlay += `<circle cx="${ux}" cy="${uy}" r="32" fill="${WARM.route}" fill-opacity="0.18"/>`;
		overlay += `<circle cx="${ux}" cy="${uy}" r="18" fill="#fff"/>`;
		overlay += `<circle cx="${ux}" cy="${uy}" r="12" fill="${WARM.route}"/>`;
	}

	const mapSvg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${IMG_H}" viewBox="0 0 ${IMG_W} ${IMG_H}">` +
		basemap +
		overlay +
		'</svg>';

	const credit: SatoriNode = {
		type: 'div',
		props: {
			style: { position: 'absolute', right: 16, bottom: 12, fontSize: 15, fontWeight: 500, color: WARM.muted },
			children: '© OpenStreetMap · OpenFreeMap'
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
					background: WARM.land,
					fontFamily: 'Inter'
				},
				children: [
					{
						type: 'img',
						props: {
							src: `data:image/svg+xml;base64,${Buffer.from(mapSvg).toString('base64')}`,
							width: IMG_W,
							height: IMG_H,
							style: { position: 'absolute', left: 0, top: 0 }
						}
					},
					credit
				]
			}
		},
		{ width: IMG_W, height: IMG_H, fonts: FONTS }
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: IMG_W } });
	return new Uint8Array(resvg.render().asPng());
}
