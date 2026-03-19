/**
 * Client-safe transaction category definitions.
 * This file can be imported by both server and client code.
 */

export type CategoryId =
	| 'dagligvare'
	| 'mat'
	| 'bolig'
	| 'lån'
	| 'transport'
	| 'helse'
	| 'abonnement'
	| 'underholdning'
	| 'shopping'
	| 'barn'
	| 'forsikring'
	| 'sparing'
	| 'overføring'
	| 'lønn'
	| 'annet';

export type Category = {
	id: CategoryId;
	label: string;
	emoji: string;
	/** Default classification — can be overridden by recurrence check */
	defaultFixed: boolean;
};

export const CATEGORIES: Record<CategoryId, Category> = {
	dagligvare:    { id: 'dagligvare',   label: 'Dagligvare',            emoji: '🛒', defaultFixed: false },
	mat:           { id: 'mat',          label: 'Mat og drikke',          emoji: '🍽️', defaultFixed: false },
	bolig:         { id: 'bolig',        label: 'Bolig',                  emoji: '🏠', defaultFixed: true  },
	lån:           { id: 'lån',          label: 'Lån og avdrag',          emoji: '🏦', defaultFixed: true  },
	transport:     { id: 'transport',    label: 'Transport',              emoji: '🚗', defaultFixed: false },
	helse:         { id: 'helse',        label: 'Helse',                  emoji: '💊', defaultFixed: false },
	abonnement:    { id: 'abonnement',   label: 'Abonnementer',           emoji: '📱', defaultFixed: true  },
	underholdning: { id: 'underholdning',label: 'Underholdning',          emoji: '🎉', defaultFixed: false },
	shopping:      { id: 'shopping',     label: 'Shopping',               emoji: '🛍️', defaultFixed: false },
	barn:          { id: 'barn',         label: 'Barn og familie',        emoji: '👶', defaultFixed: true  },
	forsikring:    { id: 'forsikring',   label: 'Forsikring',             emoji: '🛡️', defaultFixed: true  },
	sparing:       { id: 'sparing',      label: 'Sparing',                emoji: '💰', defaultFixed: true  },
	overføring:    { id: 'overføring',   label: 'Overføringer',           emoji: '🔄', defaultFixed: false },
	lønn:          { id: 'lønn',         label: 'Lønn og inntekt',        emoji: '💵', defaultFixed: false },
	annet:         { id: 'annet',        label: 'Annet',                  emoji: '📦', defaultFixed: false },
};
