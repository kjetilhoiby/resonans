import { db } from '$lib/db';
import { users, checklists, checklistItems } from '$lib/db/schema';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { eq, and } from 'drizzle-orm';
import { dayContextForDate } from '$lib/server/iso-week';

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

		const duration = data.duration_minutes ? formatDuration(data.duration_minutes) : '';
		const kwh = data.total_kwh ? `${data.total_kwh} kWh` : '';
		const stats = [duration, kwh].filter(Boolean).join(', ');

		title = `${name} er ferdig!`;
		body = stats;
		tag = `ping-finish-${data.cycle_id ?? name}`;
	} else {
		return { sent: false };
	}

	let notifyUrl = appUrl;
	if (data.event === 'started' && data.cycle_id) {
		const params = new URLSearchParams({ cycle: data.cycle_id, appliance: name });
		notifyUrl = `${appUrl}/apparat?${params}`;
	}

	const delivery = await PushDeliveryService.deliverToUser({
		userId,
		payload: { title, body, url: notifyUrl, tag },
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
		await createApplianceTask(
			userId,
			data.appliance,
			data.cycle_id,
			data.duration_minutes
		).catch((err) => console.error('[ping-task]', err));
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

const APPLIANCE_TASKS: Record<string, string[]> = {
	vaskemaskin: ['Tøm vaskemaskin', 'Heng opp klær'],
	oppvaskmaskin: ['Tøm oppvaskmaskin'],
	'tørketrommel': ['Tøm tørketrommel', 'Brett og legg vekk klær'],
};

function normalizeApplianceName(name: string): string {
	return name.toLowerCase().replace(/a$/, '').replace(/en$/, '');
}

async function createApplianceTask(userId: string, appliance: string, cycleId?: string, durationMinutes?: number) {
	const key = normalizeApplianceName(appliance);
	const matched = Object.entries(APPLIANCE_TASKS).find(([k]) => key.includes(k));
	if (!matched) return;

	const taskTexts = matched[1];
	const now = new Date();
	const tz = 'Europe/Oslo';
	const isoDate = now.toLocaleDateString('sv-SE', { timeZone: tz });
	const context = dayContextForDate(isoDate);

	let dayChecklist = await db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context))
	});

	if (!dayChecklist) {
		const weekday = now.toLocaleDateString('nb-NO', { weekday: 'long', timeZone: tz });
		const [created] = await db.insert(checklists).values({
			userId,
			title: weekday.charAt(0).toUpperCase() + weekday.slice(1),
			emoji: '🗓️',
			context
		}).returning();
		dayChecklist = created;
	}

	const existing = await db.query.checklistItems.findMany({
		where: and(
			eq(checklistItems.checklistId, dayChecklist.id),
			eq(checklistItems.userId, userId)
		),
		columns: { id: true, text: true }
	});

	await db.insert(checklistItems).values(
		taskTexts.map((text, i) => ({
			checklistId: dayChecklist!.id,
			userId,
			text,
			sortOrder: existing.length + i,
			metadata: {
				appliance,
				applianceCycleId: cycleId ?? undefined,
				applianceDurationMinutes: durationMinutes ?? undefined,
			}
		}))
	);
}
