import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { webPushSubscriptions } from '$lib/db/schema';
import { isSubscriptionGone, isWebPushConfigured, sendWebPush } from '$lib/server/web-push';

export type PushDeliveryPayload = {
	title: string;
	body: string;
	url: string;
	tag?: string;
};

export type PushGoneAction = 'disable' | 'delete';

export type PushDeliveryResult = {
	configured: boolean;
	total: number;
	sent: number;
	gone: number;
	failed: number;
	errors: string[];
	failuresByHost: Record<string, number>;
	stats: {
		forbidden: number;
		timeouts: number;
	};
};

export class PushDeliveryService {
	static async deliverToUser(args: {
		userId: string;
		payload: PushDeliveryPayload;
		onGone?: PushGoneAction;
		logPrefix?: string;
	}): Promise<PushDeliveryResult> {
		if (!isWebPushConfigured()) {
			return {
				configured: false,
				total: 0,
				sent: 0,
				gone: 0,
				failed: 0,
				errors: ['Web push is not configured (missing VAPID keys).'],
				failuresByHost: {},
				stats: {
					forbidden: 0,
					timeouts: 0
				}
			};
		}

		const subscriptions = await db.query.webPushSubscriptions.findMany({
			where: and(eq(webPushSubscriptions.userId, args.userId), eq(webPushSubscriptions.disabled, false))
		});

		return this.deliverToSubscriptions({
			subscriptions,
			payload: args.payload,
			onGone: args.onGone,
			logPrefix: args.logPrefix
		});
	}

	static async deliverToSubscriptions(args: {
		subscriptions: Array<{
			id: string;
			endpoint: string;
			p256dh: string;
			auth: string;
		}>;
		payload: PushDeliveryPayload;
		onGone?: PushGoneAction;
		logPrefix?: string;
	}): Promise<PushDeliveryResult> {
		if (!isWebPushConfigured()) {
			return {
				configured: false,
				total: args.subscriptions.length,
				sent: 0,
				gone: 0,
				failed: args.subscriptions.length,
				errors: ['Web push is not configured (missing VAPID keys).'],
				failuresByHost: {},
				stats: {
					forbidden: 0,
					timeouts: 0
				}
			};
		}

		const onGone = args.onGone ?? 'disable';
		const failuresByHost: Record<string, number> = {};
		const errors: string[] = [];
		let sent = 0;
		let gone = 0;
		let forbidden = 0;
		let timeouts = 0;

		for (const sub of args.subscriptions) {
			const result = await sendWebPush(
				{
					endpoint: sub.endpoint,
					keys: {
						p256dh: sub.p256dh,
						auth: sub.auth
					}
				},
				{
					title: args.payload.title,
					body: args.payload.body,
					url: args.payload.url,
					tag: args.payload.tag
				}
			);

			if (args.logPrefix) {
				console.log(
					`[${args.logPrefix}] sub=${sub.endpoint.substring(0, 50)}... host=${result.endpointHost ?? 'unknown'} ok=${result.ok} status=${result.statusCode} timeout=${result.isTimeout ? 'yes' : 'no'} error=${result.error} body=${result.errorBody ?? ''}`
				);
			}

			if (result.ok) {
				sent += 1;
				await db
					.update(webPushSubscriptions)
					.set({ lastSuccessAt: new Date(), updatedAt: new Date() })
					.where(eq(webPushSubscriptions.id, sub.id));
				continue;
			}

			if (result.endpointHost) {
				failuresByHost[result.endpointHost] = (failuresByHost[result.endpointHost] ?? 0) + 1;
			}
			if (result.statusCode === 403) forbidden += 1;
			if (result.isTimeout) timeouts += 1;

			const bodySuffix = result.errorBody ? ` | body=${result.errorBody}` : '';
			const hostPrefix = result.endpointHost ? `${result.endpointHost} ` : '';
			errors.push(`[${result.statusCode ?? 'no-status'}] ${hostPrefix}${result.error ?? 'unknown'}${bodySuffix}`);

			const isGone = result.statusCode === 400 || isSubscriptionGone(result);
			if (isGone) {
				gone += 1;
				if (onGone === 'delete') {
					await db.delete(webPushSubscriptions).where(eq(webPushSubscriptions.id, sub.id));
				} else {
					await db
						.update(webPushSubscriptions)
						.set({ disabled: true, lastFailureAt: new Date(), updatedAt: new Date() })
						.where(eq(webPushSubscriptions.id, sub.id));
				}
				continue;
			}

			await db
				.update(webPushSubscriptions)
				.set({ lastFailureAt: new Date(), updatedAt: new Date() })
				.where(eq(webPushSubscriptions.id, sub.id));
		}

		const total = args.subscriptions.length;
		const failed = total - sent;

		return {
			configured: true,
			total,
			sent,
			gone,
			failed,
			errors,
			failuresByHost,
			stats: {
				forbidden,
				timeouts
			}
		};
	}
}
