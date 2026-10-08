/**
 * Modellversjonen av hjemskjermens brev — PROTOTYPE, vist side om side med den
 * regelbaserte på /brev. Se `docs/changelog/2026-10-06-brev-prototype.md`,
 * fase 6 og 7.
 *
 * Arbeidsdelingen er hele poenget: REGLENE avgjør hva som er sant og hva som er
 * viktig (`buildHomeLetter`), MODELLEN skriver bindevevet. Lot vi modellen
 * velge fakta selv, ville vi gjeninnført feilen repoet har brukt to måneder på
 * å fjerne: et tall i chatten som ikke stemmer med skjermen.
 *
 * Fase 7 (8. oktober 2026). Første utgave fikk bare de ferdige setningene, og
 * da kan en modell bare lime: den skrev de samme setningene med kolon imellom,
 * kuttet «Uka» og «Registrering» uten å si fra for å holde ordtaket, og mistet
 * lenkene som gjorde regelbrevet til en inngang. Nå:
 *
 * - Hver linje får en BOKSTAV-id og tallene bak seg (`LetterLine.facts`), så
 *   modellen ser at to delmål hører til samme hovedmål og kan si det én gang.
 * - Modellen merker de klikkbare ordene selv: `[Løpe 600 km](#a)`. Flaten gjør
 *   dem til uthevede lenker til linjens `href`, så teksten kan flyte og likevel
 *   ha tydelige handlinger. En ukjent id blir vanlig tekst.
 * - Linjer teksten aldri lenker til, er UTELATT, og flaten sier det. En
 *   seksjon som forsvinner stille var det verste ved første utgave.
 *
 * Id-ene er bokstaver, ikke tall, med vilje: tallvakten leter etter tall i
 * teksten, og `(#3)` ville både vært et tall modellen «fant på» og et tall i
 * faktaene som skjulte et ekte oppfunnet 3-tall.
 *
 * Ingen backticks i prompt-tekstene: de limes inn i et kall.
 */

import type { HomeLetter, LetterLine, LetterSection } from '$lib/domain/home-letter';
import { SECTION_TITLES } from '$lib/domain/home-letter';

/** Bumpes når prompten eller faktaformen endres, så lagrede brev skrives på nytt. */
export const HOME_LETTER_PROMPT_VERSION = 2;

export const HOME_LETTER_SYSTEM_PROMPT = [
	'Du skriver morgenbrevet til en bruker av Resonans, en personlig coach. Du får hilsenen og en liste med punkter som reglene allerede har valgt ut og sortert, viktigst først. Hvert punkt har en id i hakeparentes, en ferdig setning, og ofte tallene bak setningen.',
	'',
	'Skriv brevet som sammenhengende prosa på norsk bokmål, i andre person (du). Tre til seks korte avsnitt, til sammen høyst 170 ord. Ingen overskrifter, ingen punktlister, ingen fet skrift.',
	'',
	'Lenker:',
	'- Merk de ordene brukeren kan trykke på med [ord](#id), der id er punktets id. Eksempel: Du ligger godt an mot [Løpe 600 km](#a).',
	'- Lenk et kort uttrykk på ett til fem ord som er TINGEN brukeren går videre til: målets navn, punktet på lista, arrangementet. Ikke lenk hele setninger, ikke tall alene.',
	'- Hvert punkt skal ha minst én lenke. Slår du sammen flere punkter i én setning, lenk hvert av dem.',
	'- Bruk bare id-er som står i lista.',
	'',
	'Regler som ikke kan brytes:',
	'- Bruk BARE fakta i lista. Ikke legg til tall, datoer, mål, råd eller forklaringer som ikke står der.',
	'- Gjengi tall og datoer nøyaktig slik de står. Ikke rund av, ikke regn om, ikke regn ut nye tall.',
	'- Bruk brukerens egne navn på mål og punkter.',
	'- Ingen påstander om helse eller kropp utover det som står.',
	'',
	'Slik skal det leses:',
	'- Ta med ALLE punktene. Status kan sies kort, men ingen del av lista skal forsvinne.',
	'- Et delmål og hovedmålet det er del av hører sammen: si dem i samme avsnitt, og si en felles ting om dem én gang i stedet for å gjenta den per delmål.',
	'- Slå sammen det som hører sammen, og ikke gjenta samme formulering. Står flere mål med «på dagens tempo», si det én gang.',
	'- Begynn med hilsenen. Ikke avslutt med et spørsmål, en oppfordring eller en oppsummering.',
	'- Ingen ros og ingen utropstegn. Tonen er rolig og saklig, som en lapp fra noen som kjenner deg.'
].join('\n');

