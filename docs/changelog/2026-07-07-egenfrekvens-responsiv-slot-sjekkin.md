# Egenfrekvens: mer responsiv slot-sjekkin

Dato: 2026-07-07
Status: ferdig

## Kontekst

Tre observasjoner fra bruk av slot-sjekkinnen («Hvordan gikk …?» ved app-åpning):

1. **Spørsmålet kom for tidlig.** Det retrospektive «Hvordan gikk …?» fyrte av
   i det tidsvinduet *begynte*, ikke når perioden var over. Verst på helg/fridag,
   der ett stort «dag»-slot (10:00–19:00) spurte «Hvordan gikk dagen?» allerede
   kl. 10 — før dagen hadde skjedd.
2. **Arbeidsdag-spørsmål på ferie.** Slot-valget behandlet bare helg og norske
   røddager som fridager. En hverdag i registrert ferie fikk fortsatt
   arbeidsdag-rytmen og «Hvordan gikk arbeidsdagen?».
3. **Notater «forsvant» fra oversikten.** Skrev man notat på både formiddag og
   kveld, viste sammendraget bare det nyeste. Dataene lå trygt i databasen (én
   hendelse per sjekkin), men formiddagsnotatet var skjult i sammendragene.

## Faser

### Fase 1: Flytt slot-vinduene senere (obs. 1)

`src/lib/domains/egenfrekvens/period-slots.ts` — `WORKDAY_SLOTS` og
`WEEKEND_SLOTS` fikk nye tidsvinduer, lagt slik at «Hvordan gikk …?» fyrer når
perioden er over eller på hell:

| Skjema | Slot | Før | Nå |
|--------|------|-----|-----|
| Hverdag | natt | 05:00–07:30 | 05:00–09:00 |
| Hverdag | morgen | 07:30–12:00 | 10:00–13:00 |
| Hverdag | arbeidsdag | 14:00–18:00 | 15:30–18:00 |
| Hverdag | ettermiddag | 18:00–20:00 | 18:00–20:30 |
| Hverdag | kveld | 20:00–24:00 | 20:30–24:00 |
| Helg/fridag | natt | 05:00–07:00 | 05:00–10:00 |
| Helg/fridag | morgen | 07:00–10:00 | 10:00–13:00 |
| Helg/fridag | dag | 10:00–19:00 | 15:00–19:00 |
| Helg/fridag | kveld | 19:00–23:00 | 19:00–23:00 |

Hullene mellom vinduene (der perioden er i gang) har bevisst ingen slot — færre,
mer treffsikre spørsmål. Slot-ID-ene og skjema-medlemskapet er uendret, så alle
konsumenter (dashboard, mood-speiling, gruppering) virker som før.
Testene i `period-slots.test.ts` er oppdatert til de nye vinduene.

### Fase 2: Ferie teller som fridag (obs. 2)

Ny `src/lib/server/ferie-status.ts` med `isUserOnFerie(userId, iso)` — sjekker om
en dato faller innenfor et aktivt ferie-tema (gjenbruker `isFerieActiveOn` fra
`$lib/ferie/active-ferie`). `GET /api/egenfrekvens/checkin` returnerer nå
`isNonWorkingDay = helg/røddag ELLER aktiv ferie`, så feriedager får den rolige
helg-rytmen med «dag» i stedet for arbeidsdag-spørsmålet.

### Fase 3: Vis alle notater per dag (obs. 3)

`src/lib/components/domain/EgenfrekvensDashboard.svelte` — `pointNote` (én
notat) er byttet ut med `pointNotes` (alle slot-notater, merket med sitt slot) og
`pointNotesText` (kompakt én-linjes variant til siste-listen). «I dag»-kortet
viser hvert notat på egen linje med slot-emoji; siste-listen kjeder dem med « · ».
Faller tilbake til dagsnotatet for gamle full-sjekkins uten slot.

## Beslutninger

- **Flytt vinduer fremfor å endre ordlyd.** Beholdt det retrospektive
  spørsmålet og flyttet heller tidspunktet — enklere og uten ny ordlyd-logikk.
- **Ferie → helg-rytme fremfor egen ferie-ordlyd.** Minimal endring: gjenbruker
  den eksisterende rolige «dag»-rytmen i stedet for å innføre et eget spørsmål.
- **Notater skjules aldri.** Ingen datamodell-endring — dataene fantes allerede
  per slot; kun visningen samlet dem feil.

## Verifisering

- `npm run check` — 0 feil, 0 advarsler.
- `npm test` — alle enhetstester grønne, inkl. oppdaterte `period-slots`-tester.
