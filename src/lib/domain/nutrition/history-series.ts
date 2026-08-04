/**
 * Dag-for-dag-serien bak historikken: inn, ut og vekt på samme datoakse.
 *
 * ## Hvorfor ikke ett diagram med to akser
 *
 * Ønsket var «kalorier inn/ut som søyler og med vekt som overlay». Vekt (~100 kg) og
 * energi (~2 500 kcal) har ingen felles skala, så en overlay krever to y-akser — og
 * da bestemmer *valget av skala* hvilken av kurvene som ser ut å lede. Man kan få
 * vekta til å «forklare» underskuddet eller motsi det ved å endre et tall ingen ser.
 *
 * Løsningen er to diagrammer over hverandre med **samme datoakse**: søylene øverst,
 * vekta rett under. Man skanner nedover en dato og ser begge, uten at noen skala har
 * valgt en fortelling.
 *
 * ## Hull er data
 *
 * Dager uten logg får `intakeKcal: null`, ikke 0. En dag man glemte å logge er ikke
 * en dag man ikke spiste, og en null-søyle ville sett ut som faste. Samme for vekt:
 * vekta måles ikke daglig, og serien skal vise hull framfor å interpolere.
 *
 * ## Én forbrukskilde for hele serien
 *
 * Forbruket kan komme fra vårt eget anslag eller fra Withings, og de to er ikke
 * enige. Blandet i samme serie ville et kildebytte midt i vinduet sett ut som en
 * endring i forbruket. Kallstedet velger **én** kilde for hele serien og sier
 * hvilken; se `expenditureSource` i nutrition-dashboard.
 */

export interface HistoryDay {
	date: string;
	/** Logget inntak. Null når dagen ikke er logget. */
	intakeKcal: number | null;
	/** Anslått forbruk. Null når det mangler. */
	expenditureKcal: number | null;
	/** Vekt målt denne dagen. Null når den ikke ble målt. */
	weightKg: number | null;
	/** Inn minus ut. Null når en av sidene mangler. */
	balanceKcal: number | null;
	/**
	 * Dagen er ikke omme. Inntaket er «så langt», forbruket er for hele døgnet, og
	 * søylene er derfor ikke sammenlignbare — samme feilen `frameDay` retter i
	 * dagskortet. Flaten skal merke dagen, ikke skjule den.
	 */
	partial: boolean;
}

export interface HistorySeries {
	days: HistoryDay[];
	/** Høyeste kcal-verdi i serien, til søylehøyden. Null for tom serie. */
	maxKcal: number | null;
	/** Vektspennet, til linjediagrammet. Null når under to målinger. */
	weightRange: { min: number; max: number } | null;
	/** Dager med logget inntak. */
	loggedDays: number;
}

/**
 * Bygger serien for et vindu bakover, eldste først.
 *
 * `days` er antall dager inkludert i dag. Datoene fylles ut selv om det ikke finnes
 * data — et hull midt i serien skal være synlig som et hull, og det krever at dagen
 * finnes i lista.
 */
export function buildHistorySeries(input: {
	/** Siste dag i serien, som `YYYY-MM-DD`. */
	endDate: string;
	days: number;
	intakeByDate: Record<string, number>;
	expenditureByDate: Record<string, number>;
	weightByDate: Record<string, number>;
	/** Dagen som ennå ikke er omme, som `YYYY-MM-DD`. Vanligvis i dag. */
	partialDate?: string;
}): HistorySeries {
	const { endDate, intakeByDate, expenditureByDate, weightByDate, partialDate } = input;
	const days = Math.max(1, Math.min(90, input.days));

	const endMs = Date.parse(`${endDate}T00:00:00Z`);
	if (!Number.isFinite(endMs)) {
		return { days: [], maxKcal: null, weightRange: null, loggedDays: 0 };
	}

	const rows: HistoryDay[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const date = new Date(endMs - i * 86_400_000).toISOString().slice(0, 10);
		const intakeKcal = num(intakeByDate[date]);
		const expenditureKcal = num(expenditureByDate[date]);
		rows.push({
			date,
			intakeKcal,
			expenditureKcal,
			weightKg: num(weightByDate[date]),
			balanceKcal:
				intakeKcal === null || expenditureKcal === null
					? null
					: Math.round(intakeKcal - expenditureKcal),
			partial: date === partialDate
		});
	}

	const kcalValues = rows.flatMap((row) =>
		[row.intakeKcal, row.expenditureKcal].filter((v): v is number => v !== null)
	);
	const weights = rows.map((row) => row.weightKg).filter((v): v is number => v !== null);

	return {
		days: rows,
		maxKcal: kcalValues.length > 0 ? Math.max(...kcalValues) : null,
		weightRange:
			weights.length >= 2 ? { min: Math.min(...weights), max: Math.max(...weights) } : null,
		loggedDays: rows.filter((row) => row.intakeKcal !== null).length
	};
}

/**
 * Vektpunktene som skal tegnes, med posisjon langs samme akse som søylene.
 *
 * `x` er 0–1 over hele vinduet, slik at et punkt havner over sin egen dato selv når
 * dager mangler. Returnerer tom liste under to punkter — én prikk er ingen kurve.
 */
export function weightPointsForChart(
	series: HistorySeries
): Array<{ x: number; y: number; date: string; kg: number }> {
	const range = series.weightRange;
	if (!range || series.days.length < 2) return [];

	const span = range.max - range.min;
	return series.days.flatMap((day, index) => {
		if (day.weightKg === null) return [];
		return [
			{
				x: series.days.length === 1 ? 0.5 : index / (series.days.length - 1),
				// 0 nederst. Flat serie legges midt i feltet framfor å dele på null.
				y: span === 0 ? 0.5 : (day.weightKg - range.min) / span,
				date: day.date,
				kg: day.weightKg
			}
		];
	});
}

/**
 * Hvor langt en linje får strekke seg over dager uten måling.
 *
 * Vekta måles ikke daglig, og å bryte linja ved hvert hull ville gjort den til
 * løse prikker. Men en rett strek over ti dager *påstår* en jevn utvikling ingen
 * har målt — særlig i den ene retningen man håper på. Tre dager er kort nok til at
 * streken er en tegnekonvensjon, ikke en påstand.
 */
export const MAX_WEIGHT_GAP_DAYS = 3;

/**
 * Vektpunktene delt i linjestykker, med hull der målingene er for langt unna
 * hverandre. Punkter uten nabo innen `MAX_WEIGHT_GAP_DAYS` blir enkeltpunkter og
 * skal tegnes som prikk.
 */
export function weightSegments(
	series: HistorySeries,
	maxGapDays: number = MAX_WEIGHT_GAP_DAYS
): Array<Array<{ x: number; y: number; date: string; kg: number }>> {
	const points = weightPointsForChart(series);
	if (points.length === 0) return [];

	const segments: Array<Array<{ x: number; y: number; date: string; kg: number }>> = [];
	let current = [points[0]];

	for (let i = 1; i < points.length; i++) {
		const gapDays = dayGap(points[i - 1].date, points[i].date);
		if (gapDays > maxGapDays) {
			segments.push(current);
			current = [points[i]];
		} else {
			current.push(points[i]);
		}
	}
	segments.push(current);
	return segments;
}

function dayGap(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
	return Math.abs(b - a) / 86_400_000;
}

function num(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
