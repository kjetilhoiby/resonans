/**
 * temperature.ts — to temperatursignaler som ALDRI skal slås sammen.
 *
 * ## Hvorfor to
 *
 * Vi har to kilder, og de måler ikke det samme:
 *
 *  - **Termometeret** (Withings Thermo, wifi) leser tinningsarterien og er
 *    kalibrert mot KJERNETEMPERATUR. 38,9 er et absolutt tall du ville sagt til en
 *    lege.
 *  - **Klokka** (ScanWatch-familien) måler HUDTEMPERATUR på håndleddet,
 *    kontinuerlig-ish. Den ligger flere grader under kjernen — 33–35 er normalt —
 *    og det absolutte tallet betyr ingenting. Bare avviket fra ditt eget snitt
 *    gjør det.
 *
 * **Slås de sammen, får du en serie der 34,2 og 38,9 står side om side, og hver
 * terskel eller trend over den er tull.** Det er nøyaktig samme felle som
 * `hr_min` mot `hr_average` (snittpuls ligger 5–10 slag over hvilepuls, og
 * signalet leste feil felt i et halvt år), og som meastype 6 mot 8 (fettPROSENT
 * lagret som `fatMass` og lest som kilo). Begge kostet en gal visning i prod.
 * Derfor er kilden en del av datatypen her, ikke et valgfritt metadatafelt.
 *
 * ## Hudtemperatur leses som HRV, ikke som vekt
 *
 * Retningen er den samme som for HRV og sovepuls: **siste måling mot din egen
 * baseline**, ikke beste observasjon (som for VO2max og pulsfall, der begge
 * forutsetter maksimal innsats). Et absolutt hudtemperaturtall vises ALDRI alene
 * — det finnes ingen normtabell for håndleddstemperatur, og tallet ser
 * autoritativt ut uten å være det.
 *
 * ## Vi sier ikke «feber»
 *
 * Ingen terskler, ingen klassifisering. Det øyeblikket kode kaller 38,5 for feber,
 * har vi diagnostisert — og vi måler ikke kroppen, vi leser av en sensor brukeren
 * har på seg. Vi lagrer tallet, tegner det, og lar brukeren og legen tolke det.
 * Samme linje som «vi måler skjermen, ikke brukeren» og «ingen påstander om
 * blodsukker».
 */

/**
 * Withings-måletypene, og hvilken av de to størrelsene hver av dem er.
 *
 * **Kartet er en HYPOTESE til vi har sett data.** Withings dokumenterer 12 som
 * «Temperature», 71 som «Body Temperature» og 73 som «Skin Temperature», men
 * hvilken enhet som faktisk poster hvilken type er ikke noe vi kan lese ut av
 * dokumentasjonen — samme situasjon som meastype 123 var i før den ble
 * kryssjekket mot appen. Synken logger derfor hva som kom inn per type, og
 * plausibilitetsgrensene under avviser en verdi som havner i feil bøtte framfor
 * å vise den. Ikke bygg tolkning på dette kartet før loggen har bekreftet det.
 */
export const WITHINGS_TEMPERATURE_MEASTYPES = {
	/** «Temperature» — generisk. Behandles som kjerne. */
	temperature: 12,
	/** «Body Temperature» — Thermo. */
	bodyTemperature: 71,
	/** «Skin Temperature» — klokka. */
	skinTemperature: 73
} as const;

export type TemperatureKind = 'core' | 'skin';

export function kindForMeastype(meastype: number): TemperatureKind | null {
	if (meastype === WITHINGS_TEMPERATURE_MEASTYPES.skinTemperature) return 'skin';
	if (
		meastype === WITHINGS_TEMPERATURE_MEASTYPES.bodyTemperature ||
		meastype === WITHINGS_TEMPERATURE_MEASTYPES.temperature
	) {
		return 'core';
	}
	return null;
}

/**
 * Plausibilitetsgrenser i °C, per størrelse.
 *
 * Spennene OVERLAPPER rundt 36, og det er derfor `meastype` er primærnøkkelen og
 * dette bare et sikkerhetsnett: en verdi kan ikke klassifiseres av tallet alene.
 * Nettet fanger den åpenbare feilen — en Fahrenheit-verdi (98,6) eller en
 * romtemperatur (21) — ikke en forveksling mellom de to.
 */
export const TEMPERATURE_LIMITS: Record<TemperatureKind, { min: number; max: number }> = {
	// Under 30 er man ikke i live med klokka på; over 43 finnes ikke.
	core: { min: 30, max: 43 },
	// Håndleddet er kaldere enn kjernen, og kan bli riktig kaldt utendørs.
	skin: { min: 20, max: 40 }
};

export function isPlausibleTemperature(kind: TemperatureKind, celsius: number): boolean {
	const limits = TEMPERATURE_LIMITS[kind];
	return Number.isFinite(celsius) && celsius >= limits.min && celsius <= limits.max;
}