const SECTION_ORDER: LetterSection[] = ['maal', 'uka', 'trader', 'registrering', 'ellers'];

/** Bokstav-id-ene, i lesrekkefølge. Brevet har høyst 17 linjer (`SECTION_CAPS`). */
const REF_IDS = 'abcdefghijklmnopqrstuvwxyz';

export interface ProseInput {
	/** Teksten modellen får. Den samme teksten hashes og tallvakten leser. */
	text: string;
	/** Bokstav-id → linja den peker på. */
	refs: ReadonlyMap<string, LetterLine>;
}

/** Faktaene modellen får, gruppert som i brevet, med en bokstav-id per linje. */
export function buildProseInput(letter: HomeLetter): ProseInput {
	const refs = new Map<string, LetterLine>();
	const parts = [`Hilsen: ${letter.greeting}`];
	let index = 0;
	for (const section of SECTION_ORDER) {
		const lines = letter.lines.filter((l) => l.section === section);
		if (lines.length === 0) continue;
		parts.push('', `${SECTION_TITLES[section]}:`);
		for (const line of lines) {
			const ref = REF_IDS[index++];
			if (!ref) break;
			refs.set(ref, line);
			parts.push(`[${ref}] ${line.text}`);
			for (const [key, value] of line.facts ?? []) parts.push(`    ${key}: ${value}`);
		}
	}
	return { text: parts.join('\n'), refs };
}

/** Et stykke av et avsnitt: vanlig tekst, eller en lenke til en linje i brevet. */
export type ProseSegment = { text: string } | { text: string; ref: string; href: string | null };

/**
 * Avsnittene, med lenkene løst opp mot linjene. En id som ikke finnes blir
 * vanlig tekst — modellen skal ikke kunne lage en lenke til noe reglene ikke
 * valgte. En linje uten `href` blir en uthevelse uten lenke.
 */
export function parseProse(prose: string, refs: ReadonlyMap<string, LetterLine>): ProseSegment[][] {
	return prose
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
		.filter((p) => p.length > 0)
		.map((paragraph) => {
			const segments: ProseSegment[] = [];
			const pattern = /\[([^\]\n]+)\]\(#([a-z])\)/g;
			let last = 0;
			for (const match of paragraph.matchAll(pattern)) {
				const at = match.index ?? 0;
				if (at > last) segments.push({ text: paragraph.slice(last, at) });
				const line = refs.get(match[2]);
				segments.push(line ? { text: match[1], ref: match[2], href: line.href ?? null } : { text: match[1] });
				last = at + match[0].length;
			}
			if (last < paragraph.length) segments.push({ text: paragraph.slice(last) });
			return segments;
		});
}

/** Teksten uten lenkemerking, slik den leses. Tallvakten går på denne. */
export function plainProse(paragraphs: readonly ProseSegment[][]): string {
	return paragraphs.map((p) => p.map((s) => s.text).join('')).join('\n\n');
}

/** Linjene teksten aldri lenker til, i brevets rekkefølge. */
export function omittedLines(paragraphs: readonly ProseSegment[][], refs: ReadonlyMap<string, LetterLine>): LetterLine[] {
	const used = new Set(paragraphs.flat().flatMap((s) => ('ref' in s ? [s.ref] : [])));
	return [...refs].filter(([ref]) => !used.has(ref)).map(([, line]) => line);
}

/**
 * Tallene i en tekst, normalisert: tusenskille fjernes («1 950» → «1950»),
 * desimalkomma og -punktum er like. Et tall i prosaen som ikke finnes her i
 * faktaene, er nytt.
 */
export function extractNumbers(text: string): string[] {
	const matches = text.match(/\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g) ?? [];
	return matches.map((m) => m.replace(/[  ]/g, '').replace('.', ','));
}

/** Tallene modellen skrev som ikke står i faktaene. Tom liste betyr at teksten holder. */
export function unknownNumbers(prose: string, facts: string): string[] {
	const known = new Set(extractNumbers(facts));
	return [...new Set(extractNumbers(prose).filter((n) => !known.has(n)))];
}
