/**
 * Billettbildet: oppdeling for lesing, og utsnitt per billett.
 *
 * Bakgrunnen er en målt feil. Den generiske vedleggsopplastingen skalerer bilder
 * til 1600 px på lengste kant (`uploadAndExtractAttachment`), noe som er riktig
 * for et bilde i en chat. Et «hele siden»-skjermbilde av en billett er derimot
 * smalt og høyt — 1170×6000 er vanlig — og `c_limit` gjør det da til **312×1600**.
 * Strekkoden blir uleselig, og den lille teksten blir grøt.
 *
 * Det ødela to ting samtidig: bildet brukeren skal vise i døra, OG grunnlaget for
 * uttrekket. Målt 17. september 2026 leste modellen ordrenummeret `163166254` som
 * `151165243` fra et slikt nedskalert bilde.
 *
 * Derfor: originalen lagres urørt, og alt annet er utsnitt utledet av den via
 * Cloudinary-URL-er. Reglene for HVILKE utsnitt bor her, rent og testet.
 */

/** Et vannrett utsnitt av et bilde, som andeler (0–1) av full høyde. */
export interface ImageRegion {
	top: number;
	height: number;
}

/**
 * Over dette forholdstallet (høyde/bredde) er bildet «langt», og én visning av
 * det gir modellen for få piksler per tekstlinje.
 *
 * 1,8 er valgt lavt med vilje. En vanlig telefonskjerm er ~2,2, så en enkelt
 * skjermdump havner allerede over — og det er riktig: også den har liten tekst
 * nederst. Prisen ved å dele et bilde som ikke trengte det er to ekstra
 * bildefelter i ett modellkall; prisen ved å la være er et feillest ordrenummer.
 */
export const LONG_IMAGE_RATIO = 1.8;

/**
 * Hvert snitt dekker omtrent så mye høyde som bredden.
 *
 * Et kvadratisk utsnitt er det OpenAI-vision behandler best: bildet flislegges i
 * 512-ruter, og et langt, smalt bilde nedskaleres først slik at den lange kanten
 * passer — altså nøyaktig tapet vi prøver å unngå.
 */
const SLICE_ASPECT = 1.0;

/**
 * Overlapp mellom nabosnitt.
 *
 * Uten den kan et snitt gå tvers gjennom en tekstlinje eller en strekkode, og da
 * finnes tallet ikke HELT i noen av delene. 12 % er romsligere enn en tekstlinje
 * og billigere enn et ekstra snitt.
 */
const SLICE_OVERLAP = 0.12;

/** Flere enn dette blir mange bilder i ett modellkall, til fallende nytte. */
export const MAX_SLICES = 5;

/**
 * Del et bilde i snitt for lesing.
 *
 * Ett snitt (hele bildet) når det ikke er langt — da er det ingenting å vinne.
 * Ukjente eller ugyldige mål gir også ett snitt: vi gjetter ikke på en form vi
 * ikke har målt.
 */
export function planTicketSlices(width: number, height: number): ImageRegion[] {
	if (!isPositive(width) || !isPositive(height)) return [{ top: 0, height: 1 }];

	const ratio = height / width;
	if (ratio <= LONG_IMAGE_RATIO) return [{ top: 0, height: 1 }];

	const count = Math.min(MAX_SLICES, Math.max(2, Math.ceil(ratio / SLICE_ASPECT)));
	const sliceHeight = Math.min(1, 1 / count + SLICE_OVERLAP);

	const slices: ImageRegion[] = [];
	for (let i = 0; i < count; i++) {
		// Siste snitt forankres i BUNNEN. Regnet framover ville avrunding pluss
		// overlapp lagt det utenfor bildet, og da faller de nederste linjene ut —
		// som er der ordrenummeret pleier å stå.
		const top = i === count - 1 ? 1 - sliceHeight : (i * (1 - sliceHeight)) / (count - 1);
		slices.push({ top: round(Math.max(0, top)), height: round(sliceHeight) });
	}
	return slices;
}

