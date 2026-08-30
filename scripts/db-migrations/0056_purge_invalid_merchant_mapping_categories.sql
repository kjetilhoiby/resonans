-- Slett merchant_mappings der `category` ikke er en gyldig kategori.
--
-- `merchant_mappings.category` ble skrevet med LLM-ens rå output uten validering, og
-- modellen svarte iblant med et BUTIKKNAVN der den skulle svart med en CategoryId. Siden
-- merchant-mappings har nest høyeste prioritet i `categorizeTransaction` — bare manuelle
-- overstyringer slår dem — overstyrte den ugyldige verdien alle keyword-reglene.
--
-- Observert i prod august 2026: «OpenAI» sto som en egen kategori på 15 153 kr over seks
-- transaksjoner, der bare 61 kr faktisk var OpenAI. De fem andre var to Nettgiro, to
-- eFaktura AvtaleGiro og en intern overføring på 4 000 kr — alle med en mapping som bar
-- samme ugyldige kategori.
--
-- **Sletting, ikke omskriving til 'ukategorisert'.** En rad med 'ukategorisert' ville
-- fortsatt overstyrt reglene, bare med et tommere svar. Slettes den, tar keyword-reglene og
-- SB1s typeText-fallback over umiddelbart, og `analyzeSpending` klassifiserer butikken på
-- nytt — nå med `normalizeCategoryId` på vei inn.
--
-- Idempotent: kjører den om igjen, finner den ingenting.
--
-- Se docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md.

DELETE FROM merchant_mappings
WHERE LOWER(TRIM(category)) NOT IN (
	-- Kanoniske CategoryId-er (transaction-categories-client.ts)
	'forsikring',
	'bilforsikring_og_billan',
	'barnehage_og_sfo',
	'dagligvarer',
	'kafe_og_restaurant',
	'bil_og_transport',
	'reise',
	'faste_boutgifter',
	'hjem_og_hage',
	'medier_og_underholdning',
	'hobby_og_fritid',
	'helse_og_velvaere',
	'klaer_og_utstyr',
	'barn',
	'sparing',
	'annet_lan_og_gjeld',
	'diverse',
	'innskudd',
	'ukategorisert',
	-- Aliaser som normalizeCategoryId oversetter (CATEGORY_ALIASES). Disse er gyldige på
	-- lesesiden, så de skal ikke slettes.
	'dagligvare', 'matvarer', 'matbutikk', 'grocery',
	'mat', 'mat_ute', 'restaurant', 'kafe', 'fastfood', 'takeaway',
	'transport', 'bil', 'drivstoff',
	'bolig', 'husleie', 'boutgifter', 'strom', 'strøm',
	'lan', 'lån', 'gjeld',
	'abonnement', 'underholdning', 'strommetjenester', 'strømmetjenester', 'media',
	'shopping', 'klaer', 'klær',
	'helse', 'apotek', 'lege',
	'lonn', 'lønn', 'inntekt', 'salary',
	'investering',
	'barnehage', 'sfo',
	'bilforsikring', 'billan', 'billån',
	'barneklær', 'leker',
	'hobby', 'fritid', 'trening', 'kino',
	'hjem', 'hage', 'moblering',
	'overforing', 'overføring', 'internoverføring', 'betaling',
	'annet', 'other', 'ukjent'
);
