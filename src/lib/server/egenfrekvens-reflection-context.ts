import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, sensorEvents } from '$lib/db/schema';

const DEFAULT_RECENT_LIMIT = 5;

export interface EgenfrekvensReflectionContext {
	recentCheckins: Array<{
		day: string;
		balance: number | null;
		thoughts: number | null;
		feelings: number | null;
		actions: number | null;
		note: string | null;
		reflection: string | null;
		extreme: boolean;
		timestamp: string;
	}>;
	dayPlan: {
		isoDate: string;
		headline: string | null;
		items: Array<{ text: string; checked: boolean }>;
	} | null;
	systemPrompt: string;
}

function getIsoWeekDashedFromIsoDate(isoDate: string): string | null {
	const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
	const year = Number.parseInt(yearRaw ?? '', 10);
	const month = Number.parseInt(monthRaw ?? '', 10);
	const day = Number.parseInt(dayRaw ?? '', 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
	const date = new Date(Date.UTC(year, month - 1, day));
	const dayOfWeek = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const weekNumber =
		1 +
		Math.round(((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
	return `${date.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

function contextForDay(isoDate: string): string | null {
	const weekKey = getIsoWeekDashedFromIsoDate(isoDate);
	if (!weekKey) return null;
	return `week:${weekKey}:day:${isoDate}`;
}

function fmtSigned(n: number | null, digits = 0): string {
	if (n === null) return '—';
	const sign = n > 0 ? '+' : '';
	return `${sign}${n.toFixed(digits)}`;
}

function fmt(n: number | null, digits = 0): string {
	if (n === null) return '—';
	return n.toFixed(digits);
}

function buildSystemPrompt(
	ctx: Omit<EgenfrekvensReflectionContext, 'systemPrompt'>,
	slot?: 'morning' | 'evening'
): string {
	const lines: string[] = [];
	lines.push(
		'Du er en varm, kort samtalepartner. Brukeren har akkurat fylt ut en egenfrekvens-sjekkin med tall for tanker, følelser og handlinger.'
	);
	lines.push('Din oppgave er REFLEKSJON, ikke handlingsplan.');
	lines.push('');
	lines.push('Slik svarer du:');
	lines.push(
		'1. Speil tilbake i én setning hva du har lest fra sjekkinnen eller brukerens forrige svar — vis at du har sett helheten.'
	);
	lines.push(
		'2. Still ETT åpent spørsmål som borer i det brukeren nettopp svarte. Vær nysgjerrig på hva som ligger bak tallene og signalene som ble valgt — tanker, følelser, handlinger.'
	);
	lines.push('3. Aldri lange monologer. Hold svaret kort.');
	lines.push('');
	lines.push('Strenge regler:');
	lines.push(
		'- Ikke gi råd eller foreslå konkrete handlinger med mindre brukeren eksplisitt spør om det ("hva bør jeg gjøre?", "har du forslag?").'
	);
	lines.push(
		'- Ikke fix-it-modus. Brukerens jobb er å reflektere, ikke å motta løsninger.'
	);
	lines.push(
		'- Ikke-klinisk tone, ingen diagnoser. Bruk historikken under varsomt som kontekst — ikke ramse opp data.'
	);
	lines.push(
		'- Viktig: dimensjonene kan avvike. Høy handling + lave følelser er ikke "middels" — det kan være overstyring eller maskering.'
	);
	if (slot === 'morning') {
		lines.push('');
		lines.push(
			'Det er morgen. Etter noen turer med speiling og åpne spørsmål — hvis det føles riktig — kan du invitere brukeren til å sette ord på det viktigste målet for dagen i dag.'
		);
	} else if (slot === 'evening') {
		lines.push('');
		lines.push(
			'Det er kveld. Etter noen turer med speiling og åpne spørsmål — hvis det føles riktig — kan du invitere brukeren til å nevne tre konkrete ting hen er fornøyd med fra dagen.'
		);
	}

	if (ctx.recentCheckins.length > 0) {
		lines.push('');
		lines.push(`SISTE ${ctx.recentCheckins.length} SJEKKINS:`);
		for (const c of ctx.recentCheckins) {
			const parts = [
				`${c.day}`,
				`balanse ${fmtSigned(c.balance)}`,
				`tanker ${fmt(c.thoughts)}/5`,
				`følelser ${fmt(c.feelings)}/5`,
				`handlinger ${fmt(c.actions)}/5`
			];
			if (c.extreme) parts.push('utslag');
			let line = `- ${parts.join(', ')}`;
			if (c.note) line += `. Note: ${c.note}`;
			lines.push(line);
		}
	}

	if (ctx.dayPlan) {
		lines.push('');
		lines.push(`DAGSPLAN (${ctx.dayPlan.isoDate}):`);
		if (ctx.dayPlan.headline) lines.push(`- Overskrift: ${ctx.dayPlan.headline}`);
		const items = ctx.dayPlan.items.slice(0, 12);
		for (const it of items) {
			lines.push(`- ${it.checked ? '[x]' : '[ ]'} ${it.text}`);
		}
		if (ctx.dayPlan.items.length > items.length) {
			lines.push(`- (+${ctx.dayPlan.items.length - items.length} flere punkter)`);
		}
	}

	if (ctx.recentCheckins.length === 0 && !ctx.dayPlan) {
		lines.push('');
		lines.push('(Ingen historikk eller dagsplan tilgjengelig.)');
	}

	return lines.join('\n');
}

export async function buildEgenfrekvensReflectionContext(
	userId: string,
	options: { day?: string; recentLimit?: number; slot?: 'morning' | 'evening' } = {}
): Promise<EgenfrekvensReflectionContext> {
	const day = options.day || new Date().toISOString().slice(0, 10);
	const recentLimit = options.recentLimit ?? DEFAULT_RECENT_LIMIT;
	const slot = options.slot;

	const recentRows = await db
		.select({ data: sensorEvents.data, timestamp: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'egenfrekvens_checkin')))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(recentLimit);

	const num = (v: unknown) => (typeof v === 'number' ? v : null);
	const str = (v: unknown) => (typeof v === 'string' ? v : null);

	const recentCheckins = recentRows.map((row) => {
		const data = (row.data ?? {}) as Record<string, unknown>;
		return {
			day: str(data.day) ?? '',
			balance: num(data.balance),
			thoughts: num(data.thoughts),
			feelings: num(data.feelings),
			actions: num(data.actions),
			note: str(data.note),
			reflection: str(data.reflection),
			extreme: Boolean(data.extreme),
			timestamp: row.timestamp.toISOString()
		};
	});

	let dayPlan: EgenfrekvensReflectionContext['dayPlan'] = null;
	const checklistContext = contextForDay(day);
	if (checklistContext) {
		const checklist = await db.query.checklists.findFirst({
			where: and(eq(checklists.userId, userId), eq(checklists.context, checklistContext)),
			with: {
				items: {
					orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
				}
			}
		});
		if (checklist) {
			dayPlan = {
				isoDate: day,
				headline: checklist.title ?? null,
				items: (checklist.items ?? []).map((item) => ({
					text: item.text,
					checked: Boolean(item.checked)
				}))
			};
		}
	}

	const partial = { recentCheckins, dayPlan };
	return {
		...partial,
		systemPrompt: buildSystemPrompt(partial, slot)
	};
}
