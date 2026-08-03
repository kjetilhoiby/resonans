/**
 * Oslo-veggklokke → UTC.
 *
 * `todayAtLocalTime` i `$lib/domain/sleep-goals` gjør det samme, men bare for
 * *dagens* dato. Denne tar en vilkårlig dato, som trengs når man vil se på et
 * vindu bakover — «lørdag kveld 22–23».
 *
 * Teknikken: tolk ønsket klokkeslett som UTC, spør Intl hva det tidspunktet
 * heter i Oslo, og korriger differansen. Enklere enn å hardkode sommertid, og
 * riktig over overgangene.
 */

const OSLO_TZ = 'Europe/Oslo';

/**
 * Null for ugyldig inndata. Datoen må være `YYYY-MM-DD` og tida `HH:MM`.
 *
 * NB om overgangsdøgnene: klokka 02:30 finnes ikke natta klokka stilles fram, og
 * finnes to ganger natta den stilles tilbake. Vi returnerer da det Intl gir oss
 * framfor å feile — for et diagnosevindu er nærmeste time godt nok, og å kaste
 * ville gjort funksjonen ubrukelig to netter i året.
 */
export function osloWallClockToUtc(date: string, time: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	if (!/^\d{2}:\d{2}$/.test(time)) return null;

	const [hour, minute] = time.split(':').map(Number);
	if (hour > 23 || minute > 59) return null;

	const naive = new Date(`${date}T${time}:00.000Z`);
	if (Number.isNaN(naive.getTime())) return null;

	const asOslo = new Intl.DateTimeFormat('sv-SE', {
		timeZone: OSLO_TZ,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(naive);

	// sv-SE gir «2026-08-01 22:00» — ISO-lignende, så oppdelingen er trygg.
	const shifted = new Date(`${asOslo.replace(' ', 'T')}:00.000Z`);
	if (Number.isNaN(shifted.getTime())) return null;

	const offsetMs = shifted.getTime() - naive.getTime();
	return new Date(naive.getTime() - offsetMs);
}
