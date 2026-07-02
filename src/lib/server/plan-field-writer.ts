/**
 * Skriver den endelige feltverdien (månedsnotat, ukesnotat, refleksjon) fra et
 * chat-steg. I stedet for å ta siste assistent-melding rått (ofte et spørsmål eller
 * mellomsteg) og skrubbe den med regex, gjør vi en oppsummering → renskriving:
 * en modell leser hele samtaletråden, vekter BRUKERENS egne meldinger og valg som
 * substans, bruker assistentens meldinger som kontekst, og returnerer ren tekst.
 *
 * Ren tekst betyr uten inline-markdown (**fet**, #overskrift) — men enkle punktlister
 * med «- » er lov og ofte ønskelig, så de bevares.
 */

import { openai } from './openai';
import { markdownToPlain } from './plan-text';

export type PlanFieldThreadMsg = { role: 'user' | 'assistant'; text: string };
export type PlanFieldKind = 'note' | 'reflection';

const KIND_LABEL: Record<PlanFieldKind, string> = {
	note: 'et kort, personlig notat/en beskrivelse',
	reflection: 'en kort refleksjon over perioden'
};

function buildSystemPrompt(kind: PlanFieldKind, periodLabel?: string): string {
	const scope = periodLabel ? ` for ${periodLabel}` : '';
	return [
		`Du renskriver ${KIND_LABEL[kind]}${scope} basert på en samtale mellom en bruker og en assistent.`,
		'',
		'Regler:',
		'- Bygg teksten på BRUKERENS egne meldinger, valg og formuleringer. Assistentens meldinger er kun kontekst/forslag — ta bare med det brukeren faktisk sluttet seg til.',
		'- Skriv i første person, slik brukeren ville skrevet det selv.',
		'- Ren tekst: ingen fet/kursiv/overskrifter eller andre markdown-tegn. Enkle punktlister med «- » er lov når det passer innholdet.',
		'- Ingen innledning («Her er …»), ingen spørsmål, ingen henvendelse til brukeren. Bare selve teksten.',
		'- Hvis samtalen ikke gir noe reelt innhold, returner tom streng.',
		'',
		'Svar alltid som JSON: {"tekst": "<den ferdige teksten>"}'
	].join('\n');
}

/** Bygger meldingene til finaliserings-kallet. Ren funksjon for testbarhet. */
export function buildFinalizeMessages(
	kind: PlanFieldKind,
	thread: PlanFieldThreadMsg[],
	periodLabel?: string
) {
	const transcript = thread
		.map((m) => `${m.role === 'user' ? 'BRUKER' : 'ASSISTENT'}: ${m.text.trim()}`)
		.join('\n\n');
	return [
		{ role: 'system' as const, content: buildSystemPrompt(kind, periodLabel) },
		{ role: 'user' as const, content: transcript }
	];
}

/**
 * Oppsummer og renskriv feltverdien fra en samtaletråd. Faller tilbake til en
 * markdown-renset siste assistent-melding hvis modellkallet feiler.
 */
export async function finalizePlanField(
	kind: PlanFieldKind,
	thread: PlanFieldThreadMsg[] | undefined,
	opts: { periodLabel?: string; model?: string } = {}
): Promise<string> {
	const messages = (thread ?? []).filter((m) => m && typeof m.text === 'string' && m.text.trim());
	if (messages.length === 0) return '';

	const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
	const fallback = markdownToPlain(lastAssistant?.text ?? '');

	try {
		const response = await openai.chat.completions.create({
			// Dette forvalter brukerens egne refleksjoner/notater — nyansert, personlig
			// prosa. Bruk full gpt-4o (som resten av innholds-jobbene), ikke en tynn
			// mini-modell, så vi ikke flater ut stemme og mister dybde. Lav temperatur
			// for å holde oss tett på brukerens egne formuleringer.
			model: opts.model ?? 'gpt-4o',
			temperature: 0.2,
			response_format: { type: 'json_object' },
			messages: buildFinalizeMessages(kind, messages, opts.periodLabel)
		});
		const raw = response.choices[0]?.message?.content ?? '';
		const parsed = JSON.parse(raw) as { tekst?: unknown };
		const text = markdownToPlain(typeof parsed.tekst === 'string' ? parsed.tekst.trim() : '');
		return text || fallback;
	} catch {
		return fallback;
	}
}
