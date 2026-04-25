import { createHmac, timingSafeEqual } from 'crypto';

export const PREVIEW_AUTH_COOKIE = 'resonans_preview_auth';

// TODO: replace with env.PREVIEW_BYPASS_PASSWORD
export const PREVIEW_BYPASS_PASSWORD = '1234';

const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

export function isPreviewEnv(): boolean {
	return process.env.VERCEL_ENV === 'preview';
}

export function signPreviewToken(userId: string, secret: string): string {
	const expires = Date.now() + MAX_AGE_MS;
	const payload = `${userId}:${expires}`;
	const mac = createHmac('sha256', secret).update(payload).digest('hex');
	return `${Buffer.from(payload).toString('base64url')}.${mac}`;
}

export function verifyPreviewToken(token: string, secret: string): string | null {
	const dot = token.indexOf('.');
	if (dot === -1) return null;

	const payloadB64 = token.slice(0, dot);
	const mac = token.slice(dot + 1);

	let payload: string;
	try {
		payload = Buffer.from(payloadB64, 'base64url').toString();
	} catch {
		return null;
	}

	const expected = createHmac('sha256', secret).update(payload).digest('hex');

	try {
		const macBuf = Buffer.from(mac, 'hex');
		const expBuf = Buffer.from(expected, 'hex');
		if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) return null;
	} catch {
		return null;
	}

	const colon = payload.indexOf(':');
	if (colon === -1) return null;
	const userId = payload.slice(0, colon);
	const expiresStr = payload.slice(colon + 1);
	if (!userId || !expiresStr) return null;
	if (Date.now() > parseInt(expiresStr, 10)) return null;

	return userId;
}
