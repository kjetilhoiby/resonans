export type DashboardKind = 'health' | 'training' | 'sleep' | 'screentime' | 'nutrition' | 'weight' | 'economics' | 'food' | 'family' | 'travel' | 'ferie' | 'books' | 'film' | 'egenfrekvens' | 'home' | 'vehicle' | 'writing';

export interface ThemeDashboardDefinition {
	kind: DashboardKind;
	label: string;
	icon: string;
}

// NB: normalizeThemeName dekomponerer bare tegn som HAR en kanonisk
// dekomponering — «å» blir «a», men «ø» og «æ» står igjen. Termer må derfor
// skrives med norske tegn, gjerne i begge varianter («kjøkken»/«kjokken»).
const THEME_DASHBOARD_MATCHERS: Array<{ kind: DashboardKind; terms: string[] }> = [
	{
		// NB: må stå FØRST i helse-familien. «psykisk helse» og «mental helse»
		// inneholder ordet «helse», så health-matcheren ville ellers fanget dem
		// og gitt et helsedashboard til et tema som handler om indre tilstand.
		kind: 'egenfrekvens',
		terms: [
			'egenfrekvens',
			'psykisk helse',
			'mental helse',
			'mental trening',
			'innsjekk',
			'sjekkin',
			'stemning',
			'mood',
			'wellbeing',
			'velvære',
			'velvare'
		]
	},
	{
		// NB: må stå før training/sleep/screentime. Termene deres er fjernet
		// herfra, så «Trening» treffer bare training — men et sammensatt navn
		// som «Helse og trening» skal fortsatt beholde mordashboardet.
		kind: 'health',
		terms: [
			'helse',
			'health',
			'skritt',
			'steps',
			// NB: «aktivitet» er 9 tegn og matcher som delstreng. Den blir
			// bevisst liggende på health — flyttet til training ville den
			// fanget «Barnas aktiviteter» og «Fritidsaktiviteter».
			'aktivitet',
			'vitalitet'
		]
	},
	{
		/**
		 * Termene er bevisst LANGE. Regelen under er «eksakt ordmatch alltid,
		 * delstreng bare for termer ≥5 tegn» — og «skriv» er akkurat 5, altså en
		 * delstreng av «beskrivelse». «skriving» og «skriveprosjekt» er trygge:
		 * eksakt ordmatch dekker temanavnet «Skriving», og delstrengen treffer
		 * bare sammensetninger som faktisk handler om skriving.
		 */
		kind: 'writing',
		terms: ['skriving', 'skriveprosjekt', 'forfatterskap', 'notatblokk']
	},
	{
		/**
		 * NB: må stå ETTER health. «vekt» og «kropp» lå på health fram til august
		 * 2026, med begrunnelsen at vekt er utfallsmålet undertemaene driver og
		 * ikke en gren for seg. Det holdt ikke: en høst der vekt er hovedfokus
		 * trenger sin egen historikk, sine egne milepæler og sin egen graf.
		 *
		 * Rekkefølgen bevarer det gamle: «Helse og vekt» inneholder «helse» og
		 * beholder mordashboardet, mens «Vekt» alene nå får sitt eget.
		 */
		kind: 'weight',
		terms: [
			'vekt',
			'vekta',
			'vektmål',
			'vektnedgang',
			'weight',
			'kropp',
			'kroppsvekt',
			'kroppssammensetning',
			'fettprosent',
			'slanking'
		]
	},
	{
		kind: 'training',
		terms: [
			'trening',
			'fitness',
			'workout',
			'fysisk aktivitet',
			'løping',
			'loping',
			'løpetur',
			'lopetur',
			'løp',
			'lop',
			'run',
			'running',
			'styrke',
			'utholdenhet',
			'intervall'
		]
	},
	{
		kind: 'sleep',
		terms: [
			'søvn',
			'sovn',
			'sleep',
			'søvnkvalitet',
			'sovnkvalitet',
			'døgnrytme',
			'dognrytme',
			'restitusjon',
			'hvile'
		]
	},
	{
		kind: 'screentime',
		terms: ['skjermtid', 'screentime', 'screen time', 'scrolling', 'mobilbruk']
	},
	{
		kind: 'economics',
		terms: [
			'økonomi',
			'economy',
			'economics',
			'forbruk',
			'utgifter',
			'inntekt',
			'budsjett',
			'sparing',
			'bank',
			'money',
			'finance',
			'finances',
			'budget',
			'spending',
			'savings'
		]
	},
	{
		kind: 'food',
		terms: [
			'mat',
			'middag',
			'meny',
			'ukemeny',
			'oppskrift',
			'kjøkken',
			'kjokken',
			'måltid',
			'maltid',
			'matplan',
			'food',
			'cooking',
			'recipe',
			'meal',
			'pantry'
		]
	},
	{
		// NB: må stå ETTER food. «Mat og ernæring» og «Kosthold og mat» skal
		// beholde matdashboardet med ukemeny, oppskrifter og lager — nutrition
		// eier energibalansen, ikke matlogistikken.
		kind: 'nutrition',
		terms: [
			'ernæring',
			'ernaring',
			'kosthold',
			'nutrition',
			'energibalanse',
			'kalorier',
			'protein',
			'makro'
		]
	},
	{
		// NB: må stå før 'family' og 'travel'. Ellers fanger family-matcheren
		// (substring-match på «familie») et tema som «Familieferie» og ruter det
		// til family-dashboardet — som ikke kan lagre oppholdsplanen. Ferie er den
		// mer spesifikke intensjonen og skal vinne kollisjonen familie+ferie.
		kind: 'ferie',
		terms: [
			'ferie',
			'sommerferie',
			'påskeferie',
			'juleferie',
			'vinterferie',
			'høstferie',
			'ferieturer',
			'feriedager',
			'oppholdsplan'
		]
	},
	{
		kind: 'family',
		terms: [
			'familie',
			'family',
			'barna',
			'barn',
			'foreldre',
			'foreldreliv',
			'familieliv',
			'samliv',
			'parents',
			'kids',
			'children',
			'household'
		]
	},
	{
		kind: 'travel',
		terms: [
			'tur',
			'turer',
			'reise',
			'reiser',
			'utland',
			'utenlandstur',
			'trip',
			'travel',
			'vacation',
			'holiday',
			'backpacking',
			'city-break',
			'citybreak',
			'road trip',
			'roadtrip',
			'krydstokt',
			'cruise',
			'fly',
			'flytur'
		]
	},
	{
		kind: 'books',
		terms: [
			'bok',
			'bøker',
			'lesing',
			'litteratur',
			'reading',
			'books',
			'literature',
			'bibliotek',
			'library'
		]
	},
	{
		kind: 'film',
		terms: ['film', 'filmer', 'kino', 'kinofilm', 'movie', 'movies', 'regissør', 'regissor']
	},
	{
		kind: 'vehicle',
		terms: ['bil', 'kjøretøy', 'kjoretoy', 'tesla', 'elbil', 'bilen', 'kjøring', 'kjoring']
	},
	{
		kind: 'home',
		terms: [
			'hus',
			'hjem',
			'bolig',
			'hus og hjem',
			'vedlikehold',
			'oppussing',
			'renovering',
			'husarbeid',
			'home',
			'house',
			'leilighet',
			'hytte'
		]
	}
];

