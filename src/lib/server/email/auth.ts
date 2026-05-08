import { env } from '$env/dynamic/private';

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return mismatch === 0;
}

export function verifyEmailWebhookToken(token: string | null): boolean {
	const secret = env.EMAIL_WEBHOOK_SECRET;
	if (!secret || !token) return false;
	return timingSafeEqual(token, secret);
}
