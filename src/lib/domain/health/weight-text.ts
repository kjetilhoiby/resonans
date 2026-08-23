/**
 * Ordene vektflaten og milepælene deler: datoer, spenn og kilotall.
 *
 * De lå i `weight-milestones.ts` fram til perioder (`weight-swings.ts`) fikk sine
 * egne setninger. To moduler som formulerer samme slags påstand må bruke samme
 * ordforråd — «12. mars 2025» ett sted og «12.3.2025» et annet leses som to
 * ulike kilder, og en av dem ser mindre til å stole på ut enn den andre.
 *
 * Milepælsmodulen re-eksporterer dem, siden testene og flatene importerer dem der.
 */

const MONTHS = [
	'januar',
	'februar',
	'mars',
	'april',
	'mai',
	'juni',
	'juli',
	'august',
	'september',
	'oktober',
	'november',
	'desember'
];

const MONTHS_SHORT = [
	'jan.',
	'feb.',
	'mars',
	'apr.',
	'mai',
	'juni',
	'juli',
	'aug.',
	'sep.',
	'okt.',
	'nov.',
	'des.'
];

/** Alltid med årstall: setningene handler om dybde, og da er året poenget. */
export function formatMilestoneDate(iso: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	return `${day}. ${MONTHS[month - 1]} ${year}`;
}

/** Kort dato uten år — til rader der året står én gang for hele raden. */
export function formatShortDate(iso: string): string {
	const [, month, day] = iso.split('-').map(Number);
	return `${day}. ${MONTHS_SHORT[month - 1]}`;
}

/** «3 måneder», «1 år og 5 måneder» — spennet i ord. */
export function describeSpan(days: number): string {
	if (days < 60) return `${days} dager`;
	const months = Math.round(days / 30.44);
	if (months < 12) return `${months} måneder`;
	const years = Math.floor(months / 12);
	const rest = months % 12;
	const yearPart = years === 1 ? '1 år' : `${years} år`;
	return rest === 0 ? yearPart : `${yearPart} og ${rest} ${rest === 1 ? 'måned' : 'måneder'}`;
}

/** Kilotall med komma og én desimal, alltid uten fortegn. Retningen står i ordene. */
export function kg(value: number): string {
	return Math.abs(value).toFixed(1).replace('.', ',');
}

/** Samme, men med to desimaler — tempotall under ett kilo trenger den andre. */
export function kg2(value: number): string {
	const abs = Math.abs(value);
	return (abs < 1 ? abs.toFixed(2) : abs.toFixed(1)).replace('.', ',');
}
