import { env } from '$env/dynamic/private';

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

/**
 * Hemmeligheten fra en forespørsel: `Authorization: Bearer …` (script v2) eller
 * `?token=` (script v1). Headeren foretrekkes fordi en spørrestreng havner i
 * tilgangslogger — også hos en fremmed vert, som skjedde da v1 postet til et
 * Vercel-navn noen andre hadde overtatt.
 */
export function readEmailWebhookToken(request: Request, url: URL): string | null {
	const header = request.headers.get('authorization');
	const bearer = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
	return bearer || url.searchParams.get('token');
}

export function verifyEmailWebhookToken(token: string | null): boolean {
	const secret = env.EMAIL_WEBHOOK_SECRET;
	if (!secret || !token) return false;
	return timingSafeEqual(token, secret);
}
