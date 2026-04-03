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

export const SUBCATEGORIES: Partial<Record<CategoryId, Array<{ key: string; label: string }>>> = {
	innskudd:                [{ key: 'lonn', label: 'Lønn' }, { key: 'utbytte', label: 'Utbytte' }, { key: 'annet_innskudd', label: 'Annet innskudd' }],
	dagligvarer:             [{ key: 'dagligvarer', label: 'Matvarer' }, { key: 'andre_dagligvarer', label: 'Andre dagligvarer' }],
	kafe_og_restaurant:      [{ key: 'fastfood', label: 'Fastfood' }, { key: 'godteri', label: 'Godteri' }, { key: 'kafe', label: 'Kafe' }, { key: 'kantine', label: 'Kantine' }, { key: 'kiosk', label: 'Kiosk' }, { key: 'restaurant', label: 'Restaurant' }, { key: 'utesteder', label: 'Utesteder' }],
	faste_boutgifter:        [{ key: 'alarm', label: 'Alarm' }, { key: 'boligutgifter', label: 'Boligutgifter' }, { key: 'eiendomsforvaltning', label: 'Eiendomsforvaltning' }, { key: 'internett', label: 'Internett' }, { key: 'kommunale_avgifter', label: 'Kommunale avgifter' }, { key: 'mobiltelefon', label: 'Mobiltelefon' }, { key: 'stroem', label: 'Strøm' }, { key: 'utleie_og_salg', label: 'Utleie og salg' }, { key: 'boliglan', label: 'Boliglån' }, { key: 'boligforsikring', label: 'Forsikring av bolig' }],
	annet_lan_og_gjeld:      [{ key: 'betalingsoppfolging', label: 'Betalingsoppfølging' }, { key: 'lan', label: 'Diverse lån' }, { key: 'studielan', label: 'Studielån' }],
	bil_og_transport:        [{ key: 'bilavgifter', label: 'Bilavgifter' }, { key: 'bildeler_og_pleie', label: 'Bildeler og pleie' }, { key: 'bilforhandler', label: 'Bilforhandler' }, { key: 'bom', label: 'Bom' }, { key: 'drivstoff', label: 'Drivstoff' }, { key: 'kollektivtransport', label: 'Kollektivtransport' }, { key: 'leiebil', label: 'Leiebil' }, { key: 'parkering', label: 'Parkering' }, { key: 'taxi', label: 'Taxi' }, { key: 'trafikkskole', label: 'Trafikkskole' }, { key: 'verksted', label: 'Verksted' }],
	helse_og_velvaere:       [{ key: 'apotek', label: 'Apotek' }, { key: 'briller_og_opptikk', label: 'Briller og optikk' }, { key: 'helsekost', label: 'Helsekost' }, { key: 'lege', label: 'Lege og helsetjenester' }, { key: 'skjonnhet', label: 'Skjønnhet' }, { key: 'tannlege', label: 'Tannlege' }, { key: 'velvare', label: 'Velvære' }],
	medier_og_underholdning: [{ key: 'apper_og_spill', label: 'Apper og spill' }, { key: 'aviser', label: 'Aviser' }, { key: 'bokhandler', label: 'Bokhandel' }, { key: 'pengespill', label: 'Pengespill' }, { key: 'strommetjenester', label: 'Strømmetjenester' }, { key: 'tidsskrifter', label: 'Tidsskrift' }, { key: 'tv', label: 'TV' }],
	hobby_og_fritid:         [{ key: 'arrangement', label: 'Arrangement' }, { key: 'dating', label: 'Dating' }, { key: 'digital_markedsplass', label: 'Digital markedsplass' }, { key: 'dyr', label: 'Dyr' }, { key: 'foto', label: 'Foto' }, { key: 'fritidsaktiviteter', label: 'Fritidsaktiviteter' }, { key: 'gavekort', label: 'Gavekort' }, { key: 'hobby', label: 'Hobby' }, { key: 'hytte', label: 'Hytte' }, { key: 'kino', label: 'Kino' }, { key: 'leker', label: 'Leker' }, { key: 'museum', label: 'Museum' }, { key: 'nettjenester', label: 'Nettjenester' }, { key: 'post', label: 'Post' }, { key: 'trening', label: 'Trening' }, { key: 'lan_hobby_fritidsutstyr', label: 'Lån på hobby- og fritidsutstyr' }],
	hjem_og_hage:            [{ key: 'byggvare', label: 'Byggevarer' }, { key: 'hage_og_blomster', label: 'Hage og blomster' }, { key: 'handverker', label: 'Håndverker' }, { key: 'hvitevarer_og_elektronikk', label: 'Hvitevarer og elektronikk' }, { key: 'kjokkenutstyr', label: 'Kjøkkenutstyr' }, { key: 'mobler_og_interior', label: 'Møbler og interiør' }, { key: 'verktoy', label: 'Verktøy' }],
	klaer_og_utstyr:         [{ key: 'klaer', label: 'Klær' }, { key: 'sko', label: 'Sko' }, { key: 'smykker', label: 'Smykker og tilbehør' }, { key: 'sportsutstyr', label: 'Sportsutstyr' }],
	barn:                    [{ key: 'barnebutikker', label: 'Barnebutikker' }, { key: 'annet_til_barna', label: 'Annet til barna' }],
	barnehage_og_sfo:        [{ key: 'barnehager', label: 'Barnehage' }, { key: 'sfo', label: 'SFO' }],
	forsikring:              [{ key: 'forsikring', label: 'Forsikring' }],
	bilforsikring_og_billan: [{ key: 'bilforsikring', label: 'Bilforsikring' }, { key: 'billan', label: 'Billån' }],
	sparing:                 [{ key: 'sparing', label: 'Sparing' }],
	reise:                   [{ key: 'annen_reise', label: 'Annen reise' }, { key: 'flybilletter', label: 'Flybilletter' }, { key: 'overnatting', label: 'Overnatting' }, { key: 'reiseselskap', label: 'Reiseselskap' }],
	diverse:                 [{ key: 'bankboks', label: 'Bankboks' }, { key: 'betaling', label: 'Betaling' }, { key: 'kredittkort', label: 'Kredittkort' }, { key: 'krypto_epenger', label: 'Krypto og e-penger' }, { key: 'kurs_utdanning', label: 'Kurs og utdanning' }, { key: 'medlemskap_veldedighet', label: 'Medlemskap og veldedighet' }, { key: 'minibank', label: 'Minibank' }, { key: 'overforing', label: 'Overføring' }, { key: 'renter_innskudd', label: 'Innskuddsrenter' }, { key: 'renter_og_gebyrer', label: 'Renter og gebyrer' }, { key: 'skatt', label: 'Skatt' }, { key: 'vennebetaling', label: 'Vennebetaling' }, { key: 'andre_utgifter', label: 'Andre utgifter' }, { key: 'gave', label: 'Gave' }, { key: 'utlegg_og_refusjon', label: 'Utlegg og refusjon' }],
	ukategorisert:           [{ key: 'annet', label: 'Ukjent' }],
};
