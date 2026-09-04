/**
 * Vertens minne og last, målt fra innsiden av containeren.
 *
 * ## Hvorfor dette finnes
 *
 * 3. september 2026 sto VPS-en stum i førti minutter. Det tok tre dager å
 * finne årsaken, og den ble til slutt lest ut av `dmesg` på en telefon:
 * maskinen gikk tom for minne, uten swap. Vi målte ingenting selv — null
 * treff på `loadavg`, `/proc/stat` eller minnebruk i hele kodebasen — så
 * diagnosen var en diskusjon i stedet for et oppslag.
 *
 * Underveis ble minne AVSKREVET to ganger, fordi Coolifys graf viste 78 %.
 * Den grafen samplet bort toppen. OOM-killeren var det eneste vitnet som
 * faktisk hadde vært til stede.
 *
 * ## `cached` er tallet som avslører det
 *
 * Ved OOM-tidspunktet var page cachen **1,4 MB**. Det er signaturen på en
 * maskin i fritt fall: kjernen har kastet ut alt som kan kastes ut, og hver
 * prosess må lese sin egen programkode fra disk ved hver page fault. Det er
 * frysen, og det er «CPU-toppen» som ikke var arbeid.
 *
 * `available` alene ville ikke vist det like tydelig — den teller page cache
 * som tilgjengelig. Det er nettopp når cachen ER borte at det er alvor.
 *
 * ## I Docker rapporterer /proc vertens tall
 *
 * Uten lxcfs viser `/proc/meminfo` og `os.loadavg()` HELE maskinen, ikke
 * containeren. Det er ønsket her: spørsmålet er «har boksen nok minne», ikke
 * «hvor mye bruker vi». En container-grense fanges av `docker stats`, som er
 * en annen sak.
 */

export interface HostSample {
	memTotalKb: number;
	memAvailableKb: number;
	memFreeKb: number;
	/** Page cache. Går denne mot null, er maskinen i fritt fall. */
	cachedKb: number;
	swapTotalKb: number;
	swapFreeKb: number;
	load1: number;
	load5: number;
	load15: number;
}

/**
 * Feltene vi leser ut av `/proc/meminfo`.
 *
 * Formatet er `Navn:<mellomrom>tall kB`. Vi leser bare det vi bruker — en
 * generisk parser ville invitert til å lagre alt, og dette skrives hvert
 * minutt i all framtid.
 */
const FIELDS = {
	MemTotal: 'memTotalKb',
	MemAvailable: 'memAvailableKb',
	MemFree: 'memFreeKb',
	Cached: 'cachedKb',
	SwapTotal: 'swapTotalKb',
	SwapFree: 'swapFreeKb'
} as const;

/**
 * Leser `/proc/meminfo`-tekst.
 *
 * Returnerer `null` når de påkrevde feltene mangler — da er vi ikke på Linux,
 * eller formatet har endret seg, og en delvis måling er verre enn ingen: den
 * ville sett ut som ekte data i en graf.
 *
 * NB: `Cached` må matches med ordgrense. `SwapCached` finnes også i fila og
 * ville truffet en løs `startsWith('Cached')`-sjekk i motsatt rekkefølge.
 */
export function parseMeminfo(
	text: string
): Omit<HostSample, 'load1' | 'load5' | 'load15'> | null {
	const out: Record<string, number> = {};

	for (const line of text.split('\n')) {
		const match = /^([A-Za-z_()]+):\s+(\d+)\s*kB$/.exec(line.trim());
		if (!match) continue;
		const key = FIELDS[match[1] as keyof typeof FIELDS];
		if (key) out[key] = Number(match[2]);
	}

	// SwapTotal/SwapFree er 0 på en maskin uten swap — det er en gyldig måling,
	// og faktisk den vi ønsket oss 3. september. Men de må FINNES.
	for (const key of Object.values(FIELDS)) {
		if (typeof out[key] !== 'number') return null;
	}

	return out as Omit<HostSample, 'load1' | 'load5' | 'load15'>;
}

export interface HostVerdict {
	/** Andel av minnet som er tilgjengelig, 0–1. */
	availableShare: number;
	/** Andel av swap som er i bruk, eller null uten swap. */
	swapUsedShare: number | null;
	/** `true` når page cachen er presset ned mot null — maskinen i fritt fall. */
	cacheCollapsed: boolean;
	/** Kort setning som sier hva målingen betyr. */
	summary: string;
}

/**
 * Under dette er page cachen så liten at maskinen thrasher.
 *
 * Målt ved OOM 4. september: 1 388 kB. En frisk boks lå samtidig på ~1,4 GiB.
 * Terskelen er derfor romslig — vi leter etter kollaps, ikke etter travelhet.
 */
export const CACHE_COLLAPSE_KB = 50_000;

/** Under dette er det lite igjen å gi. */
export const LOW_AVAILABLE_SHARE = 0.1;

export function describeHost(s: HostSample): HostVerdict {
	const availableShare = s.memTotalKb > 0 ? s.memAvailableKb / s.memTotalKb : 0;
	const swapUsedShare =
		s.swapTotalKb > 0 ? (s.swapTotalKb - s.swapFreeKb) / s.swapTotalKb : null;
	const cacheCollapsed = s.cachedKb < CACHE_COLLAPSE_KB;

	const pct = Math.round(availableShare * 100);
	const parts: string[] = [`${pct} % av minnet tilgjengelig`];

	if (cacheCollapsed) {
		// Den viktigste setningen i modulen. Sier MEKANISMEN, ikke bare tallet.
		parts.push(
			`page cache nede i ${Math.round(s.cachedKb / 1024)} MB — kjernen har ` +
				'ingenting igjen å frigjøre, og prosesser leser egen kode fra disk'
		);
	}

	if (s.swapTotalKb === 0) {
		parts.push('ingen swap: maskinen går fra trangt rett i OOM');
	} else if (swapUsedShare != null && swapUsedShare > 0.5) {
		parts.push(`swap ${Math.round(swapUsedShare * 100)} % brukt`);
	}

	return { availableShare, swapUsedShare, cacheCollapsed, summary: parts.join('; ') };
}