/**
 * Under dette er avviket støy.
 *
 * Hudtemperatur på håndleddet svinger med romtemperatur, sengetøy og hvor stramt
 * remma sitter. 0,3 °C er valgt som gulv fordi det er mindre enn de utslagene som
 * er verdt å se på, og større enn døgnvariasjonen i en rolig natt. Under gulvet
 * sier flaten «som vanlig» framfor å tegne en piknok.
 */
export const SKIN_NOISE_C = 0.3;

/** Netter som kreves før en hudtemperatur-baseline regnes. Som HRV. */
export const MIN_SKIN_BASELINE_NIGHTS = 7;

export interface TemperatureReading {
	/** Dagsnøkkel, 'YYYY-MM-DD'. */
	date: string;
	celsius: number;
}

export interface CoreTemperatureSummary {
	/** Alle målinger, eldste først. Absolutte tall — de betyr noe. */
	readings: TemperatureReading[];
	latest: TemperatureReading | null;
	/** Høyeste måling i vinduet, med dato. Det er tallet et forløp huskes ved. */
	highest: TemperatureReading | null;
}

export interface SkinTemperatureSummary {
	readings: TemperatureReading[];
	latest: TemperatureReading | null;
	/** Median over vinduet UTENOM siste måling. Null under minstekravet. */
	baselineC: number | null;
	baselineNights: number;
	/** Siste minus baseline. Positivt = varmere enn vanlig. Null uten baseline. */
	deviationC: number | null;
	/** 'over'/'under' først utenfor støygulvet. */
	band: 'over' | 'normal' | 'under' | 'ukjent';
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function summarizeCoreTemperature(
	readings: readonly TemperatureReading[]
): CoreTemperatureSummary {
	const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
	if (sorted.length === 0) return { readings: [], latest: null, highest: null };

	// Høyeste, og ved likhet den SENESTE — den er den som beskriver nå.
	const highest = sorted.reduce((best, r) => (r.celsius >= best.celsius ? r : best), sorted[0]);
	return { readings: sorted, latest: sorted[sorted.length - 1], highest };
}

/**
 * Siste hudtemperatur mot ditt eget snitt.
 *
 * Baselinen regnes **uten** siste måling, av samme grunn som i `sleep-heart-rate`
 * og `hrv`: hadde den vært med, ville en avvikende natt dratt snittet mot seg selv
 * og dempet sitt eget avvik. Median framfor snitt — én natt med dårlig hudkontakt
 * skal ikke flytte grunnlinja.
 */
export function summarizeSkinTemperature(
	readings: readonly TemperatureReading[]
): SkinTemperatureSummary {
	const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
	if (sorted.length === 0) {
		return {
			readings: [],
			latest: null,
			baselineC: null,
			baselineNights: 0,
			deviationC: null,
			band: 'ukjent'
		};
	}

	const latest = sorted[sorted.length - 1];
	const earlier = sorted.slice(0, -1);

	if (earlier.length < MIN_SKIN_BASELINE_NIGHTS) {
		return {
			readings: sorted,
			latest,
			baselineC: null,
			baselineNights: earlier.length,
			deviationC: null,
			band: 'ukjent'
		};
	}

	const baselineC = round1(median(earlier.map((r) => r.celsius)));
	const deviationC = round1(latest.celsius - baselineC);

	return {
		readings: sorted,
		latest,
		baselineC,
		baselineNights: earlier.length,
		deviationC,
		band:
			deviationC > SKIN_NOISE_C ? 'over' : deviationC < -SKIN_NOISE_C ? 'under' : 'normal'
	};
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

const fmt = (v: number) => v.toFixed(1).replace('.', ',');

/**
 * «38,9 °C (målt 2. sep)». Absolutt, uten en dom.
 *
 * Ingen «feber», ingen farge, ingen anbefaling — se modulkommentaren.
 */
export function describeCoreTemperature(summary: CoreTemperatureSummary): string | null {
	if (!summary.latest) return null;
	const base = `${fmt(summary.latest.celsius)} °C`;
	if (summary.highest && summary.highest.date !== summary.latest.date) {
		return `${base} (høyeste i perioden ${fmt(summary.highest.celsius)} °C)`;
	}
	return base;
}

/**
 * «0,6 °C over ditt eget snitt» — aldri det absolutte hudtallet alene.
 *
 * Mangler baselinen, sier setningen HVORFOR framfor å vise et tall uten mening.
 */
export function describeSkinTemperature(summary: SkinTemperatureSummary): string | null {
	if (!summary.latest) return null;
	if (summary.deviationC === null) {
		const left = MIN_SKIN_BASELINE_NIGHTS - summary.baselineNights;
		return `Hudtemperatur fra klokka målt, men ${left} ${left === 1 ? 'natt' : 'netter'} til før et avvik kan regnes`;
	}
	if (summary.band === 'normal') return 'Hudtemperatur som vanlig';
	const dir = summary.deviationC > 0 ? 'over' : 'under';
	return `Hudtemperatur ${fmt(Math.abs(summary.deviationC))} °C ${dir} ditt eget snitt`;
}
