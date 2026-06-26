# Fullskjerm kartfortelling (scrollytelling)

Dato: 2026-06-26
Status: ferdig

## Kontekst

Kartfortellingen (`TripMapStory`) hadde til nå én modus: inline i reise-/ferie-dashbordet
med dag-nåler, animert rutelinje og frie bilde-nåler, som støtter dag-for-dag-lista.

Brukeren ville ha en **modus nummer to**: en fullskjerm-opplevelse der kartet ligger
fixed i bakgrunnen og man scroller stegvis fra dag til dag, mens reiserute og markører
animerer inn og fremheves. Inline-modusen beholdes uendret.

### Beslutning om bildebehandling

Vi diskuterte tre måter å vise bilder på i fullskjerm:

1. **Kort-overlay, behold format** (valgt) — kartet er alltid synlig, dag-innholdet
   ligger i et kort over nedre halvdel med mørk gradient bak teksten. Bilder beholder
   sitt eget format med cap på høyden.
2. Full-bleed med crossfade — bilder fyller skjermen, kartet fades ut/inn per dag.
3. Kvadratlåste bilder over kartet.

Valget falt på (1). Begrunnelse: premisset er at kartet er den faste stjernen som
animerer kontinuerlig under deg. Full-bleed ville tvunget krysse-fading av kartet for
hver dag, noe som bryter med følelsen av at ruten vokser sammenhengende. Kort-overlay
holder kartet i live hele veien, og portrettbilder slipper stygg kvadrat-beskjæring.
En valgfri full-bleed «hero»-modus per bilde kan legges til senere uten ombygging.

## Faser

### Fase 1: Testbar rute-vekst-logikk

`src/lib/components/domain/trip-map-story.ts`: ny `cumulativeFractions(coords)` som gir
andelen (0–1) av total rutelengde man har tilbakelagt ved hvert punkt. Brukes til å
animere ruten til å vokse nøyaktig fram til den aktive dagen. Faller tilbake til jevn
fordeling når alle punktene er like (total lengde 0). Enhetstestet i
`trip-map-story.test.ts` (4 nye tester).

### Fase 2: Fullskjerm-komponent

`src/lib/components/domain/TripMapStoryFull.svelte` (ny):

- MapLibre-kart som `position: fixed` bakgrunn, `interactive: false` (kamera styres av
  scroll, ikke av brukeren). Gjenbruker `RESONANS_DARK_MAP_STYLE` og rute-lag fra
  inline-modusen.
- En scroll-container med ett `min-height: 100svh`-steg per dag, pluss intro-steg
  (oversikt over hele ruten) og avslutnings-steg.
- `IntersectionObserver` (rootMargin `-45%`) finner det aktive steget når kortet treffer
  midtbåndet → setter `activeIndex`.
- Per steg: kamera `fitBounds` på strekningen forrige→denne dag (synliggjør reisen),
  ruten vokser inkrementelt via `partialPath` + `cumulativeFractions`, aktiv markør
  forstørres/glør og senere markører dempes.
- Dag-kortet glir opp i nedre halvdel med mørk gradient: dato, vær, sted, oneliner og
  bilder (horisontal stripe, beholder format, cap på høyde). Frie bilde-nåler vises hele
  veien og lyser opp på sin egen dato.
- `prefers-reduced-motion`: hopper over linje-/markør-animasjon og kamera-flyturer.
- Bunn-padding i `fitBounds` holder den aktive nåla i øvre, ledige halvdel over kortet.
- Escape lukker; body-scroll låses mens overlayet er åpent.

### Fase 3: Inngang fra inline-modus

`src/lib/components/domain/TripMapStory.svelte`: «▶ Spill av» åpner nå fullskjerm
(`fullscreen = true`) i stedet for å replaye inline-animasjonen. Overlayet får de
allerede innlastede `dayPins` og bilde-nålene, så ingen ny henting. Fjernet ubrukt
`mapReady`-state. Inline auto-animasjon ved innlasting beholdt.

## Beslutninger

- **Egen overlay, ikke egen rute:** fullskjerm rendres som et `position: fixed`-overlay
  (z-index 300) inne i tema-treet, så `--tp-*`-variablene arves. Ingen ny SvelteKit-rute
  — enklere, og delbar/bokmerkbar URL var ikke et krav nå.
- **Gjenbruk av byggeklosser:** dag-nåler, `partialPath`, kartstil og bilde-nåler deles
  med inline-modusen. Ny logikk (`cumulativeFractions`) ligger i den testbare `.ts`-fila.
- **Kartet er ikke-interaktivt** i fortellingen: scroll er navigasjonen, ikke pan/zoom.

## Verifisering

- `npm test`: 810 tester grønne (4 nye for `cumulativeFractions`).
- `npm run check`: 0 errors, 0 warnings.
- Manuell verifisering av selve scroll-/animasjonsopplevelsen gjenstår i nettleser
  (krever reise-tema med ≥2 geokodede dagboksdager).