const DASHBOARD_DEFINITIONS: Record<DashboardKind, ThemeDashboardDefinition> = {
	health: {
		kind: 'health',
		label: 'Helse',
		icon: '💪'
	},
	training: {
		kind: 'training',
		label: 'Trening',
		icon: '🏃'
	},
	sleep: {
		kind: 'sleep',
		label: 'Søvn',
		icon: '😴'
	},
	screentime: {
		kind: 'screentime',
		label: 'Skjermtid',
		icon: '📱'
	},
	nutrition: {
		kind: 'nutrition',
		label: 'Ernæring',
		icon: '🥗'
	},
	weight: {
		kind: 'weight',
		label: 'Vekt',
		icon: '⚖️'
	},
	writing: {
		kind: 'writing',
		label: 'Skriving',
		icon: '✍️'
	},
	economics: {
		kind: 'economics',
		label: 'Økonomi',
		icon: '💰'
	},
	food: {
		kind: 'food',
		label: 'Mat',
		icon: '🍽️'
	},
	family: {
		kind: 'family',
		label: 'Familie',
		icon: '👨‍👩‍👧'
	},
	travel: {
		kind: 'travel',
		label: 'Tur',
		icon: '🗺️'
	},
	ferie: {
		kind: 'ferie',
		label: 'Ferie',
		icon: '🏖️'
	},
	books: {
		kind: 'books',
		label: 'Bøker',
		icon: '📚'
	},
	film: {
		kind: 'film',
		label: 'Film',
		icon: '🎬'
	},
	egenfrekvens: {
		kind: 'egenfrekvens',
		label: 'Egenfrekvens',
		icon: '🧘'
	},
	home: {
		kind: 'home',
		label: 'Hjem',
		icon: '🏠'
	},
	vehicle: {
		kind: 'vehicle',
		label: 'Kjøretøy',
		icon: '🚗'
	}
};

function normalizeThemeName(name: string | null | undefined): string {
	return (name ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim();
}

export function resolveThemeDashboardKind(themeName: string | null | undefined): DashboardKind | null {
	const normalized = normalizeThemeName(themeName);
	// Split into words for precise matching — prevents e.g. "tur" (3 chars) matching "litteratur"
	const words = normalized.split(/\s+/);

	for (const matcher of THEME_DASHBOARD_MATCHERS) {
		if (matcher.terms.some((term) => {
			const t = normalizeThemeName(term);
			// Exact word match for all terms; also substring match for longer terms (≥5 chars)
			// so that compounds like "sommerferie" still match "ferie"
			return words.some((w) => w === t) || (t.length >= 5 && normalized.includes(t));
		})) {
			return matcher.kind;
		}
	}

	return null;
}

export function getThemeDashboardDefinition(themeName: string | null | undefined): ThemeDashboardDefinition | null {
	const kind = resolveThemeDashboardKind(themeName);
	return kind ? DASHBOARD_DEFINITIONS[kind] : null;
}

export function dashboardEndpointForTheme(themeId: string, kind: DashboardKind): string {
	return `/api/tema/${themeId}/dashboard/${kind}`;
}