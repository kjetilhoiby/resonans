/**
 * Hurtigsvar for hands-free Ekko-bruker.
 *
 * Når en seer skriver på den delte posisjonen, kan løperen i Ekko sykle/kjøre og
 * verken skrive eller snakke — bare «nikke eller riste på hodet». Vi mapper derfor
 * enhver innkommende melding til et *binært* svarsett: to korte svar som dekker de
 * to naturlige reaksjonene. Vi antar ikke at meldingen alltid er et ja/nei-spørsmål
 * («kan du hente i barnehagen?» → Ja/Nei, men «jeg kan hente» → OK, takk!/Nei takk).
 *
 * Normaliseringen er DB- og LLM-fri slik at den kan enhetstestes uten mocking;
 * selve LLM-kallet ligger i `parseBinaryReplyOptions`.
 */

import { openai } from '$lib/server/openai';

// Hvert svarforslag holdes kort nok til en hands-free knapp i Ekko.
export const MAX_REPLY_LEN = 24;
// Alltid nøyaktig to forslag (binært valg) — ellers ingen.
export const REPLY_OPTION_COUNT = 2;

export interface ReplyIntent {
	/** Nøyaktig to korte svar, eller tom liste når meldingen ikke trenger svar. */
	replies: string[];
}

/**
 * Normaliserer rå LLM-output til et gyldig binært svarsett. Trimmer, kapper
 * lengde, fjerner tomme/duplikate, og krever nøyaktig to unike svar — ellers
 * returneres tom liste (ingen knapper).
 */
export function normalizeReplyOptions(raw: unknown): string[] {
	const input = (raw ?? {}) as Record<string, unknown>;

	if (input.needsReply === false) return [];

	const rawReplies = Array.isArray(input.replies) ? input.replies : [];
	const seen = new Set<string>();
	const cleaned: string[] = [];

	for (const item of rawReplies) {
		if (typeof item !== 'string') continue;
		const trimmed = item.trim().slice(0, MAX_REPLY_LEN).trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		cleaned.push(trimmed);
	}

	// Binært valg: enten nøyaktig to forslag, eller ingen.
	return cleaned.length === REPLY_OPTION_COUNT ? cleaned : [];
}

/**
 * Parser en innkommende seer-melding til et binært hurtigsvarsett for Ekko.
 * Feiler trygt til tom liste (ingen knapper) ved LLM-/parse-feil, slik at
 * meldingen alltid kan sendes uavhengig av intent-parsingen.
 */
export async function parseBinaryReplyOptions(rawText: string): Promise<ReplyIntent> {
	const text = rawText.trim();
	if (!text) return { replies: [] };

	const prompt = `Mottakeren leser denne meldingen i en app mens hen sykler eller kjører bil, og kan verken skrive eller snakke — bare velge mellom to forhåndslagde svar (som å nikke eller riste på hodet).

Meldingen fra avsenderen:
"${text}"

Oppgave: foreslå nøyaktig to korte svar som dekker de to naturlige reaksjonene på meldingen. Ikke anta at det alltid er et ja/nei-spørsmål — map til det som passer:
- Spørsmål («kan du hente i barnehagen?») → typisk Ja / Nei (gjerne med kort kontekst: «Ja, jeg henter» / «Nei, går ikke»).
- Tilbud eller utsagn («jeg kan hente i barnehagen») → en bekreftelse og en avkreftelse («Ja takk!» / «Nei, jeg tar det»).
- Ren oppmuntring/heiarop uten noe å svare på («Heia!», «Stå på!») → ingen svar (needsReply=false).

Krav til svarene:
- Maks ${MAX_REPLY_LEN} tegn hver, naturlig norsk, fra mottakerens perspektiv.
- De to svarene skal være tydelig forskjellige reaksjoner (ikke to varianter av «ja»).

Returner kun JSON:
{
  "needsReply": true|false,
  "replies": ["svar 1", "svar 2"]
}`;

	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			temperature: 0.3,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: 'Du foreslår korte hurtigsvar for en hands-free bruker. Returner alltid valid JSON og ingen markdown.'
				},
				{ role: 'user', content: prompt }
			]
		});

		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content);
		return { replies: normalizeReplyOptions(parsed) };
	} catch {
		return { replies: [] };
	}
}
