import { error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { liveSessions, users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { RequestHandler } from './$types';

let fontCache: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
	if (fontCache) return fontCache;
	const cssRes = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400;700', {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko'
		}
	});
	const css = await cssRes.text();
	const match = css.match(/src:\s*url\(([^)]+)\)\s+format\('woff'\)/);
	if (!match) throw new Error('Could not extract woff font URL');
	const fontRes = await fetch(match[1]);
	if (!fontRes.ok) throw new Error(`Font fetch failed: ${fontRes.status}`);
	fontCache = await fontRes.arrayBuffer();
	return fontCache;
}

const IMG_W = 1200;
const IMG_H = 630;
const MAP_H = 420;
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

function formatEta(secs: number | null): string {
	if (secs === null) return '';
	const min = Math.round(secs / 60);
	if (min < 1) return 'Snart fremme';
	if (min < 60) return `ca. ${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m === 0 ? `ca. ${h} t` : `ca. ${h} t ${m} min`;
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

	const owner = await db.query.users.findFirst({
		where: eq(users.id, session.userId),
		columns: { name: true }
	});

	const name = owner?.name ?? 'Noen';
	const dest = session.destLabel ?? session.routeLabel ?? '';
	const eta = formatEta(session.etaSeconds);
	const distKm =
		session.distanceRemainingM !== null
			? `${(session.distanceRemainingM / 1000).toFixed(1)} km igjen`
			: '';
	const ended = session.endedAt !== null;
	const arrived = session.endedReason === 'arrived';
	const statusLine = ended
		? arrived
			? `${name} er fremme`
			: `${name} er ferdig`
		: `${name} er underveis`;
	const infoLine = [eta, distKm].filter(Boolean).join('  ·  ');

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
			if (tilesX * TILE_SIZE < IMG_W * 0.7 && tilesY * TILE_SIZE < MAP_H * 0.7) {
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
	const nX = Math.ceil(IMG_W / TILE_SIZE) + 1;
	const nY = Math.ceil(MAP_H / TILE_SIZE) + 1;
	const sX = Math.floor(ctX) - Math.floor(nX / 2);
	const sY = Math.floor(ctY) - Math.floor(nY / 2);
	const offX = (ctX - sX) * TILE_SIZE - IMG_W / 2;
	const offY = (ctY - sY) * TILE_SIZE - MAP_H / 2;

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
			.map(([lat, lon]) => ll2px(lat, lon, centerLat, centerLon, zoom, IMG_W, MAP_H))
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
		const [ux, uy] = ll2px(session.lastLat, session.lastLon, centerLat, centerLon, zoom, IMG_W, MAP_H);
		svgChildren.push(
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '9', fill: 'white' } },
			{ type: 'circle', props: { cx: String(ux), cy: String(uy), r: '6', fill: '#4285f4' } }
		);
	}

	if (session.destLat !== null && session.destLon !== null) {
		const [dx, dy] = ll2px(session.destLat, session.destLon, centerLat, centerLon, zoom, IMG_W, MAP_H);
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
			height: MAP_H,
			viewBox: `0 0 ${IMG_W} ${MAP_H}`,
			style: { position: 'absolute', top: 0, left: 0 },
			children: svgChildren
		}
	};

	const font = await loadFont();

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: `${IMG_W}px`,
					height: `${IMG_H}px`,
					display: 'flex',
					flexDirection: 'column',
					fontFamily: 'Inter',
					background: '#1a1a2e'
				},
				children: [
					{
						type: 'div',
						props: {
							style: {
								width: `${IMG_W}px`,
								height: `${MAP_H}px`,
								position: 'relative',
								overflow: 'hidden',
								display: 'flex'
							},
							children: [...tileImages, svgOverlay]
						}
					},
					{
						type: 'div',
						props: {
							style: {
								flex: 1,
								display: 'flex',
								flexDirection: 'column',
								justifyContent: 'center',
								padding: '0 32px',
								background: '#1e293b'
							},
							children: [
								{
									type: 'div',
									props: {
										style: {
											display: 'flex',
											alignItems: 'baseline',
											gap: '16px'
										},
										children: [
											...(dest
												? [
														{
															type: 'span',
															props: {
																style: {
																	fontSize: '36px',
																	fontWeight: 700,
																	color: 'white'
																},
																children: dest
															}
														}
													]
												: []),
											{
												type: 'span',
												props: {
													style: {
														fontSize: '20px',
														color: 'rgba(255,255,255,0.5)'
													},
													children: statusLine
												}
											}
										]
									}
								},
								...(infoLine
									? [
											{
												type: 'div',
												props: {
													style: {
														fontSize: '22px',
														color: 'rgba(255,255,255,0.65)',
														marginTop: '6px'
													},
													children: infoLine
												}
											}
										]
									: [])
							]
						}
					}
				]
			}
		},
		{
			width: IMG_W,
			height: IMG_H,
			fonts: [{ name: 'Inter', data: font, weight: 400, style: 'normal' }]
		}
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
