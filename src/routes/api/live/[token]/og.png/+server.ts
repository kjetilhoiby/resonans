import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { RequestHandler } from './$types';

const IMG_W = 1200;
const IMG_H = 630;
const TILE_SIZE = 256;

function lon2tile(lon: number, z: number) {
	return ((lon + 180) / 360) * Math.pow(2, z);
}
function lat2tile(lat: number, z: number) {
	return (
		((1 -
			Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) /
				Math.PI) /
			2) *
		Math.pow(2, z)
	);
}
function ll2px(
	lat: number,
	lon: number,
	cLat: number,
	cLon: number,
	z: number,
	w: number,
	h: number
): [number, number] {
	const cx = lon2tile(cLon, z) * TILE_SIZE;
	const cy = lat2tile(cLat, z) * TILE_SIZE;
	return [lon2tile(lon, z) * TILE_SIZE - cx + w / 2, lat2tile(lat, z) * TILE_SIZE - cy + h / 2];
}

async function fetchTileDataUri(x: number, y: number, z: number): Promise<string> {
	try {
		const res = await fetch(`https://basemaps.cartocdn.com/light_all/${z}/${x}/${y}@2x.png`);
		if (!res.ok) return '';
		return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
	} catch {
		return '';
	}
}

type SatoriNode = {
	type: string;
	props: Record<string, unknown>;
};

export const GET: RequestHandler = async ({ params }) => {
	const session = await db.query.liveSessions.findFirst({
		where: eq(liveSessions.token, params.token)
	});
	if (!session) throw error(404);

	const routeCoords = session.routeCoordinates as [number, number][] | null;
	const hasRoute = routeCoords && routeCoords.length >= 2;

	let centerLat: number;
	let centerLon: number;
	let zoom = 13;

	if (hasRoute) {
		let minLat = Infinity,
			maxLat = -Infinity,
			minLon = Infinity,
			maxLon = -Infinity;
		for (const [lat, lon] of routeCoords) {
			if (lat < minLat) minLat = lat;
			if (lat > maxLat) maxLat = lat;
			if (lon < minLon) minLon = lon;
			if (lon > maxLon) maxLon = lon;
		}
		centerLat = (minLat + maxLat) / 2;
		centerLon = (minLon + maxLon) / 2;
		const latSpan = maxLat - minLat;
		const lonSpan = maxLon - minLon;
		for (let z = 16; z >= 4; z--) {
			const tilesX = lonSpan / (360 / Math.pow(2, z));
			const tilesY = latSpan / (180 / Math.pow(2, z));
			if (tilesX * TILE_SIZE < IMG_W * 0.7 && tilesY * TILE_SIZE < IMG_H * 0.7) {
				zoom = z;
				break;
			}
		}
	} else if (session.lastLat !== null && session.lastLon !== null) {
		centerLat = session.lastLat;
		centerLon = session.lastLon;
	} else {
		centerLat = session.destLat ?? 59.91;
		centerLon = session.destLon ?? 10.75;
	}

	// Fetch map tiles
	const ctX = lon2tile(centerLon, zoom);
	const ctY = lat2tile(centerLat, zoom);
	const nX = Math.ceil(IMG_W / TILE_SIZE) + 2;
	const nY = Math.ceil(IMG_H / TILE_SIZE) + 2;
	const sX = Math.floor(ctX) - Math.floor(nX / 2);
	const sY = Math.floor(ctY) - Math.floor(nY / 2);
	const offX = (ctX - sX) * TILE_SIZE - IMG_W / 2;
	const offY = (ctY - sY) * TILE_SIZE - IMG_H / 2;

	const tileResults = await Promise.all(
		Array.from({ length: nX * nY }, (_, i) => {
			const dx = i % nX;
			const dy = Math.floor(i / nX);
			const tx = sX + dx;
			const ty = sY + dy;
			return fetchTileDataUri(tx, ty, zoom).then((uri) => ({ x: tx, y: ty, uri }));
		})
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
					left: `${(t.x - sX) * TILE_SIZE - offX}px`,
					top: `${(t.y - sY) * TILE_SIZE - offY}px`,
					width: `${TILE_SIZE}px`,
					height: `${TILE_SIZE}px`
				}
			}
		}));

	// SVG overlay: route + dots
	const svgChildren: SatoriNode[] = [];

	if (hasRoute) {
		const pts = routeCoords
			.map(([lat, lon]) => ll2px(lat, lon, centerLat, centerLon, zoom, IMG_W, IMG_H))
			.map((p) => `${p[0]},${p[1]}`)
			.join(' ');
		svgChildren.push({
			type: 'polyline',
			props: {
				points: pts,
				fill: 'none',
				stroke: '#4285f4',
				'stroke-width': '4',
				'stroke-linecap': 'round',
				'stroke-linejoin': 'round'
			}
		});
	}

	if (session.lastLat !== null && session.lastLon !== null) {
		const [ux, uy] = ll2px(session.lastLat, session.lastLon, centerLat, centerLon, zoom, IMG_W, IMG_H);
		svgChildren.push(
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '9', fill: 'white' } },
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '6', fill: '#4285f4' } }
		);
	}

	if (session.destLat !== null && session.destLon !== null) {
		const [dx, dy] = ll2px(session.destLat, session.destLon, centerLat, centerLon, zoom, IMG_W, IMG_H);
		svgChildren.push(
			{ type: 'circle', props: { cx: String(dx), cy: String(dy), r: '8', fill: 'white' } },
			{ type: 'circle', props: { cx: String(dx), cy: String(dy), r: '5', fill: '#ef4444' } }
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

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: `${IMG_W}px`,
					height: `${IMG_H}px`,
					position: 'relative',
					display: 'flex',
					background: '#e8e8e8'
				},
				children: [...tileImages, svgOverlay]
			}
		},
		{ width: IMG_W, height: IMG_H, fonts: [] }
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: IMG_W } });
	const png = new Uint8Array(resvg.render().asPng());

	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=30, s-maxage=30'
		}
	});
};
