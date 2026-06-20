import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { eq } from 'drizzle-orm';
import { addChoresForCycle } from '$lib/server/services/chore-service';
import { choresForAppliance } from '$lib/domains/home/appliance-chores';

import type { MatchResult } from '$lib/server/services/appliance-profile-service';

type PingEventData = {
	event: string;
	appliance: string;
	cycle_id?: string;
	power_watts?: number;
	duration_minutes?: number;
	total_kwh?: number;
	estimated_minutes_remaining?: number;
};

function formatDuration(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = Math.round(minutes % 60);
	if (h > 0) return `${h}t ${m}min`;
	return `${m} min`;
}

function formatClockEstimate(minutesRemaining: number): string {
	const finish = new Date(Date.now() + minutesRemaining * 60_000);
	return finish.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' });
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
	let actions: Array<{ action: string; title: string }> | undefined;
	let extraData: Record<string, unknown> | undefined;

	if (data.event === 'started') {
		if (settings.applianceCycles?.notifyStart === false) return { sent: false };

		const estimate = data.estimated_minutes_remaining
			? ` — ferdig ca. ${formatClockEstimate(data.estimated_minutes_remaining)}`
			: '';

		title = `${name} startet`;
		body = `${name} er i gang${estimate}`;
		tag = `ping-start-${data.cycle_id ?? name}`;
	} else if (data.event === 'finished') {
		if (settings.applianceCycles?.notifyFinish === false) return { sent: false };

		// Husarbeidet samles i chores-view på hjem (ikke dagslista). Pushen tilbyr
		// å «ta» det inn i din egen dagsliste i stedet for å dytte det dit automatisk.
		const chores = choresForAppliance(name);

		const duration = data.duration_minutes ? formatDuration(data.duration_minutes) : '';
		const kwh = data.total_kwh ? `${data.total_kwh} kWh` : '';
		const stats = [duration, kwh].filter(Boolean).join(', ');

		title = `${name} er ferdig!`;
		body = chores.length > 0 ? [stats, chores.join(' · ')].filter(Boolean).join('\n') : stats;
		tag = `ping-finish-${data.cycle_id ?? name}`;

		if (chores.length > 0 && data.cycle_id) {
			actions = [{ action: 'claim-day', title: 'Legg i min dag' }];
			extraData = { claimCycleId: data.cycle_id };
		}
	} else {
		return { sent: false };
	}

	// Lenk alltid til apparat-siden — ren '/' ville trigget slot-sjekkinnen på hjemskjermen.
	// ?ref=push-markøren gjør at hjemskjermen lar være å åpne fullskjerm-sjekkin.
	let notifyUrl = `${appUrl}/?ref=push`;
	if (data.cycle_id) {
		const params = new URLSearchParams({ cycle: data.cycle_id, appliance: name });
		notifyUrl = `${appUrl}/apparat?${params}`;
	}

	const delivery = await PushDeliveryService.deliverToUser({
		userId,
		payload: { title, body, url: notifyUrl, tag, actions, data: extraData },
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

	if (data.event === 'finished') {
		await addChoresForCycle(
			userId,
			data.appliance,
			data.cycle_id,
			data.duration_minutes
		).catch((err) => console.error('[ping-chore]', err));
	}

	return { sent };
}

export async function notifyPingMatch(args: {
	userId: string;
	appUrl: string;
	appliance: string;
	cycleId: string;
	match: MatchResult;
}) {
	const { userId, appUrl, appliance, cycleId, match } = args;

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, googleChatWebhook: true, notificationSettings: true }
	});
	if (!user) return;

	const settings = (user.notificationSettings ?? {}) as {
		applianceCycles?: { enabled?: boolean };
	};
	if (settings.applianceCycles?.enabled === false) return;

	const finishTime = formatClockEstimate(match.estimatedRemainingMinutes);
	const title = `${appliance}: ${match.programName}`;
	const body = `Ferdig ca. ${finishTime}`;
	const tag = `ping-match-${cycleId}`;

	const params = new URLSearchParams({ cycle: cycleId, appliance });
	const notifyUrl = `${appUrl}/apparat?${params}`;

	const delivery = await PushDeliveryService.deliverToUser({
		userId,
		payload: { title, body, url: notifyUrl, tag },
		onGone: 'disable'
	});

	if (delivery.sent === 0 && user.googleChatWebhook) {
		await sendGoogleChatMessage(
			user.googleChatWebhook,
			{ text: `*${title}*\n${body}` }
		);
	}
}

