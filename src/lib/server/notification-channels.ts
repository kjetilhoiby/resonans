import { sendGoogleChatMessage, type GoogleChatMessage } from '$lib/server/google-chat';

export type NotificationRouteKey =
	| 'dailyCheckIn'
	| 'dayPlanning'
	| 'dayClose'
	| 'relationshipCheckinMorning'
	| 'digestDay'
	| 'salaryReceived';

export type GoogleChatChannel = {
	id: string;
	name: string;
	webhook: string;
	enabled?: boolean;
};

type NotificationChannelSettings = {
	notificationChannels?: {
		googleChat?: GoogleChatChannel[];
		routing?: Partial<Record<NotificationRouteKey, string[]>>;
	};
};

type UserChannelsInput = {
	googleChatWebhook?: string | null;
	notificationSettings?: NotificationChannelSettings | null;
};

function slugify(input: string) {
	return input
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
}

function unique<T>(values: T[]) {
	return [...new Set(values)];
}

export function normalizeGoogleChatChannels(user: UserChannelsInput): GoogleChatChannel[] {
	const fromSettings = user.notificationSettings?.notificationChannels?.googleChat;
	const mapped: GoogleChatChannel[] = [];
	if (Array.isArray(fromSettings)) {
		for (let index = 0; index < fromSettings.length; index += 1) {
			const channel = fromSettings[index];
			const webhook = String(channel?.webhook ?? '').trim();
			if (!webhook) continue;
			const name = String(channel?.name ?? '').trim() || `Kanal ${index + 1}`;
			const id = String(channel?.id ?? '').trim() || slugify(name) || `channel-${index + 1}`;
			mapped.push({
				id,
				name,
				webhook,
				enabled: channel?.enabled !== false
			});
		}
	}

	const legacyWebhook = String(user.googleChatWebhook ?? '').trim();
	if (legacyWebhook && !mapped.some((channel) => channel.id === 'default' || channel.webhook === legacyWebhook)) {
		mapped.unshift({ id: 'default', name: 'Standard', webhook: legacyWebhook, enabled: true });
	}

	return mapped;
}

function defaultRoutes(key: NotificationRouteKey, hasChatChannel: boolean): string[] {
	const defaultChat = hasChatChannel ? ['chat:default'] : [];
	if (key === 'dailyCheckIn') return defaultChat;
	return unique(['pwa', ...defaultChat]);
}

export function resolveRoutesForNotification(user: UserChannelsInput, key: NotificationRouteKey): string[] {
	const channels = normalizeGoogleChatChannels(user).filter((channel) => channel.enabled !== false);
	const channelIds = new Set(channels.map((channel) => channel.id));
	const routing = user.notificationSettings?.notificationChannels?.routing;
	const configured = routing?.[key] ?? defaultRoutes(key, channels.length > 0);

	return unique(
		configured.filter((route) => {
			if (route === 'pwa') return true;
			if (!route.startsWith('chat:')) return false;
			const channelId = route.slice(5);
			if (!channelId) return false;
			if (channelId === 'default') return channels.length > 0;
			return channelIds.has(channelId);
		})
	);
}

export function routeTargetsPwa(routes: string[]) {
	return routes.includes('pwa');
}

export function getGoogleChatWebhooksForRoutes(user: UserChannelsInput, routes: string[]): string[] {
	const channels = normalizeGoogleChatChannels(user).filter((channel) => channel.enabled !== false);
	const byId = new Map(channels.map((channel) => [channel.id, channel.webhook]));

	const webhooks = routes
		.filter((route) => route.startsWith('chat:'))
		.map((route) => route.slice(5))
		.map((id) => {
			if (id === 'default') {
				return byId.get('default') ?? channels[0]?.webhook ?? null;
			}
			return byId.get(id) ?? null;
		})
		.filter((value): value is string => Boolean(value));

	return unique(webhooks);
}

export async function sendGoogleChatToRoutes(args: {
	user: UserChannelsInput;
	routes: string[];
	message: GoogleChatMessage;
}) {
	const webhooks = getGoogleChatWebhooksForRoutes(args.user, args.routes);
	if (webhooks.length === 0) return false;

	let sent = false;
	for (const webhook of webhooks) {
		const ok = await sendGoogleChatMessage(webhook, args.message);
		sent = sent || ok;
	}
	return sent;
}
