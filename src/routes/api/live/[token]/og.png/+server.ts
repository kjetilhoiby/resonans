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
	const res = await fetch(
		'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hjQ.woff'
	);
	fontCache = await res.arrayBuffer();
	return fontCache;
}

function formatEta(secs: number | null): string {
	if (secs === null) return '';
	const min = Math.round(secs / 60);
	if (min < 1) return 'Snart fremme';
	if (min < 60) return `Ankomst om ca. ${min} min`;
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m === 0 ? `Ankomst om ca. ${h} t` : `Ankomst om ca. ${h} t ${m} min`;
}

function formatDistance(meters: number | null): string {
	if (meters === null) return '';
	return `${(meters / 1000).toFixed(1)} km igjen`;
}

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
	const dist = formatDistance(session.distanceRemainingM);
	const ended = session.endedAt !== null;
	const arrived = session.endedReason === 'arrived';

	const font = await loadFont();

	const svg = await satori(
		{
			type: 'div',
			props: {
				style: {
					width: '1200px',
					height: '630px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'flex-end',
					padding: '48px',
					background: 'linear-gradient(135deg, #1e3a5f 0%, #0f1f33 100%)',
					fontFamily: 'Inter'
				},
				children: [
					{
						type: 'div',
						props: {
							style: {
								position: 'absolute',
								top: '48px',
								left: '48px',
								fontSize: '20px',
								color: 'rgba(255,255,255,0.4)',
								fontWeight: 500
							},
							children: 'Ekko · Live posisjon'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								position: 'absolute',
								top: '40px',
								right: '48px',
								fontSize: '64px'
							},
							children: ended ? (arrived ? '✅' : '🏁') : '📍'
						}
					},
					{
						type: 'div',
						props: {
							style: {
								fontSize: '28px',
								color: 'rgba(255,255,255,0.6)',
								marginBottom: '8px'
							},
							children: ended
								? arrived
									? `${name} er fremme`
									: `${name} er ferdig`
								: `${name} er underveis`
						}
					},
					...(dest
						? [
								{
									type: 'div',
									props: {
										style: {
											fontSize: '52px',
											fontWeight: 700,
											color: 'white',
											marginBottom: '16px'
										},
										children: `→ ${dest}`
									}
								}
							]
						: []),
					...(!ended && (eta || dist)
						? [
								{
									type: 'div',
									props: {
										style: {
											display: 'flex',
											gap: '32px',
											fontSize: '24px',
											color: 'rgba(255,255,255,0.7)'
										},
										children: [eta, dist].filter(Boolean).map((t) => ({
											type: 'span',
											props: { children: t }
										}))
									}
								}
							]
						: [])
				]
			}
		},
		{
			width: 1200,
			height: 630,
			fonts: [{ name: 'Inter', data: font, weight: 400, style: 'normal' }]
		}
	);

	const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
	const png = new Uint8Array(resvg.render().asPng());

	return new Response(png, {
		headers: {
			'Content-Type': 'image/png',
			'Cache-Control': 'public, max-age=30, s-maxage=30'
		}
	});
};
