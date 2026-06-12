/**
 * Bursdagsintervju — «hvem er du i år, hvem var du i fjor?»
 *
 * Spørsmålsdefinisjoner og markdown-formatet svarene lagres i
 * (reflections, kind 'birthday_interview', periodKey = årstall).
 * Stabile overskrifter gjør at neste års intervju og kavalkade-siden
 * kan parse fjorårets svar og holde dem opp mot årets.
 */

export interface InterviewSection {
	id: string;
	heading: string;
}

export const INTERVIEW_SECTIONS: InterviewSection[] = [
	{ id: 'who', heading: 'Hvem er du i år?' },
	// Rollene: hvor står du i hver av dem akkurat nå
	{ id: 'role_dad', heading: 'Som pappa' },
	{ id: 'role_partner', heading: 'Som partner' },
	{ id: 'role_friend', heading: 'Som venn' },
	{ id: 'role_work', heading: 'Som ansatt' },
	// AI-syntese fra kropp-og-hode-chatten (psykisk helse, vekt, trening, søvn)
	{ id: 'health_talk', heading: 'Kroppen og hodet' },
	{ id: 'goals_past', heading: 'Hva ville du oppnå?' },
	{ id: 'direction', heading: 'Hvor vil du videre?' },
	{ id: 'changed', heading: 'Hva har endret seg?' },
	{ id: 'started', heading: 'Hva har du begynt med?' },
	{ id: 'stopped', heading: 'Hva har du sluttet med?' },
	{ id: 'memory', heading: 'Hva husker du best?' },
	{ id: 'best_concert', heading: 'Beste konsert' },
	{ id: 'best_song', heading: 'Beste sang' },
	{ id: 'best_book', heading: 'Beste bok' },
	{ id: 'best_film', heading: 'Beste film eller serie' },
	{ id: 'best_theater', heading: 'Beste teaterstykke' },
	{ id: 'best_trip', heading: 'Beste tur' },
	{ id: 'best_experience', heading: 'Beste opplevelse' },
	// Skrives av onComplete (AI-ens speiling fra siste chat-steg), ikke et skjemafelt
	{ id: 'mirror', heading: 'Året i speilet' }
];

export type InterviewAnswers = Record<string, string>;

/** Plukk ut og trim intervjusvar fra flowData — ignorerer interne nøkler (_kavalkade osv.) */
export function extractInterviewAnswers(data: Record<string, unknown>): InterviewAnswers {
	const answers: InterviewAnswers = {};
	for (const section of INTERVIEW_SECTIONS) {
		const value = data[section.id];
		if (typeof value === 'string' && value.trim()) {
			answers[section.id] = value.trim();
		}
	}
	return answers;
}

/** Bygg lagringsformatet: én `## overskrift`-seksjon per besvart spørsmål */
export function buildInterviewMarkdown(answers: InterviewAnswers): string {
	return INTERVIEW_SECTIONS.filter((s) => answers[s.id]?.trim())
		.map((s) => `## ${s.heading}\n${answers[s.id].trim()}`)
		.join('\n\n');
}

/** Parse lagret markdown tilbake til svar per seksjons-id. Ukjente overskrifter ignoreres. */
export function parseInterviewMarkdown(content: string): InterviewAnswers {
	const headingToId = new Map(INTERVIEW_SECTIONS.map((s) => [s.heading.toLowerCase(), s.id]));
	const answers: InterviewAnswers = {};
	const blocks = content.split(/^## /m);
	for (const block of blocks) {
		const newlineIdx = block.indexOf('\n');
		if (newlineIdx === -1) continue;
		const heading = block.slice(0, newlineIdx).trim().toLowerCase();
		const body = block.slice(newlineIdx + 1).trim();
		const id = headingToId.get(heading);
		if (id && body) answers[id] = body;
	}
	return answers;
}

/** Punktliste-tekst av svarene — brukes i AI-prompt og som «i fjor»-kontekst */
export function formatAnswersAsText(answers: InterviewAnswers): string {
	return INTERVIEW_SECTIONS.filter((s) => s.id !== 'mirror' && answers[s.id])
		.map((s) => `- ${s.heading} ${answers[s.id]}`)
		.join('\n');
}

/**
 * Hent AI-ens løpende oppsummering fra kropp-og-hode-chatten — innholdet
 * mellom <status>-markørene i siste assistentmelding. Tom streng uten markører
 * (bevisst strengt, så vi aldri lagrer løs prosa som status).
 */
export function parseStatusBlock(message: string): string {
	const match = message.match(/<status>([\s\S]*?)<\/status>/i);
	return match ? match[1].trim() : '';
}

// ── Bursdagsmål: speilets forslag blir ekte mål med frist neste bursdag ─────

export interface BirthdayGoal {
	title: string;
	value: number | null;
	unit: string | null;
}

/**
 * Hent foreslåtte bursdagsmål fra speil-meldingen — linjene mellom
 * <bursdagsmål>-markørene. «Tittel: 600 km» gir målbart mål; linjer uten
 * tall blir rene intensjonsmål. Maks 6.
 */
export function parseBirthdayGoals(message: string): BirthdayGoal[] {
	const match = message.match(/<bursdagsmål>([\s\S]*?)<\/bursdagsmål>/i);
	if (!match) return [];
	const goals: BirthdayGoal[] = [];
	for (const raw of match[1].split('\n')) {
		const line = raw.trim().replace(/^[-*•·]\s*/, '');
		if (!line || line.length > 160) continue;
		const m = line.match(/^(.+?):\s*(\d+(?:[.,]\d+)?)\s*(.*)$/);
		if (m) {
			goals.push({
				title: m[1].trim(),
				value: parseFloat(m[2].replace(',', '.')),
				unit: m[3].trim() || null
			});
		} else {
			goals.push({ title: line, value: null, unit: null });
		}
	}
	return goals.slice(0, 6);
}

/**
 * Ren-tekst-transkript av en chat-tråd («Samtalen er data» — hele samtalen
 * arkiveres, ikke bare destillatet). Markør-blokkene strippes; de bor
 * allerede som seksjoner i selve selvangivelsen.
 */
export function formatThreadTranscript(thread: unknown): string {
	if (!Array.isArray(thread)) return '';
	return thread
		.filter(
			(m): m is { role: string; text: string } =>
				!!m &&
				typeof (m as { role?: unknown }).role === 'string' &&
				typeof (m as { text?: unknown }).text === 'string'
		)
		.map((m) => {
			const text = m.text
				.replace(/<status>[\s\S]*?<\/status>/gi, '')
				.replace(/<bursdagsmål>[\s\S]*?<\/bursdagsmål>/gi, '')
				.trim();
			return text ? `${m.role === 'user' ? 'Du' : 'Resonans'}: ${text}` : '';
		})
		.filter(Boolean)
		.join('\n\n');
}
