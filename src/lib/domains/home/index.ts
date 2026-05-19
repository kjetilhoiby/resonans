// Home Domain — Hus og hjem: oppussings-/vedlikeholds-/reparasjonsprosjekter,
// husarbeids-rutiner, sesong-oppgaver og hjem-apparater (vaskemaskin, oppvask, tørketrommel).

export type HomeProjectType = 'renovation' | 'maintenance' | 'repair' | 'organize';

export type HomeRoom =
	| 'kitchen'
	| 'bathroom'
	| 'bedroom'
	| 'living_room'
	| 'office'
	| 'hallway'
	| 'basement'
	| 'attic'
	| 'garage'
	| 'garden'
	| 'balcony'
	| 'storage'
	| 'other';

export type HomeRoutineKind = 'cleaning' | 'laundry' | 'dishes' | 'maintenance_check' | 'seasonal';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const HOME_PROJECT_TYPES: Record<HomeProjectType, { label: string; emoji: string }> = {
	renovation: { label: 'Oppussing', emoji: '🔨' },
	maintenance: { label: 'Vedlikehold', emoji: '🧰' },
	repair: { label: 'Reparasjon', emoji: '🛠️' },
	organize: { label: 'Rydde/organisere', emoji: '📦' }
};

export const HOME_ROOMS: Record<HomeRoom, { label: string; emoji: string }> = {
	kitchen: { label: 'Kjøkken', emoji: '🍳' },
	bathroom: { label: 'Bad', emoji: '🛁' },
	bedroom: { label: 'Soverom', emoji: '🛏️' },
	living_room: { label: 'Stue', emoji: '🛋️' },
	office: { label: 'Kontor', emoji: '🖥️' },
	hallway: { label: 'Gang', emoji: '🚪' },
	basement: { label: 'Kjeller', emoji: '🏚️' },
	attic: { label: 'Loft', emoji: '🪜' },
	garage: { label: 'Garasje', emoji: '🚗' },
	garden: { label: 'Hage', emoji: '🌳' },
	balcony: { label: 'Balkong/Terrasse', emoji: '🌿' },
	storage: { label: 'Bod/Lager', emoji: '📦' },
	other: { label: 'Annet', emoji: '🏠' }
};

export const HOME_ROUTINE_KINDS: Record<HomeRoutineKind, { label: string; emoji: string }> = {
	cleaning: { label: 'Rengjøring', emoji: '🧹' },
	laundry: { label: 'Klesvask', emoji: '🧺' },
	dishes: { label: 'Oppvask', emoji: '🍽️' },
	maintenance_check: { label: 'Sjekk-rutine', emoji: '🔍' },
	seasonal: { label: 'Sesongarbeid', emoji: '🍂' }
};

export const SEASONS: Record<Season, { label: string; emoji: string; months: number[] }> = {
	spring: { label: 'Vår', emoji: '🌷', months: [3, 4, 5] },
	summer: { label: 'Sommer', emoji: '☀️', months: [6, 7, 8] },
	autumn: { label: 'Høst', emoji: '🍂', months: [9, 10, 11] },
	winter: { label: 'Vinter', emoji: '❄️', months: [12, 1, 2] }
};

export const HOME_APPLIANCE_SUBTYPES = [
	'washer',
	'dryer',
	'dishwasher',
	'fridge',
	'freezer',
	'vacuum',
	'appliance_monitor'
] as const;
export type HomeApplianceSubtype = (typeof HOME_APPLIANCE_SUBTYPES)[number];

export const HOME_APPLIANCE_LABELS: Record<HomeApplianceSubtype, { label: string; emoji: string }> = {
	washer: { label: 'Vaskemaskin', emoji: '🧺' },
	dryer: { label: 'Tørketrommel', emoji: '👕' },
	dishwasher: { label: 'Oppvaskmaskin', emoji: '🍽️' },
	fridge: { label: 'Kjøleskap', emoji: '🧊' },
	freezer: { label: 'Fryser', emoji: '❄️' },
	vacuum: { label: 'Støvsuger', emoji: '🧹' },
	appliance_monitor: { label: 'Apparat-monitor', emoji: '🔌' }
};

const PING_APPLIANCE_EMOJI: Record<string, string> = {
	vaskemaskin: '🧺',
	vaskemaskina: '🧺',
	oppvaskmaskin: '🍽️',
	oppvaskmaskina: '🍽️',
	'tørketrommel': '👕',
	tørketrommelen: '👕',
};

export function pingApplianceEmoji(name: string): string {
	const key = name.toLowerCase().replace(/[^a-zæøå]/g, '');
	return PING_APPLIANCE_EMOJI[key] ?? '🔌';
}