function isPositive(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function round(value: number): number {
	return Math.round(value * 10_000) / 10_000;
}

/**
 * Et utsnitt modellen har pekt ut, gjort trygt.
 *
 * Modellen anslår hvor en billett ligger i en høy side, og den bommer noen
 * ganger. `padRegion` legger derfor på monn i begge ender: et utsnitt som tar
 * med litt for mye er fortsatt en billett man kan vise i døra, mens et som
 * kutter strekkoden er verdiløst. Feilen vi tåler og feilen vi ikke tåler er
 * ikke symmetriske, så polstringen er det heller ikke.
 */
export const REGION_PADDING = 0.03;

export function padRegion(region: ImageRegion, padding = REGION_PADDING): ImageRegion {
	const top = Math.max(0, region.top - padding);
	const bottom = Math.min(1, region.top + region.height + padding);
	return { top: round(top), height: round(bottom - top) };
}

/** Minste utsnitt vi tror på. Under dette er det neppe en hel billett. */
export const MIN_REGION_HEIGHT = 0.04;

/**
 * Les ut billettutsnittene modellen rapporterte.
 *
 * Tar imot både `top`/`height` og `topPct`/`bottomPct`, siden modellen svarer på
 * begge former. Alt som ikke gir mening forkastes — **hele lista**, ikke bare
 * den ene raden. Et halvt sett utsnitt er verre enn ingen: brukeren ville fått
 * «billett 1 av 3» og «billett 3 av 3» og trodd at én var borte.
 */
export function regionsFromModel(value: unknown): ImageRegion[] {
	if (!Array.isArray(value) || value.length === 0) return [];

	// Rå tall først, enhet etterpå. Modellen svarer konsekvent i ÉN enhet for
	// hele svaret — enten andeler eller prosent — så enheten er en egenskap ved
	// lista, ikke ved det enkelte tallet. Gjettet vi per verdi, ville «1.5» blitt
	// lest som 1,5 % framfor som den ugyldige andelen den er.
	const raw: Array<{ top: number; span: number; spanIsBottom: boolean }> = [];
	for (const item of value) {
		if (!item || typeof item !== 'object') return [];
		const r = item as Record<string, unknown>;

		const top = toNumber(r.top ?? r.topPct);
		const height = toNumber(r.height);
		const bottom = toNumber(r.bottom ?? r.bottomPct);
		if (top === null) return [];
		if (height !== null) raw.push({ top, span: height, spanIsBottom: false });
		else if (bottom !== null) raw.push({ top, span: bottom, spanIsBottom: true });
		else return [];
	}

	// Er noe over 1, kan ingenting være en andel: hele svaret er i prosent.
	const divisor = raw.some((r) => r.top > 1 || r.span > 1) ? 100 : 1;

	const out: ImageRegion[] = [];
	for (const r of raw) {
		const top = r.top / divisor;
		let height = r.spanIsBottom ? r.span / divisor - top : r.span / divisor;

		if (top < 0 || top >= 1 || height < MIN_REGION_HEIGHT) return [];
		if (top + height > 1) height = 1 - top;

		out.push(padRegion({ top: round(top), height: round(height) }));
	}

	// Sorteres ovenfra og ned, så «Billett 1» er den øverste på siden.
	out.sort((a, b) => a.top - b.top);
	return out;
}

/** Et endelig, ikke-negativt tall, eller null. Prosenttegn tolereres. */
function toNumber(value: unknown): number | null {
	const num = typeof value === 'string' ? Number(value.replace('%', '').trim()) : value;
	if (typeof num !== 'number' || !Number.isFinite(num) || num < 0 || num > 100) return null;
	return num;
}

/**
 * Er utsnittene verdt å dele opp i?
 *
 * Ett utsnitt som dekker nesten hele bildet er ikke en oppdeling — det er
 * originalen med en ny etikett, og to kort som viser det samme bildet er verre
 * enn ett.
 */
export function worthSplitting(regions: ImageRegion[]): boolean {
	if (regions.length < 2) return false;
	return regions.every((r) => r.height < 0.9);
}

/** «Billett 2 av 3». Én av én får ingen etikett — tallet ville ikke sagt noe. */
export function ticketLabel(index: number, total: number): string | null {
	if (total < 2) return null;
	return `Billett ${index + 1} av ${total}`;
}

/**
 * Del én opplasting i én oppføring per billett.
 *
 * Generisk over formen, så den kan testes uten å dra inn serverlaget. Ingen nye
 * opplastinger: alle oppføringene peker på samme fil med hvert sitt utsnitt, og
 * beskjæringen skjer i URL-en. Bommer et utsnitt, er originalen fortsatt der.
 *
 * Er utsnittene ikke verdt å dele opp i, returneres originalen alene — ikke en
 * liste med ett «utsnitt» som dekker hele bildet.
 */
export function splitByRegions<T extends { region?: unknown; label?: unknown }>(
	base: T,
	regions: ImageRegion[]
): T[] {
	if (!worthSplitting(regions)) return [base];
	return regions.map((region, index) => ({
		...base,
		region,
		label: ticketLabel(index, regions.length)
	}));
}
