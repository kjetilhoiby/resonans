/**
 * Client-safe transaction category definitions.
 * Based on SpareBank1's taxonomy for consistency with Norwegian banking standards.
 * This file can be imported by both server and client code.
 */

export type CategoryId =
	| 'forsikring'
	| 'bilforsikring_og_billan'
	| 'barnehage_og_sfo'
	| 'dagligvarer'
	| 'kafe_og_restaurant'
	| 'bil_og_transport'
	| 'reise'
	| 'faste_boutgifter'
	| 'hjem_og_hage'
	| 'medier_og_underholdning'
	| 'hobby_og_fritid'
	| 'helse_og_velvaere'
	| 'klaer_og_utstyr'
	| 'barn'
	| 'sparing'
	| 'annet_lan_og_gjeld'
	| 'diverse'
	| 'innskudd'
	| 'ukategorisert';

export type Category = {
	id: CategoryId;
	label: string;
	emoji: string;
	/** Default classification — can be overridden by recurrence check */
	defaultFixed: boolean;
};

export const CATEGORIES: Record<CategoryId, Category> = {
	innskudd:                { id: 'innskudd',               label: 'Inntekter',                emoji: '💵', defaultFixed: false },
	dagligvarer:             { id: 'dagligvarer',            label: 'Dagligvarer',              emoji: '🛒', defaultFixed: false },
	kafe_og_restaurant:      { id: 'kafe_og_restaurant',     label: 'Kafe og restaurant',       emoji: '🍽️', defaultFixed: false },
	faste_boutgifter:        { id: 'faste_boutgifter',       label: 'Faste boutgifter',         emoji: '🏠', defaultFixed: true  },
	annet_lan_og_gjeld:      { id: 'annet_lan_og_gjeld',     label: 'Lån og gjeld',             emoji: '🏦', defaultFixed: true  },
	bil_og_transport:        { id: 'bil_og_transport',       label: 'Transport og bil',         emoji: '🚗', defaultFixed: false },
	helse_og_velvaere:       { id: 'helse_og_velvaere',      label: 'Helse og velvære',         emoji: '💊', defaultFixed: false },
	medier_og_underholdning: { id: 'medier_og_underholdning',label: 'Medier og underholdning',  emoji: '📱', defaultFixed: false },
	hobby_og_fritid:         { id: 'hobby_og_fritid',        label: 'Hobby og fritid',          emoji: '🎉', defaultFixed: false },
	hjem_og_hage:            { id: 'hjem_og_hage',           label: 'Hjem og hage',             emoji: '🔨', defaultFixed: false },
	klaer_og_utstyr:         { id: 'klaer_og_utstyr',        label: 'Klær og utstyr',           emoji: '🛍️', defaultFixed: false },
	barn:                    { id: 'barn',                   label: 'Barn',                     emoji: '👶', defaultFixed: false },
	barnehage_og_sfo:        { id: 'barnehage_og_sfo',       label: 'Barnehage og SFO',         emoji: '🎒', defaultFixed: true  },
	forsikring:              { id: 'forsikring',             label: 'Forsikring',               emoji: '🛡️', defaultFixed: true  },
	bilforsikring_og_billan: { id: 'bilforsikring_og_billan',label: 'Bilforsikring og billån',  emoji: '🚙', defaultFixed: true  },
	sparing:                 { id: 'sparing',                label: 'Sparing',                  emoji: '💰', defaultFixed: true  },
	reise:                   { id: 'reise',                  label: 'Reise',                    emoji: '✈️', defaultFixed: false },
	diverse:                 { id: 'diverse',                label: 'Diverse',                  emoji: '🔄', defaultFixed: false },
	ukategorisert:           { id: 'ukategorisert',          label: 'Ukategorisert',            emoji: '📦', defaultFixed: false },
};
