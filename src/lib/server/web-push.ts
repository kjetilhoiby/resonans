import webpush from 'web-push';
import { env } from '$env/dynamic/private';
import { createPrivateKey, createPublicKey } from 'node:crypto';

let configured = false;
const DEFAULT_PUSH_TIMEOUT_MS = 10000;

function getPushTimeoutMs(): number {
	const fromEnv = Number(env.WEB_PUSH_TIMEOUT_MS);
	if (Number.isFinite(fromEnv) && fromEnv >= 1000) return Math.floor(fromEnv);
	return DEFAULT_PUSH_TIMEOUT_MS;
}

export function getMissingWebPushEnvVars(): string[] {
	const missing: string[] = [];
	if (!env.VAPID_PUBLIC_KEY) missing.push('VAPID_PUBLIC_KEY');
	if (!env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');
	return missing;
}

function ensureConfigured() {
	if (configured) return;
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	const subject = env.VAPID_SUBJECT || 'mailto:hello@resonans.app';
	if (!publicKey || !privateKey) return;
	webpush.setVapidDetails(subject, publicKey, privateKey);
	configured = true;
}

export function isWebPushConfigured(): boolean {
	ensureConfigured();
	return configured;
}

export function getWebPushPublicKey(): string | null {
	return env.VAPID_PUBLIC_KEY || null;
}

/**
 * Derives the VAPID public key from the private key using EC P-256 math and
 * compares it against the configured VAPID_PUBLIC_KEY.
 * Returns { match: true } when the pair is consistent.
 * Returns { match: false } when they don't match — this is the root cause of BadJwtToken.
 * Returns { match: null, error } when keys are missing or malformed.
 */
export function checkVapidKeyPairMatch(): { match: boolean | null; error?: string } {
	const publicKey = env.VAPID_PUBLIC_KEY;
	const privateKey = env.VAPID_PRIVATE_KEY;
	if (!publicKey || !privateKey) return { match: null, error: 'One or both keys not set' };
	try {
		const privBytes = Buffer.from(privateKey, 'base64url');
		if (privBytes.length !== 32) {
			return { match: false, error: `Private key is ${privBytes.length} bytes, expected 32` };
		}
		// SEC1 DER encoding for raw 32-byte P-256 private key (without embedded public key)
		const der = Buffer.concat([
			Buffer.from('3031020101' + '0420', 'hex'),
			privBytes,
			Buffer.from('a00a06082a8648ce3d030107', 'hex')
		]);
		const priv = createPrivateKey({ key: der, format: 'der', type: 'sec1' });
		const pub = createPublicKey(priv);
		const jwk = pub.export({ format: 'jwk' }) as { x: string; y: string };
		const x = Buffer.from(jwk.x, 'base64url');
		const y = Buffer.from(jwk.y, 'base64url');
		const derivedPublicKey = Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64url');
		return { match: derivedPublicKey === publicKey };
	} catch (e) {
		return { match: null, error: e instanceof Error ? e.message : 'Unknown error' };
	}
}

// Known Apple push error reasons that mean the subscription is permanently unusable
const APPLE_GONE_REASONS = new Set([
	'BadJwtToken',
	'ExpiredJwtToken',
	'InvalidProviderToken',
	'MissingProviderToken',
	'ExpiredProviderToken',
	'BadDeviceToken',
	'Unregistered'
]);

/**
 * Returns true when a failed push result means the subscription should be
 * permanently removed (regardless of HTTP status code).
 */
export function isSubscriptionGone(result: {
	ok: boolean;
	statusCode?: number;
	errorBody?: string;
	endpointHost?: string;
}): boolean {
	if (result.ok) return false;
	const { statusCode, errorBody, endpointHost } = result;
	// Standard gone codes
	if (statusCode === 410 || statusCode === 404) return true;
	// Apple-specific: 403 with a known terminal reason
	if (statusCode === 403 && endpointHost?.includes('web.push.apple.com')) {
		try {
			const parsed = JSON.parse(errorBody ?? '{}') as { reason?: string };
			if (parsed.reason && APPLE_GONE_REASONS.has(parsed.reason)) return true;
		} catch {
			// unable to parse — fall through
		}
	}
	return false;
}

export async function sendWebPush(
	subscription: webpush.PushSubscription,
	payload: Record<string, unknown>
): Promise<{
	ok: boolean;
	statusCode?: number;
	error?: string;
	errorBody?: string;
	endpointHost?: string;
	isTimeout?: boolean;
}> {
	ensureConfigured();
	if (!configured) {
		return { ok: false, error: 'Web push is not configured (missing VAPID keys).' };
	}

	const endpointHost = (() => {
		try {
			return new URL(subscription.endpoint).host;
		} catch {
			return undefined;
		}
	})();

	try {
		const timeoutMs = getPushTimeoutMs();
		await webpush.sendNotification(subscription, JSON.stringify(payload), {
			TTL: 60,
			timeout: timeoutMs
		});
		return { ok: true, endpointHost };
	} catch (error) {
		const err = error as {
			statusCode?: number;
			body?: string;
			code?: string;
			message?: string;
		};
		const statusCode = err.statusCode;
		const body = typeof err.body === 'string' && err.body.trim().length > 0 ? err.body.trim() : undefined;
		const message = error instanceof Error ? error.message : err.message || 'Unknown push error';
		const isTimeout = err.code === 'ETIMEDOUT' || /timed?\s*out|socket timeout/i.test(message);

		return {
			ok: false,
			statusCode,
			error: message,
			errorBody: body,
			endpointHost,
			isTimeout
		};
	}
}
