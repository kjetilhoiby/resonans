import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { eq } from 'drizzle-orm';

type PingEventData = {
	event: string;
	appliance: string;
	cycle_id?: string;
	power_watts?: number;
	duration_minutes?: number;
	total_kwh?: number;
	estimated_minutes_remaining?: number;
	matched_program?: string;
	match_confidence?: number;
};

function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	if (h > 0) return `${h}t ${m}min`;
	return `${m} min`;
}

export async function notifyPingEvent(args: {
	userId: string;
	appUrl: string;
	data: PingEventData;
}) {
	const { userId, appUrl, data } = args;

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: {
			id: true,
			googleChatWebhook: true,
			notificationSettings: true
		}
	});
	if (!user) return { sent: false };

	const settings = (user.notificationSettings ?? {}) as {
		applianceCycles?: { enabled?: boolean; notifyStart?: boolean; notifyFinish?: boolean };
	};
	if (settings.applianceCycles?.enabled === false) return { sent: false };

	const name = data.appliance;
	let title: string;
	let body: string;
	let tag: string;

	if (data.event === 'started') {
		if (settings.applianceCycles?.notifyStart === false) return { sent: false };

		const estimate = data.estimated_minutes_remaining
			? ` (ca. ${formatDuration(data.estimated_minutes_remaining)})`
			: '';
		const program = data.matched_program ? ` — ${data.matched_program}` : '';

		title = `${name} startet`;
		body = `${name} er i gang${program}${estimate}`;
		tag = `ping-start-${data.cycle_id ?? name}`;
	} else if (data.event === 'finished') {
		if (settings.applianceCycles?.notifyFinish === false) return { sent: false };

		const duration = data.duration_minutes ? formatDuration(data.duration_minutes) : '';
		const kwh = data.total_kwh ? `${data.total_kwh} kWh` : '';
		const program = data.matched_program ? `${data.matched_program} — ` : '';
		const stats = [duration, kwh].filter(Boolean).join(', ');

		title = `${name} er ferdig!`;
		body = `${program}${stats}`;
		tag = `ping-finish-${data.cycle_id ?? name}`;
	} else {
		return { sent: false };
	}

	const delivery = await PushDeliveryService.deliverToUser({
		userId,
		payload: { title, body, url: appUrl, tag },
		onGone: 'disable'
	});
	let sent = delivery.sent > 0;

	if (!sent && user.googleChatWebhook) {
		const delivered = await sendGoogleChatMessage(
			user.googleChatWebhook,
			{ text: `*${title}*\n${body}` }
		);
		if (delivered) sent = true;
	}

	return { sent };
}
