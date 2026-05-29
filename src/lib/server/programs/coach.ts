import { db } from '$lib/db';
import { sensorEvents, trainingPrograms } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { buildAthleteSnapshot } from './athlete-context';
import { getTodaySession } from './repository';
import { evaluateProgramReadiness } from './readiness';

const MODEL = 'gpt-5.4';

export interface CoachResult {
	ok: true;
	text: string;
	model: string;
	generatedAt: string;
}

interface RecentSignal {
	date: string;
	type: string;
	value: string;
}

async function loadRecentSignals(userId: string, days: number): Promise<RecentSignal[]> {
	const cutoff = new Date();
	cutoff.setUTCDate(cutoff.getUTCDate() - days);

	const rows = await db
		.select({
			data: sensorEvents.data,
			dataType: sensorEvents.dataType,
			timestamp: sensorEvents.timestamp
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				gte(sensorEvents.timestamp, cutoff)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(80);

	const signals: RecentSignal[] = [];
	const seenSleep = new Set<string>();
	const seenEgen = new Set<string>();

	for (const row of rows) {
		const date = row.timestamp.toISOString().slice(0, 10);
		const data = (row.data ?? {}) as Record<string, unknown>;

		if (row.dataType === 'sleep' && !seenSleep.has(date)) {
			const score = typeof data.sleepScore === 'number' ? data.sleepScore : null;
			const durationMin = typeof data.sleepDuration === 'number'
				? Math.round((data.sleepDuration as number) / 60)
				: null;
			if (score !== null || durationMin !== null) {
				const parts: string[] = [];
				if (score !== null) parts.push(`score ${score}`);
				if (durationMin !== null) parts.push(`${Math.floor(durationMin / 60)}t${(durationMin % 60).toString().padStart(2, '0')}`);
				signals.push({ date, type: 'sleep', value: parts.join(', ') });
				seenSleep.add(date);
			}
		}

		if (row.dataType === 'egenfrekvens_checkin' && !seenEgen.has(date)) {
			const level = typeof data.level === 'number' ? data.level : null;
			const balance = typeof data.balance === 'number' ? data.balance : null;
			if (level !== null) {
				const parts: string[] = [`nivå ${level}/5`];
				if (balance !== null) parts.push(`balanse ${balance}`);
				signals.push({ date, type: 'egenfrekvens', value: parts.join(', ') });
				seenEgen.add(date);
			}
		}
	}

	return signals;
}

interface ProgramContextLines {
	lines: string[];
}

async function loadProgramContext(args: {
	userId: string;
	programId: string;
}): Promise<ProgramContextLines | null> {
	const program = await db.query.trainingPrograms.findFirst({
		where: and(
			eq(trainingPrograms.id, args.programId),
			eq(trainingPrograms.userId, args.userId)
		),
		columns: {
			id: true,
			name: true,
			goal: true,
			status: true,
			durationWeeks: true,
			sessionsPerWeek: true,
			startDate: true
		}
	});
	if (!program) return null;

	const lines: string[] = [];
	lines.push(`Aktivt program: ${program.name} — mål: ${program.goal}`);
	lines.push(
		`Status: ${program.status}, ${program.durationWeeks} uker, ${program.sessionsPerWeek} økter/uke`
	);

	const today = await getTodaySession(args.userId, args.programId).catch(() => null);
	if (today?.session) {
		lines.push(
			`I dag (uke ${today.weekNumber}, dag ${today.session.dayNumber}): ${today.session.kind === 'run' ? 'Løp' : 'Styrke'} — ${today.session.name}`
		);
		if (today.session.completion) lines.push('  Status: fullført');
	} else {
		lines.push('I dag: hviledag eller programmet er ikke aktivt i dag.');
	}

	try {
		const readiness = await evaluateProgramReadiness({
			userId: args.userId,
			programId: args.programId
		});
		lines.push(`Tilstand i dag: ${readiness.state} (${readiness.reasons.join(', ')})`);
	} catch {
		// Readiness er ikke kritisk for coach-svar
	}

	return { lines };
}

export async function generateCoachResponse(args: {
	userId: string;
	prompt: string;
	programId?: string | null;
}): Promise<CoachResult> {
	const userPrompt = args.prompt.trim();
	if (!userPrompt) throw new CoachError('Prompt er tom');

	const [athlete, recentSignals, programCtx] = await Promise.all([
		buildAthleteSnapshot(args.userId),
		loadRecentSignals(args.userId, 7),
		args.programId ? loadProgramContext({ userId: args.userId, programId: args.programId }) : Promise.resolve(null)
	]);

	const ctxLines: string[] = [];
	ctxLines.push('Atlet-snapshot:');
	if (athlete.recentVolumeKm)
		ctxLines.push(`- Volum: ${athlete.recentVolumeKm.toFixed(1)} km/uke (4 uker)`);
	if (athlete.recentSessionsPerWeek)
		ctxLines.push(`- Frekvens: ${athlete.recentSessionsPerWeek.toFixed(1)} økter/uke`);
	if (athlete.vdotEstimate)
		ctxLines.push(`- VDOT: ${athlete.vdotEstimate} (${athlete.vdotSource})`);
	if (athlete.paceZones) {
		const z = athlete.paceZones;
		const fmt = (s?: number) =>
			s ? `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}/km` : '-';
		ctxLines.push(
			`- Soner: easy ${fmt(z.easySecPerKm)}, tempo ${fmt(z.tempoSecPerKm)}, intervall ${fmt(z.intervalSecPerKm)}`
		);
	}
	if (athlete.bestEfforts) {
		const items = Object.entries(athlete.bestEfforts)
			.filter(([, v]) => typeof v === 'number')
			.map(([k, v]) => `${k} ${Math.floor((v as number) / 60)}:${((v as number) % 60).toString().padStart(2, '0')}`);
		if (items.length > 0) ctxLines.push(`- Beste tider: ${items.join(', ')}`);
	}

	if (recentSignals.length > 0) {
		ctxLines.push('');
		ctxLines.push('Siste 7 dager — søvn og egenfrekvens:');
		for (const sig of recentSignals.slice(0, 14)) {
			ctxLines.push(`- ${sig.date} ${sig.type}: ${sig.value}`);
		}
	}

	if (programCtx) {
		ctxLines.push('');
		ctxLines.push(...programCtx.lines);
	}

	const system = `Du er Resonans-coach. Du svarer en hobbyutøver kort, rolig og spesifikt på norsk.
Du har tilgang til atletens treningskontekst nedenfor — bruk den når den er relevant for spørsmålet, men ikke ramse opp tall som ikke trengs.
Hvis brukeren spør om noe som krever data du ikke har, si det rett ut og foreslå hvor de finner svaret i appen.
Hold svaret under 6 setninger med mindre brukeren eksplisitt ber om mer. Ingen overskrifter, ingen lange lister.

KONTEKST:
${ctxLines.join('\n')}`;

	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: userPrompt }
		],
		max_completion_tokens: 600
	});

	const text = response.choices[0]?.message?.content?.trim() ?? '';
	if (!text) throw new CoachError('Tom respons fra modellen');

	return {
		ok: true,
		text,
		model: MODEL,
		generatedAt: new Date().toISOString()
	};
}

export class CoachError extends Error {}
