import webpush from 'web-push';
import { env } from '$env/dynamic/private';

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
