import { env } from '$env/dynamic/private';
import { getMarriageInviteByToken } from '$lib/server/relationship';
import type { RequestHandler } from './$types';

function escapeXml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function truncate(value: string, maxLength: number) {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

export const GET: RequestHandler = async ({ params, url }) => {
	const invite = await getMarriageInviteByToken(params.token);
	const inviterName = truncate(invite?.inviterName || 'Noen du kjenner', 36);
	const inviteeEmail = truncate(invite?.inviteeEmail || 'partneren din', 42);
	const appOrigin = env.ORIGIN || url.origin;
	const title = invite
		? `${inviterName} inviterer deg til Resonans`
		: 'Partnerinvitasjon til Resonans';
	const subtitle = invite
		? `Invitert på ${inviteeEmail} for å koble dere sammen i Resonans.`
		: 'Åpne lenken for å se invitasjonen.';

	const svg = `
		<svg width="1200" height="630" viewBox="0 0 1200 630" fill="none" xmlns="http://www.w3.org/2000/svg">
			<defs>
				<linearGradient id="bg" x1="86" y1="54" x2="1082" y2="590" gradientUnits="userSpaceOnUse">
					<stop stop-color="#FFF2D7"/>
					<stop offset="0.48" stop-color="#E6F0E8"/>
					<stop offset="1" stop-color="#D9E7F7"/>
				</linearGradient>
			</defs>
			<rect width="1200" height="630" rx="36" fill="url(#bg)"/>
			<circle cx="1038" cy="112" r="132" fill="#F59E0B" fill-opacity="0.15"/>
			<circle cx="178" cy="528" r="160" fill="#0EA5E9" fill-opacity="0.12"/>
			<rect x="68" y="64" width="1064" height="502" rx="28" fill="white" fill-opacity="0.76"/>
			<text x="112" y="152" fill="#6B7280" font-family="Verdana, sans-serif" font-size="28" letter-spacing="4">PARTNERINVITASJON</text>
			<text x="112" y="262" fill="#0F172A" font-family="Verdana, sans-serif" font-size="62" font-weight="700">${escapeXml(title)}</text>
			<text x="112" y="348" fill="#334155" font-family="Verdana, sans-serif" font-size="34">${escapeXml(subtitle)}</text>
			<text x="112" y="452" fill="#0F172A" font-family="Verdana, sans-serif" font-size="30" font-weight="700">Resonans</text>
			<text x="112" y="492" fill="#475569" font-family="Verdana, sans-serif" font-size="24">Felles oversikt, refleksjon og små nudge i samme app.</text>
			<text x="112" y="542" fill="#64748B" font-family="Verdana, sans-serif" font-size="20">${escapeXml(appOrigin)}</text>
		</svg>
	`;

	return new Response(svg.trim(), {
		headers: {
			'content-type': 'image/svg+xml; charset=utf-8',
			'cache-control': 'public, max-age=300'
		}
	});
};