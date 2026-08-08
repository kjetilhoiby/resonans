/**
 * Avkryssing i dokumentteksten.
 *
 * Et fortellergrep-notat er refleksjon over håndverk PLUSS et idélager man
 * krysser av etter hvert som idéene brukes i teksten. Lista bor i `body` som
 * vanlig markdown (`- [ ]` / `- [x]`), ikke i en egen tabell.
 *
 * ## Hvorfor ikke en tabell
 *
 * Skrivingen skjer i ett tekstfelt. Et eget avkryssings-UI ville krevd at man
 * bytter modus for å legge til en idé, og innskrivingsfriksjon er den bindende
 * begrensningen i Resonans. Samme grep som `repeatableMeals` (utledet av loggen,
 * ikke lagrede favoritter) og streaks (beregnet on-demand, ingen lagret teller):
 * oppførselen utledes av det som allerede står der.
 *
 * ## Hvorfor «brukt» ikke kan utledes
 *
 * Man kunne latt en scene-tag på grepet bety at idéene er brukt. Det virker
 * ikke: taggen sier at du brukte *grepet*, haken sier at du brukte *den bestemte
 * idéen*. Granulariteten er finere enn taggen. Haken settes derfor for hånd, og
 * vil drifte litt — det er akseptabelt fordi ingenting avhenger av den.
 *
 * ## Dette er ikke oppgaver
 *
 * «Bruk lukt som varsel om at broren har vært der» skal aldri på ukeplanen. Et
 * idélager knyttet til teksten er ikke en gjøremålsliste, og notatblokka eier
 * fortsatt ikke oppgaver.
 */

export interface ChecklistItem {
	/** Teksten etter avkryssingsboksen. */
	text: string;
	checked: boolean;
	/** 0-indeksert linjenummer i `body` — lar en avkryssing skrives tilbake. */
	line: number;
}

export interface ChecklistProgress {
	items: ChecklistItem[];
	total: number;
	done: number;
	/** Andel gjort, 0–1. Null når det ikke finnes noen liste i det hele tatt. */
	ratio: number | null;
}

/**
 * `- [ ] tekst`, `* [x] tekst`, med valgfri innrykk. Store og små x godtas —
 * markdown-editorer er uenige, og en hake som ikke teller er verre enn ingen.
 */
const ITEM_PATTERN = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;

export function parseChecklist(body: string | null | undefined): ChecklistProgress {
	const items: ChecklistItem[] = [];
	const lines = (body ?? '').split('\n');

	for (let i = 0; i < lines.length; i++) {
		const match = ITEM_PATTERN.exec(lines[i]);
		if (!match) continue;
		const text = match[2].trim();
		// En tom boks uten tekst er en halvskrevet linje, ikke en idé.
		if (!text) continue;
		items.push({ text, checked: match[1].toLowerCase() === 'x', line: i });
	}

	const done = items.filter((i) => i.checked).length;
	return {
		items,
		total: items.length,
		done,
		ratio: items.length === 0 ? null : done / items.length
	};
}

/** Idéene som ikke er tatt i bruk ennå — det chatten skal kunne svare på. */
export function unusedIdeas(body: string | null | undefined): string[] {
	return parseChecklist(body)
		.items.filter((i) => !i.checked)
		.map((i) => i.text);
}

/**
 * Setter eller fjerner haken på én linje og returnerer ny `body`.
 *
 * Skriver bare den ene linja om — resten av teksten røres ikke, slik at en
 * avkryssing aldri kan reformatere noe brukeren har skrevet.
 */
export function toggleChecklistItem(
	body: string,
	line: number,
	checked: boolean
): string {
	const lines = body.split('\n');
	if (line < 0 || line >= lines.length) return body;

	const match = ITEM_PATTERN.exec(lines[line]);
	if (!match) return body;

	lines[line] = lines[line].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
	return lines.join('\n');
}
