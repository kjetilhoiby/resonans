// Family Domain — Personer i brukerens nettverk: barn, partner, foreldre, svigerfamilie, venner, kolleger.
// Dette domenet er menneskedrevet (i motsetning til health/economics/food som er datadrevne).

export type PersonKind =
	| 'child'
	| 'partner'
	| 'parent'
	| 'sibling'
	| 'in_law'
	| 'extended_family'
	| 'friend'
	| 'colleague'
	| 'self'
	| 'other';

export type RelationType = 'family' | 'friend' | 'work';

export type RelationSubType =
	| 'parent_of'
	| 'child_of'
	| 'married_to'
	| 'partnered_with'
	| 'sibling_of'
	| 'in_law_of'
	| 'friend_of'
	| 'colleague_of';

export const PERSON_KINDS: Record<PersonKind, { label: string; emoji: string; relation: RelationType }> = {
	child: { label: 'Barn', emoji: '🧒', relation: 'family' },
	partner: { label: 'Partner', emoji: '💞', relation: 'family' },
	parent: { label: 'Forelder', emoji: '👵', relation: 'family' },
	sibling: { label: 'Søsken', emoji: '👥', relation: 'family' },
	in_law: { label: 'Svigerfamilie', emoji: '👨‍👩‍👧‍👦', relation: 'family' },
	extended_family: { label: 'Utvidet familie', emoji: '🌳', relation: 'family' },
	friend: { label: 'Venn', emoji: '🙋', relation: 'friend' },
	colleague: { label: 'Kollega', emoji: '💼', relation: 'work' },
	self: { label: 'Meg', emoji: '🙂', relation: 'family' },
	other: { label: 'Annet', emoji: '👤', relation: 'family' }
};

export const RELATION_TYPES: Record<RelationType, { label: string; emoji: string }> = {
	family: { label: 'Familie', emoji: '👨‍👩‍👧‍👦' },
	friend: { label: 'Venner', emoji: '🙋' },
	work: { label: 'Jobb', emoji: '💼' }
};

// Regex som peker mot family-domenet
export const FAMILY_DOMAIN_TRIGGER =
	/familie|barn|barna|barnet|partner|kone|mann|samboer|datter|sønn|son|svigerfam|svigermor|svigerfar|sviger|forelder|foreldre|svoger|svigerinne|onkel|tante|fetter|kusine|bestemor|bestefar|besteforeldre|barnebarn|nevø|niese|familieliv/i;

// Trigger-mønstre per person-type — for å detektere hvem brukeren snakker om
export const PERSON_KIND_TRIGGERS: Partial<Record<PersonKind, RegExp>> = {
	child: /barn|barna|barnet|datter|sønn|son|gutt|jente/i,
	partner: /partner|kone|mann|samboer|kjæreste/i,
	parent: /\bmor\b|\bfar\b|mamma|pappa|forelder|foreldre/i,
	sibling: /\bsøster\b|\bbror\b|søsken/i,
	in_law: /sviger(?:mor|far|familie|inne|sønn|datter|barn)|svoger/i,
	extended_family: /onkel|tante|fetter|kusine|bestemor|bestefar|besteforeldre|barnebarn|nevø|niese/i,
	friend: /\bvenn\b|venner|kompis|venninne/i,
	colleague: /kollega|kolleger|jobbkollega/i
};

export function isValidPersonKind(value: string): value is PersonKind {
	return value in PERSON_KINDS;
}

export function isValidRelationType(value: string): value is RelationType {
	return value in RELATION_TYPES;
}

export function detectPersonKind(input: string): PersonKind | null {
	for (const [kind, pattern] of Object.entries(PERSON_KIND_TRIGGERS)) {
		if (pattern && pattern.test(input)) {
			return kind as PersonKind;
		}
	}
	return null;
}

export function relationFromKind(kind: PersonKind): RelationType {
	return PERSON_KINDS[kind].relation;
}

// System prompt hint for family-domenet
export const FAMILY_DOMAIN_PROMPT = `
**FAMILY DOMAIN FOCUS:**
- Bruker fokuserer på familie, barn, partner, foreldre, svigerfamilie eller andre nære relasjoner
- Når en person nevnes ved navn ("Nils", "Anita", "svigermor"), bruk query_family for å finne person; foreslå manage_person.create hvis personen ikke finnes
- Lagre observasjoner ("Nils er lei seg fordi en venn flytter") som memory med personId og themeId='Familie'. Bruk category='relationship'.
- Foreslå goals knyttet til personId når bruker beskriver utfordringer ("Erle sliter med dogåing på skolen" → mål for å hjelpe Erle)
- Foreslå tasks knyttet til personId for konkrete handlinger ("ringe mor denne uka")
- Bruk relasjonstype 'family' | 'friend' | 'work' når du oppretter relasjoner
- Foreldretid kan logges via tracking_series (én per barn) — registrer økter når bruker beskriver kvalitetstid
- Vær empatisk og konkret. Familie-spørsmål handler ofte om følelser og relasjoner, ikke metrikker.
`;

export const ALL_PERSON_KINDS = Object.keys(PERSON_KINDS) as PersonKind[];
export const ALL_RELATION_TYPES = Object.keys(RELATION_TYPES) as RelationType[];
