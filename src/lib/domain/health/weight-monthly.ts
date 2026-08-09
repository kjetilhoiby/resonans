/**
 * Månedssnitt for vekt, med provenienser.
 *
 * ## Hvorfor denne finnes
 *
 * «Kan du lage en liste med snittvekt per måned tilbake til 2014 og interpolere der
 * det ikke finnes data?» — et helt rimelig spørsmål, og `query_weight` kunne ikke
 * svare på det. Den gir trend, milepæler og kroppssammensetning, ikke en serie.
 *
 * Modellen sa da at den ikke hadde tilgang til månedsdata, og **fant på tallene**:
 * en jevn rampe fra 104,0 til 98,7 over åtte måneder, hver rad merket
 * «(interpolert)». Ingen av dem var regnet ut av noe. Merkelappen gjorde det verre
 * enn en ren gjetning ville vært — den ga oppspinnet en metode.
 *
 * Historikken fantes hele tiden. Feilen var at ingen hadde gitt modellen en vei til
 * den, og en modell uten vei til svaret finner på et.
 *
 * ## Hvorfor interpolasjonen regnes her, ikke av modellen
 *
 * Brukeren ba om interpolasjon, og det er en legitim forespørsel. Men et interpolert
 * tall og et målt tall ser like ut i et skjermbilde, og i en oppfølging noen uker
 * senere finnes ikke merkelappen lenger. Derfor: regnet i testet kode, aldri av
 * modellen, og hver rad bærer med seg om den er målt eller anslått — og hvor stort
 * hullet er.
 *
 * ## Hva vi ikke gjør
 *
 * **Ingen ekstrapolering.** Serien begynner ved første måling og slutter ved siste.
 * En måned før den første veiingen kan ikke anslås av noe; å strekke serien til 2014
 * fordi noen spurte om 2014 ville vært å oppfylle spørsmålet framfor å svare på det.
 */

import type { WeightDay } from './weight-series';

export interface MonthlyWeight {
	/** `YYYY-MM`. */
	month: string;
	weightKg: number;
	/** Dager med minst én veiing i måneden. 0 på interpolerte rader. */
	days: number;
	source: 'measured' | 'interpolated';
	/**
	 * Bare på interpolerte rader: hvor mange måneder på rad som mangler målinger i
	 * hullet denne raden ligger i. Et anslag midt i et hull på fjorten måneder er
	 * noe annet enn ett som fyller en enkelt måned, og flaten skal kunne si det.
	 */
	gapMonths?: number;
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/** Måneder mellom to `YYYY-MM`-nøkler. */
function monthDistance(from: string, to: string): number {
	const [fy, fm] = from.split('-').map(Number);
	const [ty, tm] = to.split('-').map(Number);
	return (ty - fy) * 12 + (tm - fm);
}

/** `YYYY-MM` n måneder etter `from`. */
function addMonths(from: string, n: number): string {
	const [year, month] = from.split('-').map(Number);
	const total = (year * 12 + (month - 1)) + n;
	const y = Math.floor(total / 12);
	const m = (total % 12) + 1;
	return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/**
 * Dagsverdier → ett snitt per måned, med hull fylt av lineær interpolasjon.
 *
 * Snittet regnes over **dagsverdiene**, ikke over enkeltveiinger: en dag man veide
 * seg fire ganger skal ikke telle fire ganger så mye som en dag med én veiing.
 *
 * `interpolate: false` gir bare månedene som faktisk har målinger — det ærligste
 * svaret når ingen har bedt om anslag.
 */
export function monthlyWeightSeries(
	days: readonly WeightDay[],
	options: { interpolate?: boolean } = {}
): MonthlyWeight[] {
	const interpolate = options.interpolate ?? true;

	const sums = new Map<string, { total: number; days: number }>();
	for (const day of days) {
		if (!Number.isFinite(day.weightKg) || day.weightKg <= 0) continue;
		const month = day.date.slice(0, 7);
		const entry = sums.get(month) ?? { total: 0, days: 0 };
		entry.total += day.weightKg;
		entry.days += 1;
		sums.set(month, entry);
	}

	const measured = [...sums.entries()]
		.sort((a, b) => (a[0] < b[0] ? -1 : 1))
		.map(([month, entry]) => ({
			month,
			weightKg: round1(entry.total / entry.days),
			days: entry.days,
			source: 'measured' as const
		}));

	if (!interpolate || measured.length < 2) return measured;

	const result: MonthlyWeight[] = [];
	for (let i = 0; i < measured.length; i++) {
		result.push(measured[i]);

		const next = measured[i + 1];
		if (!next) break;

		const gap = monthDistance(measured[i].month, next.month) - 1;
		if (gap <= 0) continue;

		// Lineært mellom de to målte nabomånedene. Aldri utenfor dem — se filhodet.
		const step = (next.weightKg - measured[i].weightKg) / (gap + 1);
		for (let k = 1; k <= gap; k++) {
			result.push({
				month: addMonths(measured[i].month, k),
				weightKg: round1(measured[i].weightKg + step * k),
				days: 0,
				source: 'interpolated',
				gapMonths: gap
			});
		}
	}

	return result;
}

export interface MonthlyWeightSummary {
	months: MonthlyWeight[];
	/** Første og siste måned med en ekte måling. */
	measuredFrom: string | null;
	measuredTo: string | null;
	measuredMonths: number;
	interpolatedMonths: number;
	/** Det lengste sammenhengende hullet, i måneder. */
	longestGapMonths: number;
}

/**
 * Serien pluss tallene som gjør den mulig å vurdere.
 *
 * `measuredFrom` er det viktige feltet: ber noen om historikk tilbake til 2014 og
 * første måling er fra oktober 2017, er det svaret — ikke en serie som later som
 * den begynner i 2014.
 */
export function summarizeMonthlyWeights(
	days: readonly WeightDay[],
	options: { interpolate?: boolean } = {}
): MonthlyWeightSummary {
	const months = monthlyWeightSeries(days, options);
	const measured = months.filter((m) => m.source === 'measured');
	const interpolated = months.filter((m) => m.source === 'interpolated');

	return {
		months,
		measuredFrom: measured[0]?.month ?? null,
		measuredTo: measured.at(-1)?.month ?? null,
		measuredMonths: measured.length,
		interpolatedMonths: interpolated.length,
		longestGapMonths: interpolated.reduce((max, m) => Math.max(max, m.gapMonths ?? 0), 0)
	};
}