// Regex som peker mot home-domenet
export const HOME_DOMAIN_TRIGGER =
	/hus(?!holdning|t(re|ru))|hjem(?!met)|stua|kjøkken|kjokken|bad|baderom|soverom|gang|kjeller|loft|garasje|garaje|hage(?!stell)?|balkong|verandaen?|terrasse|oppussing|pusse\s*opp|vedlikehold|reparasjon|reparere|vaske(?:lis)?t|rydd[ei]|støvsug|stovsug|rengj[øo]ring|tørketrommel|torketrommel|vaskemaskin|oppvaskmaskin|oppvask\b|kjøleskap|kjoleskap|fryser|sluk|grill|sykl(?:er|en)|sesongvask|husrutine|husarbeid/i;

// Trigger-mønstre per prosjekttype
export const HOME_PROJECT_TYPE_TRIGGERS: Record<HomeProjectType, RegExp> = {
	renovation: /oppussing|pusse\s*opp|renover/i,
	maintenance: /vedlikehold|servic|sjekk\s*opp|kontroll/i,
	repair: /reparasjon|reparere|fikse|ødelagt|odelagt|knust|lekka?sje/i,
	organize: /rydd[ei]|organiser|sorter/i
};

export const HOME_ROOM_TRIGGERS: Partial<Record<HomeRoom, RegExp>> = {
	kitchen: /kjøkken|kjokken/i,
	bathroom: /bad(?:rom|et)?\b/i,
	bedroom: /soverom|sengerom/i,
	living_room: /stua|stue\b/i,
	office: /kontor/i,
	hallway: /\bgang(?:en)?\b/i,
	basement: /kjeller/i,
	attic: /loft/i,
	garage: /garasje|garaje/i,
	garden: /hage(?:n)?\b/i,
	balcony: /balkong|verandaen?|terrasse/i,
	storage: /\bbod(?:en)?\b|lager/i
};

export function isValidHomeProjectType(value: string): value is HomeProjectType {
	return value in HOME_PROJECT_TYPES;
}

export function isValidHomeRoom(value: string): value is HomeRoom {
	return value in HOME_ROOMS;
}

export function isValidSeason(value: string): value is Season {
	return value in SEASONS;
}

export function detectHomeProjectType(input: string): HomeProjectType | null {
	for (const [type, pattern] of Object.entries(HOME_PROJECT_TYPE_TRIGGERS)) {
		if (pattern.test(input)) return type as HomeProjectType;
	}
	return null;
}

export function detectHomeRoom(input: string): HomeRoom | null {
	for (const [room, pattern] of Object.entries(HOME_ROOM_TRIGGERS)) {
		if (pattern && pattern.test(input)) return room as HomeRoom;
	}
	return null;
}

export function detectSeason(input: string): Season | null {
	const text = input.toLowerCase();
	if (/\bvår(?:en)?\b|mars|april|mai/i.test(text)) return 'spring';
	if (/\bsommer(?:en)?\b|juni|juli|august/i.test(text)) return 'summer';
	if (/\bhøst(?:en)?\b|hosten|september|oktober|november/i.test(text)) return 'autumn';
	if (/\bvinter(?:en)?\b|desember|januar|februar/i.test(text)) return 'winter';
	return null;
}

export function currentSeason(date: Date = new Date()): Season {
	const month = date.getMonth() + 1;
	if ([3, 4, 5].includes(month)) return 'spring';
	if ([6, 7, 8].includes(month)) return 'summer';
	if ([9, 10, 11].includes(month)) return 'autumn';
	return 'winter';
}

// System prompt for home-domenet
export const HOME_DOMAIN_PROMPT = `
**HOME DOMAIN FOCUS:**
- Bruker fokuserer på hus og hjem — oppussing, vedlikehold, reparasjon, husarbeid, sesong-rutiner, eller hjem-apparater
- Bruk query_home for å hente aktive hus-prosjekter, ukens rutiner og sesong-oppgaver
- Bruk manage_project (med domain='home') for å opprette/oppdatere prosjekter. Sett type til 'renovation' | 'maintenance' | 'repair' | 'organize' og legg rom i metadata.room når relevant
- Bruk link_to_project for å knytte eksisterende oppgaver, sjekklist-items og transaksjoner til et prosjekt — gir burn-up og kost-vs-budsjett
- Bruk manage_home_routine for å lage vaskelister og husarbeids-sjekklister (context='home_routine')
- Sesong-oppgaver opprettes som tasks med season satt og recurrence_yearly=true (goalId kan være null)
- For apparat-spørsmål ("når vasket jeg sist?", "energiforbruk vaskemaskin"): foreslå widget med propose_widget
- Tone: praktisk, konkret. Foreslå neste lille steg, ikke en hel prosjektplan på én gang.
`;

export const ALL_HOME_PROJECT_TYPES = Object.keys(HOME_PROJECT_TYPES) as HomeProjectType[];
export const ALL_HOME_ROOMS = Object.keys(HOME_ROOMS) as HomeRoom[];
export const ALL_SEASONS = Object.keys(SEASONS) as Season[];
