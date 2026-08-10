# Fart per hjerteslag: EF og pulsdrift

Dato: 2026-08-11
Status: ferdig (serverside) · aktivitetslistas innhold gjenstår

## Kontekst

«Finnes det noe bedre mål for pulsoppgang relativt til effort enn VO2max?
Skulle gjerne sett hvor mye flatere kurven ligger nå enn for to måneder siden.»

VO2max svarer ikke på det spørsmålet, og det er dokumentert i repoet fra før:
VDOT antar maksimal innsats, brukeren racer ikke, estimatet leser ~9 poeng lavere
enn Withings' måling på samme økt (33,7 mot 42,8), og en uke uten Withings-måling
gir et *fantomfall*. Tallet svarer i praksis på «løp du hardt denne uka».

## Endring

**Efficiency Factor** (`$lib/domain/health/aerobic-efficiency.ts`): meter per
minutt per hjerteslag, regnet på **bakkekorrigert** tempo (`gapSecPerKm`, som alt
ligger i `canonical_workouts`). Stiger den, ligger puls/fart-kurven flatere.

**Aerob decoupling**: hvor mye fart-per-slag falt fra første til andre halvdel av
en økt. Et annet spørsmål — «holdt jeg det ut» framfor «er jeg raskere per slag».

Nytt kort på Trening (`AerobicEfficiencyCard`), plassert **før** VO2max-kortet.
Decoupling går inn i øktvurderingens kontekst, der trackPoints alt er lastet.

Aktivitetslista er flyttet fra bunnen av Trening til toppen av den felles delen —
den sto tidligere under fire kort med avledede tall.

## Beslutninger

**Bakkekorrigert tempo, ikke rått.** 234 høydemeter på 8 km gjør rå fart ubrukelig
som sammenligningsgrunnlag. Terreng er den største forvekslingsfaren i akkurat
denne målingen, og `gapSecPerKm` lå allerede der.

**Bare løping.** På sykkel avgjøres farten av terreng, vind og — på el-sykkel —
hvor mye motoren ga. Fart per hjerteslag måler da utstyret, ikke deg.

**Intervaller holdes utenfor** (`MAX_HARD_SHARE`, andel tid i sone 4–5 over 25 %).
En intervalløkt har høy puls for sin snittfart, siden pausene drar snittfarten ned
mens pulsen holder seg oppe. Tar man dem med, måler trenden hvor mange
intervalløkter man har hatt.

**Minst 20 minutter.** Under det dominerer oppvarmingen: pulsen henger etter
farten de første minuttene, så EF kommer kunstig høyt ut. Det er treghet i
pulsresponsen, ikke form.

**Median, ikke snitt**, og et støygulv på 3 %. EF varierer 3–5 % mellom to like
økter på ulike dager. Under gulvet kalles det uendret — å presentere et støyutslag
som framgang er å love noe vi ikke har målt. Og `MIN_SESSIONS_FOR_TREND` (4) i
hvert vindu: en «forbedring» regnet fra to turer er en gjetning med selvtillit.

**Varmeforbeholdet står i kortet, ikke i en hjelpetekst.** Puls stiger 5–10 slag i
varmen, og «nå mot for to måneder siden» krysser i Norge nettopp fra kjøligere til
varmere. Uten forbeholdet leses sommeren som formtap. Vi har ikke temperaturdata
serverside — Ekkos `WeatherPoint` sendes ikke — så dette er en tekst, ikke en
korreksjon. Det skal det stå som.

**Decoupling deler på TID, ikke distanse.** Blir man tregere utover, dekker andre
halvdel færre meter, og en distansedeling ville flyttet skillet inn i den friske
delen og underdrevet driften.

**EF står før VO2max på flata.** Det er det målet som faktisk svarer på
spørsmålet; VO2max blir stående som kryssjekk.

## Verifisering

- 28 nye enhetstester (24 i `aerobic-efficiency.test.ts`, 4 for pulsdrift i
  kontekstbyggeren).
- `npm test`: 3188 tester i 235 filer passerer.
- `npm run check`: 0 feil, 0 advarsler. `npm run build` går gjennom.

**Ikke verifisert mot prod.** Signalet er ikke sett på ekte data. Det som må
sjekkes ved første besøk: at det i det hele tatt finnes fire kvalifiserende
løpeøkter i hvert vindu — kravet om `gapSecPerKm` *og* puls *og* 20 minutter *og*
lav sone-4/5-andel kan vise seg å være strengt nok til at kortet sier «for få
økter» hele tiden. Da er det tersklene som må ned, ikke kravet som skal fjernes.

## Gjenstår

- **Aktivitetslista har fått ny plassering, men ikke nytt innhold.** Bakker,
  runder, rundetider og distanserekorder per rad står igjen. Rekordene kan regnes
  i dag (`workout-nugget-rules.ts`); bakker og runder krever Ekko-analysen, som
  ikke finnes i prod før appen er ute.
- Sparklinen er inline i kortet. De to som fantes (`WaistSparkline`,
  `RelationSparkline`) tar domenespesifikke props. Trenger et kort til det samme,
  hører den i `ui/`.
- Decoupling vises bare i vurderingens kontekst, ikke som et eget tall på
  aktivitetssida.
