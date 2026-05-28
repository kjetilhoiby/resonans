import { eq, and, desc } from 'drizzle-orm';
import { db } from '$lib/db';
import { users, trainingPrograms } from '$lib/db/schema';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import { isWithinRecentMinutesWindow, localHm, localIsoDay } from '$lib/server/nudge-time';
import { evaluateProgramReadiness } from './readiness';

export type ProgramReadinessNudgeResult = {
	nudgeType: 'program_morning_readiness';
	userId: string;
	userName: string | null;
	programId: string | null;
	success: boolean;
	skipped?: boolean;
	skipReason?: string;
	pushSent?: number;
	chatSent?: boolean;
	state?: string;
	error?: string;
};

function buildPushBody(args: {
	state: 'klar' | 'lett' | 'easy' | 'rest';
	hasPlannedSession: boolean;
	sessionName: string | null;
	alternativeName: string | null;
	reasons: string[];
}): { title: string; body: string } {
	const { state, hasPlannedSession, sessionName, alternativeName, reasons } = args;
	const reasonsStr = reasons.length > 0 ? reasons.slice(0, 2).join(', ') : null;

	if (!hasPlannedSession) {
		if (state === 'klar') {
			return {
				title: 'I dag: Hvile',
				body: 'Søvn solid og tilstand balansert. Klar for neste økt.'
			};
		}
		return {
			title: 'I dag: Hvile',
			body: reasonsStr ? `Kroppen restituerer. ${reasonsStr}` : 'Kroppen restituerer.'
		};
	}

	const sessionLabel = sessionName ?? 'dagens økt';

	if (state === 'klar') {
		return {
			title: `I dag: ${sessionLabel}`,
			body: 'Alt klart — kjør på.'
		};
	}
	if (state === 'rest') {
		return {
			title: 'I dag: Hopp dagen',
			body: reasonsStr ? `Hvil i dag. ${reasonsStr}` : 'Hvil i dag.'
		};
	}
	const label = state === 'lett' ? 'Lett på' : 'Easy-dag';
	const altPart = alternativeName ? ` — ${alternativeName}` : '';
	return {
		title: `I dag: ${label}${altPart}`,
		body: reasonsStr ? `${reasonsStr}. ${sessionLabel} byttes ut.` : `${sessionLabel} byttes ut.`
	};
}

export async function runProgramReadinessNudges(args: {
	appUrl: string;
	now?: Date;
	windowMinutes?: number;
	requireRecentTimeWindow?: boolean;
	userId?: string;
}): Promise<{
	timestamp: string;
	processedUsers: number;
	results: ProgramReadinessNudgeResult[];
}> {
	const now = args.now ?? new Date();
	const windowMinutes = args.windowMinutes ?? 5;
	const requireWindow = args.requireRecentTimeWindow ?? true;

	const allUsers = args.userId
		? await db.query.users.findMany({ where: eq(users.id, args.userId) })
		: await db.query.users.findMany();

	const results: ProgramReadinessNudgeResult[] = [];

	for (const user of allUsers) {
		const settings = (user.notificationSettings ?? {}) as Record<string, any>;
		const cfg = settings.programReadiness as { enabled?: boolean; time?: string } | undefined;

		const base: ProgramReadinessNudgeResult = {
			nudgeType: 'program_morning_readiness',
			userId: user.id,
			userName: user.name ?? null,
			programId: null,
			success: false
		};

		try {
			if (!cfg || cfg.enabled === false) {
				results.push({ ...base, success: true, skipped: true, skipReason: 'disabled' });
				continue;
			}

			const tz = user.timezone || 'Europe/Oslo';
			const nowHm = localHm(tz, now);
			const targetHm = cfg.time || '06:30';
			if (requireWindow && !isWithinRecentMinutesWindow(nowHm, targetHm, windowMinutes)) {
				results.push({ ...base, success: true, skipped: true, skipReason: 'outside_window' });
				continue;
			}

			const activeProgram = await db
				.select({ id: trainingPrograms.id, name: trainingPrograms.name })
				.from(trainingPrograms)
				.where(and(eq(trainingPrograms.userId, user.id), eq(trainingPrograms.status, 'active')))
				.orderBy(desc(trainingPrograms.createdAt))
				.limit(1);
			if (activeProgram.length === 0) {
				results.push({ ...base, success: true, skipped: true, skipReason: 'no_active_program' });
				continue;
			}
			const program = activeProgram[0];
			base.programId = program.id;

			const isoDay = localIsoDay(tz, now);
			const assessment = await evaluateProgramReadiness({
				userId: user.id,
				programId: program.id,
				date: isoDay
			});

			const routes = resolveRoutesForNotification(user, 'programReadiness');
			if (routes.length === 0) {
				results.push({ ...base, success: true, skipped: true, skipReason: 'no_routes' });
				continue;
			}

			const eventId = await createNudgeEvent({
				userId: user.id,
				nudgeType: 'program_morning_readiness',
				mode: 'announce',
				channel: routeTargetsPwa(routes) ? 'pwa' : 'google_chat',
				context: { dayIso: isoDay, programId: program.id, state: assessment.state }
			});

			const programUrl = new URL(`/treningsprogram/${program.id}`, args.appUrl);
			if (eventId) programUrl.searchParams.set('nudgeEventId', eventId);

			const { title, body } = buildPushBody({
				state: assessment.state,
				hasPlannedSession: !!assessment.plannedSession,
				sessionName: assessment.plannedSession?.name ?? null,
				alternativeName: assessment.alternative?.name ?? null,
				reasons: assessment.reasons
			});

			let pushSent = 0;
			let chatSent = false;

			if (routeTargetsPwa(routes)) {
				const delivery = await PushDeliveryService.deliverToUser({
					userId: user.id,
					payload: {
						title,
						body,
						url: programUrl.toString(),
						tag: `program-readiness-${isoDay}`
					},
					onGone: 'disable',
					logPrefix: '[program-readiness-nudge]'
				});
				pushSent = delivery.sent;
			}

			const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
			for (const webhook of webhooks) {
				const lines = [
					`*${title}*`,
					body,
					`Detaljer: ${programUrl.toString()}`
				];
				const ok = await sendGoogleChatMessage(webhook, { text: lines.join('\n') });
				chatSent = chatSent || ok;
			}

			const sent = pushSent > 0 || chatSent;
			if (sent && eventId) await markNudgeSent(eventId);

			results.push({
				...base,
				success: true,
				pushSent,
				chatSent,
				state: assessment.state
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[program-readiness-nudge] failed for user', user.id, error);
			results.push({ ...base, success: false, error: message });
		}
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: results.length,
		results
	};
}
