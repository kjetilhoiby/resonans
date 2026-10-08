/**
 * Modellversjonen av hjemskjermens brev — PROTOTYPE, vist side om side med den
 * regelbaserte på /brev. Se `docs/changelog/2026-10-06-brev-prototype.md`, fase 6.
 *
 * Arbeidsdelingen er hele poenget: REGLENE avgjør hva som er sant og hva som er
 * viktig (`buildHomeLetter`), MODELLEN skriver bare bindevevet. Brukeren pekte på
 * at den regelbaserte teksten gjentar seg — «På dagens tempo er du der rundt …»
 * fire ganger — og det er en skrivejobb, ikke en regnejobb. Lot vi modellen
 * velge fakta selv, ville vi gjeninnført feilen repoet har brukt to måneder på
 * å fjerne: et tall i chatten som ikke stemmer med skjermen.
 *
 * Derfor får modellen bare linjene brevet alt har valgt, og `unknownNumbers`
 * sjekker etterpå at hvert tall i teksten står i fakta. Et tall som ikke gjør
 * det, er enten en regnefeil eller en oppfinnelse, og flaten sier fra.
 *
 * Ingen backticks i prompt-tekstene: de limes inn i et kall.
 */

import type { HomeLetter, LetterSection } from '$lib/domain/home-letter';
import { SECTION_TITLES } from '$lib/domain/home-letter';

/** Bumpes når prompten endres, så lagrede brev skrives på nytt. */
export const HOME_LETTER_PROMPT_VERSION = 1;

export const HOME_LETTER_SYSTEM_PROMPT = [
	'Du skriver morgenbrevet til en bruker av Resonans, en personlig coach. Du får hilsenen og en liste med fakta som reglene allerede har valgt ut og sortert, viktigst først.',
	'',
	'Skriv brevet som sammenhengende prosa på norsk bokmål, i andre person (du). Tre til seks korte avsnitt, til sammen høyst 120 ord. Ingen overskrifter, ingen punktlister, ingen fet skrift.',
	'',
	'Regler som ikke kan brytes:',
	'- Bruk BARE fakta i lista. Ikke legg til tall, datoer, mål, råd eller forklaringer som ikke står der.',
	'- Gjengi tall og datoer nøyaktig slik de står. Ikke rund av, ikke regn om, ikke regn ut nye tall.',
	'- Bruk brukerens egne navn på mål og punkter.',
	'- Ingen påstander om helse eller kropp utover det som står.',
	'',
	'Slik skal det leses:',
	'- Slå sammen det som hører sammen, og ikke gjenta samme formulering. Står flere mål med «på dagens tempo», si det én gang.',
	'- Et delmål og hovedmålet hører sammen: si dem i samme avsnitt.',
	'- Begynn med hilsenen. Ikke avslutt med et spørsmål, en oppfordring eller en oppsummering.',
	'- Ingen ros og ingen utropstegn. Tonen er rolig og saklig, som en lapp fra noen som kjenner deg.',
	'- Det du må utelate fordi det ikke får plass, utelater du — men aldri målene.'
].join('\n');

const SECTION_ORDER: LetterSection[] = ['maal', 'uka', 'trader', 'registrering', 'ellers'];

/** Faktaene modellen får, gruppert som i brevet. Samme tekst som hashes. */
export function letterFactsText(letter: HomeLetter): string {
	const parts = [`Hilsen: ${letter.greeting}`];
	for (const section of SECTION_ORDER) {
		const lines = letter.lines.filter((l) => l.section === section);
		if (lines.length === 0) continue;
		parts.push('', `${SECTION_TITLES[section]}:`, ...lines.map((l) => `- ${l.text}`));
	}
	return parts.join('\n');
}

/**
 * Tallene i en tekst, normalisert: tusenskille fjernes («1 950» → «1950»),
 * desimalkomma og -punktum er like. Et tall i prosaen som ikke finnes her i
 * faktaene, er nytt.
 */
export function extractNumbers(text: string): string[] {
	const matches = text.match(/\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
	return matches.map((m) => m.replace(/[  ]/g, '').replace('.', ','));
}

/** Tallene modellen skrev som ikke står i faktaene. Tom liste betyr at teksten holder. */
export function unknownNumbers(prose: string, facts: string): string[] {
	const known = new Set(extractNumbers(facts));
	return [...new Set(extractNumbers(prose).filter((n) => !known.has(n)))];
}

/** Avsnittene i modellteksten, for visning. */
export function proseParagraphs(prose: string): string[] {
	return prose
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
		.filter((p) => p.length > 0);
}
