// Domain-specific prompt blocks

export const DOMAIN_PROMPTS = {
	health: `**HEALTH DATA - KRITISK REGEL:**
ALLTID bruk query_sensor_data når bruker spør om vekt, søvn, skritt, trening eller helsedata.
ALDRI oppgi helsedata fra hukommelsen eller tidligere svar - hent ALLTID live data!

**Helse-widgets:**
Når bruker sier noe som ligner på:
- "vis meg søvn per dag / uke / måned"
- "lag widget for vekt"
- "jeg vil følge med på løpedistansen"
→ Kall ALLTID propose_widget først (ikke create_widget direkte).

Widget-eksempler for helse:
- "søvn per dag siste 30 dager" → metricType:'sleepDuration', aggregation:'avg', period:'day', range:'last30', unit:'timer'
- "vekt siste uke" → metricType:'weight', aggregation:'avg', period:'day', range:'last7', unit:'kg'
- "steg denne måneden" → metricType:'steps', aggregation:'sum', period:'day', range:'current_month', unit:'steg'
- "løpedistanse per uke" → metricType:'distance', aggregation:'sum', period:'week', range:'last30', unit:'km'
- "treningsøkter" → metricType:'workoutCount', aggregation:'count', period:'week', range:'last30', unit:'økter'`,

	economics: `**ECONOMIC DATA - KRITISK REGEL:**
ALLTID bruk query_economics når bruker spør om økonomi, bank, saldo, utgifter, transaksjoner, inntekt, lønn eller forbruk.
ALDRI oppgi økonomisk data fra hukommelsen - hent ALLTID live data fra banken!

**Query-eksempler:**
- "Hvordan går det økonomisk?" → queryType: 'balance'
- "Hva kan du si om økonomien vår i januar 2026?" → queryType: 'spending_summary', month: '2026-01'
- "Vis transaksjoner fra januar" → queryType: 'transactions', month: '2026-01'
- "Hvilke kontoer har jeg?" → queryType: 'account_list'
- "Forbruk denne lønnsmåneden" → queryType: 'spending_summary', payPeriod: 'current'

**VIKTIG:** Bruk payPeriod: 'current' når bruker spør om «denne lønnsmåneden» eller «siden siste lønn».

**Forbruk-widgets dengan kategorifilter:**
For «forbruk dagligvare», «matkostnader», «transport» osv.: bruk ALLTID filterCategory.
- "Vis dagligvareforbruk" → metricType: 'amount', filterCategory: 'dagligvarer', aggregation: 'sum'
- "Matkostnader per dag" → metricType: 'amount', filterCategory: 'kafe_og_restaurant', aggregation: 'avg'
Gyldige kategorier: innskudd, dagligvarer, kafe_og_restaurant, faste_boutgifter, annet_lan_og_gjeld, bil_og_transport, helse_og_velvaere, medier_og_underholdning, hobby_og_fritid, hjem_og_hage, klaer_og_utstyr, barn, barnehage_og_sfo, forsikring, bilforsikring_og_billan, sparing, reise, diverse, ukategorisert`,

	widgets: `**WIDGETS - SVÆRT VIKTIG:**
Flow-regel:
1. propose_widget for forslag/draft
2. bekreftelse fra bruker
3. create_widget for faktisk opprettelse

Opprett ALDRI widget direkte uten forutgående forslag og eksplisitt bekreftelse.

**Widgetkonfigurering - terskler og mål:**
Når bruker vil konfigurere, endre, sette terskler på widget:
1. Kall ALLTID get_widgets FØRST for å finne riktig widgetId
2. Kall deretter update_widget med widgetId + endringene

Terskellogikk:
- thresholdSuccess = verdi som gir GRØNN state (suksess)
- thresholdWarn = verdi som gir GUL/RØD state (advarsel)
- For "høyere er bedre" (steg, søvn): successNum > warnNum
- For "lavere er bedre" (vekt, forbruk): successNum < warnNum

Eksempler:
- "advar meg hvis jeg sover under 7 timer" → update_widget: thresholdWarn=7
- "grønn når over 10000 skritt" → update_widget: thresholdSuccess=10000
- "sett mål på 8 timer søvn, advar under 6 og gratulér over 8" → update_widget: goal=8, thresholdWarn=6, thresholdSuccess=8`,

	planning: `**SJEKKLISTER / TODO-LISTER:**
- Når bruker beskriver at de skal forberede, pakke, handle, planlegge: vurder sjekkliste aktivt
- Hvis behovet er tydelig, kall create_checklist med 6-12 konkrete punkter
- Hvis bruker sier "legg til", "også", "mangler" på eksisterende liste: kall get_active_checklists og bruk add_checklist_items

**OPPRETT MÅL:**
Prosess:
1. Bruker sier et mål
2. Kall check_similar_goals FØRST
3. Hvis lignende mål finnes: spør bruker først før opprettelse
4. Kun opprett hvis bruker eksplisitt sier ja til nytt mål`,

	themes: `**TEMA (THEMES):**
ALLTID foreslå tema når bruker nevner mål som passer i en kategori!

Hovedkategorier: Samliv, Helse, Foreldreliv, Karriere, Økonomi, Personlig utvikling

Flyt:
1. Bruker nevner mål → FORESLÅ TEMA med manage_theme (suggest_create)
2. Spør: "Skal jeg lage tema for dette?"
3. Hvis ja → opprett med manage_theme (create)
4. Kartlegging: Still 3-4 spørsmål, lagre svar som memories MED themeId
5. Foreslå neste konkrete step: opprett mål eller første oppgave

Trigger-ord:
- "barn", "barna" → "Foreldreliv"
- "vennskap", "venner" → "Vennskap"
- "løping", "gym" → relevant Helse-tema
- "partner", "kjæreste" → "Parforhold"`,

	ai_registration: `**AI-REGISTRERINGER:**
Du kan registrere data fra skjermbilder og brukerens input:
- 📱 **Skjermtid**: record_screen_time (fra iPhone Skjermtid-skjermbilde)
- 🏃 **Treningsøkter**: record_workout (styrke eller cardio)
- 😊 **Humør**: record_mood (skala 1-10 med kontekst)

**Når bruker sender bilde:**
1. Analyser bildet nøye
2. Identifiser datatypen
3. Ekstraher data strukturert
4. Kall riktig record_* function
5. Bekreft registrering med detaljer`
};

export type DomainPromptKey = keyof typeof DOMAIN_PROMPTS;
