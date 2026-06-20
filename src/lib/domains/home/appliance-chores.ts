/**
 * Apparat-husarbeid: hvilke gjøremål en ferdig apparat-syklus impliserer.
 *
 * Husarbeidet havner IKKE i dagslista automatisk — det samles i et eget
 * chores-view på hjem-temaet (checklist med context 'home_chores'). Derfra
 * kan man hake av (= registrert fullført) eller «ta» en syklus inn i dagslista.
 *
 * Telling på hjem: «brutto sannsynlige oppgaver» (alt apparatet genererte) vs.
 * «registrerte fullførte» (avkrysset) — et balanse-signal for hvem som gjør hva.
 */

/** Katalog: normalisert apparatnøkkel → impliserte gjøremål. */
export const APPLIANCE_CHORES: Record<string, string[]> = {
	vaskemaskin: ['Tøm vaskemaskin', 'Heng opp klær'],
	oppvaskmaskin: ['Tøm oppvaskmaskin'],
	tørketrommel: ['Tøm tørketrommel', 'Brett og legg vekk klær']
};

/** Strip enkel norsk bøyning så «Vaskemaskinen» matcher «vaskemaskin». */
export function normalizeApplianceName(name: string): string {
	return name.toLowerCase().trim().replace(/en$/, '').replace(/a$/, '');
}

/**
 * «chore: …»-prefiks markerer at en oppgave eies av husarbeid-budsjettet
 * (samme konvensjon som «kjøp:»). Returnerer flagget + teksten uten prefiks.
 * Brukes for rutine- og dagsoppgaver som skal telle i brutto-vs-fullført.
 */
export function parseChorePrefix(text: string): { chore: boolean; text: string } {
	const match = /^\s*chore:\s*/i.exec(text);
	if (!match) return { chore: false, text };
	return { chore: true, text: text.slice(match[0].length).trim() };
}

/** Returner gjøremål for et apparatnavn, eller tom liste om ingen match. */
export function choresForAppliance(appliance: string): string[] {
	const key = normalizeApplianceName(appliance);
	const matched = Object.entries(APPLIANCE_CHORES).find(([k]) => key.includes(k));
	return matched ? matched[1] : [];
}

export interface ChoreCountItem {
	checked: boolean;
	createdAt: Date | string;
}

export interface ChoreStats {
	/** Brutto sannsynlige oppgaver generert i vinduet. */
	gross: number;
	/** Registrerte fullførte (avkrysset) i vinduet. */
	completed: number;
	windowDays: number;
}

/**
 * Tell brutto vs. fullført over et rullerende vindu (default 7 dager),
 * basert på når hvert husarbeid ble generert (createdAt).
 */
export function computeChoreStats(
	items: ChoreCountItem[],
	windowDays = 7,
	now: Date = new Date()
): ChoreStats {
	const cutoff = now.getTime() - windowDays * 86_400_000;
	let gross = 0;
	let completed = 0;
	for (const item of items) {
		const t = new Date(item.createdAt).getTime();
		if (Number.isNaN(t) || t < cutoff) continue;
		gross += 1;
		if (item.checked) completed += 1;
	}
	return { gross, completed, windowDays };
}
