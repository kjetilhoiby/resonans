import { z } from 'zod';
import {
	deleteStreakDefinition,
	loadStreaks,
	logStreakRound,
	upsertStreakDefinition
} from '$lib/server/services/streak-service';
import { parseStreakInput } from '$lib/server/streak-input';
import { dueLabel, streakLabel } from '$lib/domain/streaks';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sourceSchema = z.object({
	kind: z.enum(['workout', 'sensor_event', 'manual']),
	sportFamily: z.string().optional(),
	dataType: z.string().optional(),
	textMatch: z.string().optional()
});

const configSchema = z.object({
	windowDays: z.number().int().positive().optional(),
	threshold: z.number().int().positive().optional(),
	intervalDays: z.number().int().positive().optional(),
	dueSoonDays: z.number().int().positive().optional()
});

export const manageStreakTool = {
	name: 'manage_streak',
	description: `Administrer brukerens streaks — «hvor mange runder på rad har jeg holdt?».
Én modell dekker tre semantikker, alle vist med samme flamme-teller:

rule=consecutive_days — dager på rad med hendelse.
  «yoga hver dag», «lett styrke hver dag»
rule=count_per_window — perioder på rad over en terskel. config.windowDays (7=uke) + config.threshold.
  «uker på rad med minst to løpeturer» → windowDays 7, threshold 2
rule=max_interval — runder på rad innen et intervall. config.intervalDays påkrevd.
  «hårklipp innen fem dager» → intervalDays 5. «badevask innen to uker» → intervalDays 14

Periodisk vedlikehold (max_interval) løftes automatisk fram på ukeplanen når det
nærmer seg forfall, så brukeren kan plukke det ned på en dag. Ikke lag nedtellings-
oppgaver for dette manuelt — streaken håndterer det.

source velger hvor hendelsene kommer fra:
- { kind: 'workout', sportFamily } — treningsøkter. sportFamily: 'running', 'yoga', 'strength', 'cycling', 'walking', 'swimming'
- { kind: 'sensor_event', dataType, textMatch? } — sensorhendelser, f.eks. dataType 'chore_done' med textMatch 'badevask'
- { kind: 'manual' } — brukeren registrerer selv (bruk for hårklipp, badevask og annet uten datakilde)

action=list: list alle streaks med nåværende tilstand.
action=create: opprett. Krever title, rule, source (+ config for count_per_window/max_interval).
action=update: oppdater. Krever id og samme felter som create.
action=delete: slett. Krever id.
action=log: registrer en gjennomført runde nå (kun manuelle streaks). Krever id.`,
	parameters: z.object({
		userId: z.string(),
		action: z.enum(['list', 'create', 'update', 'delete', 'log']),
		id: z.string().optional(),
		title: z.string().optional(),
		emoji: z.string().optional(),
		rule: z.enum(['consecutive_days', 'count_per_window', 'max_interval']).optional(),
		source: sourceSchema.optional(),
		config: configSchema.optional(),
		active: z.boolean().optional(),
		/** Etterregistrering av en runde: 'YYYY-MM-DD'. Default i dag. */
		date: z.string().optional()
	}),
	execute: async (args: {
		userId: string;
		action: 'list' | 'create' | 'update' | 'delete' | 'log';
		id?: string;
		title?: string;
		emoji?: string;
		rule?: 'consecutive_days' | 'count_per_window' | 'max_interval';
		source?: { kind: string; sportFamily?: string; dataType?: string; textMatch?: string };
		config?: {
			windowDays?: number;
			threshold?: number;
			intervalDays?: number;
			dueSoonDays?: number;
		};
		active?: boolean;
		date?: string;
	}) => {
		const { userId, action } = args;

		if (action === 'list') {
			const streaks = await loadStreaks(userId, { includeInactive: false });
			return {
				streaks: streaks.map(({ definition, state }) => ({
					id: definition.id,
					title: definition.title,
					emoji: definition.emoji,
					rule: definition.rule,
					sourceKind: definition.source.kind,
					streak: streakLabel(state) || 'ingen aktiv streak',
					best: state.bestCount,
					status: state.status,
					...(state.daysUntilDue != null ? { due: dueLabel(state) } : {}),
					...(state.windowTarget != null
						? { thisPeriod: `${state.windowCount ?? 0}/${state.windowTarget}` }
						: {}),
					lastEventDay: state.lastEventDay
				}))
			};
		}

		if (action === 'delete') {
			if (!args.id || !UUID_RE.test(args.id)) return { error: 'id må være en UUID' };
			await deleteStreakDefinition(userId, args.id);
			return { ok: true, id: args.id };
		}

		if (action === 'log') {
			if (!args.id || !UUID_RE.test(args.id)) return { error: 'id må være en UUID' };
			const at =
				typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
					? new Date(`${args.date}T12:00:00Z`)
					: undefined;
			try {
				const eventId = await logStreakRound(userId, args.id, at);
				return { ok: true, eventId, loggedFor: args.date ?? 'i dag' };
			} catch (e) {
				return { error: e instanceof Error ? e.message : 'kunne ikke logge runde' };
			}
		}

		// create / update — gjenbruker samme validering som API-et.
		if (action === 'update' && (!args.id || !UUID_RE.test(args.id))) {
			return { error: 'id må være en UUID for update' };
		}

		const parsed = parseStreakInput(
			{
				title: args.title,
				emoji: args.emoji,
				rule: args.rule,
				source: args.source,
				config: args.config,
				active: args.active
			},
			action === 'update' ? args.id : undefined
		);
		if (!parsed.ok) return { error: parsed.error };

		const saved = await upsertStreakDefinition(userId, parsed.input);
		return {
			streak: {
				id: saved.id,
				title: saved.title,
				emoji: saved.emoji,
				rule: saved.rule,
				source: saved.source,
				config: saved.config,
				active: saved.active
			},
			action
		};
	}
};
