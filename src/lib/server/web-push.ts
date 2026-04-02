import webpush from 'web-push';
import { env } from '$env/dynamic/private';

let configured = false;

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

export async function sendWebPush(
	subscription: webpush.PushSubscription,
	payload: Record<string, unknown>
): Promise<{ ok: boolean; statusCode?: number; error?: string }> {
	ensureConfigured();
	if (!configured) {
		return { ok: false, error: 'Web push is not configured (missing VAPID keys).' };
	}

	try {
		await webpush.sendNotification(subscription, JSON.stringify(payload));
		return { ok: true };
	} catch (error) {
		const statusCode = (error as { statusCode?: number }).statusCode;
		return {
			ok: false,
			statusCode,
			error: error instanceof Error ? error.message : 'Unknown push error'
		};
	}
}
