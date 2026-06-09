# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> Helse-tema >> helsedashboard rendres
- Location: tests/visual/pages.spec.ts:20:2

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  Expected an image 390px by 3417px, received 390px by 3427px. 75190 pixels (ratio 0.06 of all image pixels) are different.

  Snapshot: tema-helse.png

Call log:
  - Expect "toHaveScreenshot(tema-helse.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - Expected an image 390px by 3417px, received 390px by 3427px. 75190 pixels (ratio 0.06 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - Expected an image 390px by 3417px, received 390px by 3427px. 75190 pixels (ratio 0.06 of all image pixels) are different.

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e5]:
    - generic:
      - img
    - generic [ref=e7]:
      - generic [ref=e11]:
        - button "Gå til forsiden" [ref=e12] [cursor=pointer]:
          - generic [ref=e13]:
            - generic [ref=e14]: 🏋️‍♂️
            - heading "Helse" [level=1] [ref=e15]
        - paragraph [ref=e16]: Fokus på fysisk og mental helse
      - tablist "Tema-seksjoner" [ref=e17]:
        - tab "💬 Samtaler" [ref=e18] [cursor=pointer]
        - tab "💪 Helse" [selected] [ref=e19] [cursor=pointer]
        - tab "🎯 Mål" [ref=e20] [cursor=pointer]
        - tab "🧭 Flyter" [ref=e21] [cursor=pointer]
        - tab "📁 Filer" [ref=e22] [cursor=pointer]
      - generic [ref=e24]:
        - generic [ref=e25]:
          - button "⚙" [ref=e26] [cursor=pointer]
          - generic [ref=e27]:
            - complementary [ref=e28]:
              - link "Aktivt program 10k på 55 minutter 1 / 51 fullført · 10 uker I dag Styrke A" [ref=e29] [cursor=pointer]:
                - /url: /treningsprogram/a0583ebd-df28-4466-b037-44106315042a
                - generic [ref=e30]:
                  - generic [ref=e31]: Aktivt program
                  - heading "10k på 55 minutter" [level=2] [ref=e32]
                  - paragraph [ref=e33]: 1 / 51 fullført · 10 uker
                - generic [ref=e34]:
                  - generic [ref=e35]: I dag
                  - generic [ref=e36]: Styrke A
            - link "Åpne skjermtid" [ref=e37] [cursor=pointer]:
              - /url: /skjermtid
              - generic [ref=e38]:
                - generic [ref=e39]: Skjermtid · siste uke
                - generic [ref=e40]: Se mer →
              - generic [ref=e42]:
                - generic [ref=e43]:
                  - generic [ref=e44]: Skjermtid · snitt/dag
                  - generic [ref=e45]: 7t 58m
                  - generic [ref=e46]: ↑ 2t 6m fra forrige uke
                - generic [ref=e47]:
                  - generic [ref=e48]: Scrolling · snitt/dag
                  - generic [ref=e49]: 2t 26m
                  - generic [ref=e50]: ↑ 1t 18m
            - tablist "Helseperioder" [ref=e51]:
              - group "Periodevalg" [ref=e52]:
                - button "7d" [ref=e53] [cursor=pointer]
                - button "30d" [pressed] [ref=e54] [cursor=pointer]
                - button "365d" [ref=e55] [cursor=pointer]
                - button "Uke" [ref=e56] [cursor=pointer]
                - button "Måned" [ref=e57] [cursor=pointer]
                - button "Kvartal" [ref=e58] [cursor=pointer]
                - button "År" [ref=e59] [cursor=pointer]
            - generic [ref=e61]:
              - generic [ref=e62]:
                - generic [ref=e63]:
                  - generic [ref=e64]: Relativ effort (snitt/uke)
                  - generic [ref=e65]: Siste 30 dager
                - generic [ref=e67]: "294"
              - generic "Effort per uke" [ref=e68]:
                - generic [ref=e72]: U19
                - generic [ref=e73]:
                  - generic [ref=e74]:
                    - 'generic "10% over forrige: 241"'
                  - generic [ref=e76]: U20
                - generic [ref=e77]:
                  - generic [ref=e78]:
                    - 'generic "10% over forrige: 212"'
                  - generic [ref=e80]: U21
                - generic [ref=e81]:
                  - generic [ref=e82]:
                    - 'generic "10% over forrige: 190"'
                  - generic [ref=e84]: U22
                - generic [ref=e85]:
                  - generic [ref=e86]:
                    - 'generic "10% over forrige: 273"'
                  - generic [ref=e88]: U23
                - generic [ref=e89]:
                  - generic [ref=e90]:
                    - 'generic "10% over forrige: 407"'
                  - generic [ref=e92]: U24
              - paragraph [ref=e93]: Stiplet linje = +10% fra forrige periode (byggesone-tak). Du har gått over taket noen uker.
              - generic [ref=e94]:
                - generic "Effort per aktivitet" [ref=e95]:
                  - 'generic "Løping: 574" [ref=e96]'
                  - 'generic "Elsykkel: 294" [ref=e97]'
                  - 'generic "Sykkel: 237" [ref=e98]'
                  - 'generic "Annet: 76" [ref=e99]'
                  - 'generic "Yoga: 66" [ref=e100]'
                  - 'generic "Gåing: 14" [ref=e101]'
                - list [ref=e102]:
                  - listitem [ref=e103]:
                    - generic [ref=e105]: Løping
                    - generic [ref=e106]: "574"
                  - listitem [ref=e107]:
                    - generic [ref=e109]: Elsykkel
                    - generic [ref=e110]: "294"
                  - listitem [ref=e111]:
                    - generic [ref=e113]: Sykkel
                    - generic [ref=e114]: "237"
                  - listitem [ref=e115]:
                    - generic [ref=e117]: Annet
                    - generic [ref=e118]: "76"
                  - listitem [ref=e119]:
                    - generic [ref=e121]: Yoga
                    - generic [ref=e122]: "66"
                  - listitem [ref=e123]:
                    - generic [ref=e125]: Gåing
                    - generic [ref=e126]: "14"
              - generic [ref=e127]:
                - generic [ref=e128]: 59 økter
                - generic [ref=e129]: ·
                - generic [ref=e130]: 60% fra puls
            - generic [ref=e131]:
              - generic [ref=e132]:
                - generic [ref=e133]:
                  - generic [ref=e134]:
                    - generic [ref=e135]: Form (CTL)
                    - generic [ref=e136]: 42d eksponentielt snitt
                  - generic [ref=e137]:
                    - generic [ref=e138]: "25"
                    - generic [ref=e139]: +4.4 vs 14d
                - generic "Form over tid" [ref=e140]:
                  - img [ref=e141]
                  - generic [ref=e144]:
                    - generic [ref=e145]: jun
                    - generic [ref=e146]: aug
                    - generic [ref=e147]: okt
                    - generic [ref=e148]: des
                    - generic [ref=e149]: feb
                    - generic [ref=e150]: apr
                    - generic [ref=e151]: jun
                - generic [ref=e152]: Form viser hvor mye du tåler i snitt — bygger seg opp over uker, ikke dager.
              - generic [ref=e153]:
                - generic [ref=e154]:
                  - generic [ref=e155]:
                    - generic [ref=e156]: Belastningsbalanse (TSB)
                    - generic [ref=e157]: Form − Tretthet
                  - generic [ref=e158]:
                    - generic [ref=e159]: "-11"
                    - generic [ref=e160]: Sliten
                - generic "TSB-skala fra sliten til fersk" [ref=e161]:
                  - generic [ref=e167]:
                    - generic [ref=e168]: Sliten
                    - generic [ref=e169]: I balanse
                    - generic [ref=e170]: Fersk
                - generic "TSB siste 90 dager" [ref=e171]:
                  - img [ref=e172]
                - generic [ref=e175]: Akutt belastning over form. Vurder en lett dag snart.
            - generic [ref=e177]:
              - button "101.4 kg" [ref=e178] [cursor=pointer]:
                - generic [ref=e181]: "101.4"
                - generic [ref=e182]: kg
              - button "176.7 km" [ref=e183] [cursor=pointer]:
                - generic [ref=e186]: "176.7"
                - generic [ref=e187]: km
              - button "57 min" [ref=e188] [cursor=pointer]:
                - generic [ref=e191]: "57"
                - generic [ref=e192]: min
              - button "306.9 t" [ref=e193] [cursor=pointer]:
                - generic [ref=e196]: "306.9"
                - generic [ref=e197]: t
              - button "7k skritt" [ref=e198] [cursor=pointer]:
                - generic [ref=e201]: 7k
                - generic [ref=e202]: skritt
              - button "– slag/min" [ref=e203] [cursor=pointer]:
                - generic [ref=e206]: –
                - generic [ref=e207]: slag/min
            - generic [ref=e208]:
              - generic [ref=e209]:
                - heading "Perioder" [level=2] [ref=e210]
                - generic [ref=e211]:
                  - button "Siste 5" [ref=e212] [cursor=pointer]
                  - button "I år" [ref=e213] [cursor=pointer]
                  - button "Siste år" [ref=e214] [cursor=pointer]
                  - button "Alt" [ref=e215] [cursor=pointer]
              - table [ref=e217]:
                - rowgroup [ref=e218]:
                  - row "Periode ⚖️ 🏃 ⚡ ⏰ 💓" [ref=e219]:
                    - columnheader "Periode" [ref=e220]
                    - columnheader "⚖️" [ref=e221]
                    - columnheader "🏃" [ref=e222]
                    - columnheader "⚡" [ref=e223]
                    - columnheader "⏰" [ref=e224]
                    - columnheader "💓" [ref=e225]
                - rowgroup [ref=e226]:
                  - row "Jun 2026 -0.6 60.6 97 63 58" [ref=e227]:
                    - cell "Jun 2026" [ref=e228]
                    - cell "-0.6" [ref=e229]:
                      - generic [ref=e230]: "-0.6"
                    - cell "60.6" [ref=e231]:
                      - generic [ref=e232]: "60.6"
                    - cell "97" [ref=e233]:
                      - generic [ref=e234]: "97"
                    - cell "63" [ref=e235]:
                      - generic [ref=e236]: "63"
                    - cell "58" [ref=e237]:
                      - generic [ref=e238]: "58"
                  - row "Mai 2026 -1.4 117.6 214 48 62" [ref=e239]:
                    - cell "Mai 2026" [ref=e240]
                    - cell "-1.4" [ref=e241]:
                      - generic [ref=e242]: "-1.4"
                    - cell "117.6" [ref=e243]:
                      - generic [ref=e244]: "117.6"
                    - cell "214" [ref=e245]:
                      - generic [ref=e246]: "214"
                    - cell "48" [ref=e247]:
                      - generic [ref=e248]: "48"
                    - cell "62" [ref=e249]:
                      - generic [ref=e250]: "62"
                  - row "Apr 2026 -1.5 77.0 166 58 62" [ref=e251]:
                    - cell "Apr 2026" [ref=e252]
                    - cell "-1.5" [ref=e253]:
                      - generic [ref=e254]: "-1.5"
                    - cell "77.0" [ref=e255]:
                      - generic [ref=e256]: "77.0"
                    - cell "166" [ref=e257]:
                      - generic [ref=e258]: "166"
                    - cell "58" [ref=e259]:
                      - generic [ref=e260]: "58"
                    - cell "62" [ref=e261]:
                      - generic [ref=e262]: "62"
                  - row "Mar 2026 -0.8 34.4 12 53 61" [ref=e263]:
                    - cell "Mar 2026" [ref=e264]
                    - cell "-0.8" [ref=e265]:
                      - generic [ref=e266]: "-0.8"
                    - cell "34.4" [ref=e267]:
                      - generic [ref=e268]: "34.4"
                    - cell "12" [ref=e269]:
                      - generic [ref=e270]: "12"
                    - cell "53" [ref=e271]:
                      - generic [ref=e272]: "53"
                    - cell "61" [ref=e273]:
                      - generic [ref=e274]: "61"
                  - row "Feb 2026 +1.3 34.2 – 61 61" [ref=e275]:
                    - cell "Feb 2026" [ref=e276]
                    - cell "+1.3" [ref=e277]:
                      - generic [ref=e278]: "+1.3"
                    - cell "34.2" [ref=e279]:
                      - generic [ref=e280]: "34.2"
                    - cell "–" [ref=e281]:
                      - generic [ref=e282]: –
                    - cell "61" [ref=e283]:
                      - generic [ref=e284]: "61"
                    - cell "61" [ref=e285]:
                      - generic [ref=e286]: "61"
            - generic [ref=e287]:
              - generic [ref=e288]:
                - heading "Treningsøkter" [level=2] [ref=e289]
                - generic [ref=e290]:
                  - button "Alle" [ref=e291] [cursor=pointer]
                  - button "🧘‍♂️ Yoga" [ref=e292] [cursor=pointer]
                  - button "🚴 Elsykkel" [ref=e293] [cursor=pointer]
                  - button "🏃 Løping" [ref=e294] [cursor=pointer]
                  - button "🚴 Sykling" [ref=e295] [cursor=pointer]
                  - button "⚽ Fotball" [ref=e296] [cursor=pointer]
                  - button "🚶 Gåtur" [ref=e297] [cursor=pointer]
                  - button "🚣 Roing" [ref=e298] [cursor=pointer]
              - generic [ref=e299]:
                - button "🏃 Løping · 14 t siden · 7.2 km · 49 min ›" [ref=e301] [cursor=pointer]:
                  - generic [ref=e302]: 🏃
                  - generic [ref=e304]: Løping · 14 t siden · 7.2 km · 49 min
                  - generic [ref=e305]: ›
                - button "🧘‍♂️ Yoga · 15 t siden · 5 min ›" [ref=e307] [cursor=pointer]:
                  - generic [ref=e308]: 🧘‍♂️
                  - generic [ref=e310]: Yoga · 15 t siden · 5 min
                  - generic [ref=e311]: ›
                - button "⚽ Fotball · lør. 6. juni · 1.2 km · 25 min ›" [ref=e313] [cursor=pointer]:
                  - generic [ref=e314]: ⚽
                  - generic [ref=e316]: Fotball · lør. 6. juni · 1.2 km · 25 min
                  - generic [ref=e317]: ›
                - button "🏃 Løping · fre. 5. juni · 7.8 km · 51 min ›" [ref=e319] [cursor=pointer]:
                  - generic [ref=e320]: 🏃
                  - generic [ref=e322]: Løping · fre. 5. juni · 7.8 km · 51 min
                  - generic [ref=e323]: ›
                - button "🏃 Løping · ons. 3. juni · 4.0 km · 25 min ›" [ref=e325] [cursor=pointer]:
                  - generic [ref=e326]: 🏃
                  - generic [ref=e328]: Løping · ons. 3. juni · 4.0 km · 25 min
                  - generic [ref=e329]: ›
                - button "🚴 Elsykkel · ons. 3. juni · 8.6 km · 30 min ›" [ref=e331] [cursor=pointer]:
                  - generic [ref=e332]: 🚴
                  - generic [ref=e334]: Elsykkel · ons. 3. juni · 8.6 km · 30 min
                  - generic [ref=e335]: ›
                - button "🚴 Sykling · ons. 3. juni · 8.9 km · 25 min ›" [ref=e337] [cursor=pointer]:
                  - generic [ref=e338]: 🚴
                  - generic [ref=e340]: Sykling · ons. 3. juni · 8.9 km · 25 min
                  - generic [ref=e341]: ›
                - button "🧘‍♂️ Yoga · ons. 3. juni · 5 min ›" [ref=e343] [cursor=pointer]:
                  - generic [ref=e344]: 🧘‍♂️
                  - generic [ref=e346]: Yoga · ons. 3. juni · 5 min
                  - generic [ref=e347]: ›
                - button "🚴 Sykling · tir. 2. juni · 25 min ›" [ref=e349] [cursor=pointer]:
                  - generic [ref=e350]: 🚴
                  - generic [ref=e352]: Sykling · tir. 2. juni · 25 min
                  - generic [ref=e353]: ›
                - button "🏃 Løping · tir. 2. juni · 7.6 km · 51 min ›" [ref=e355] [cursor=pointer]:
                  - generic [ref=e356]: 🏃
                  - generic [ref=e358]: Løping · tir. 2. juni · 7.6 km · 51 min
                  - generic [ref=e359]: ›
              - button "Vis flere (87 gjenstår)" [ref=e360] [cursor=pointer]
            - region "Kilder" [ref=e362]:
              - generic [ref=e363]:
                - heading "Kilder" [level=3] [ref=e365]
                - generic [ref=e367]: "4"
              - list [ref=e368]:
                - listitem [ref=e369]:
                  - generic [ref=e370]:
                    - paragraph [ref=e371]: Withings Account
                    - paragraph [ref=e372]: withings
                  - generic [ref=e373]:
                    - paragraph [ref=e374]: Aktiv
                    - paragraph [ref=e375]: Synket 9.6., 22:19
                - listitem [ref=e376]:
                  - generic [ref=e377]:
                    - paragraph [ref=e378]: Skjermtid
                    - paragraph [ref=e379]: screen_time
                  - generic [ref=e380]:
                    - paragraph [ref=e381]: Aktiv
                    - paragraph [ref=e382]: Aldri synket
                - listitem [ref=e383]:
                  - generic [ref=e384]:
                    - paragraph [ref=e385]: E-post import
                    - paragraph [ref=e386]: email
                  - generic [ref=e387]:
                    - paragraph [ref=e388]: Aktiv
                    - paragraph [ref=e389]: Synket 19.5., 08:44
                - listitem [ref=e390]:
                  - generic [ref=e391]:
                    - paragraph [ref=e392]: Dropbox Løpsfiler
                    - paragraph [ref=e393]: dropbox
                  - generic [ref=e394]:
                    - paragraph [ref=e395]: Inaktiv
                    - paragraph [ref=e396]: Synket 22.4., 12:08
            - group [ref=e397]:
              - generic "Hendelsesdetaljer (24 hendelser)" [ref=e398] [cursor=pointer]:
                - generic [ref=e399]: Hendelsesdetaljer
                - generic [ref=e400]: (24 hendelser)
        - paragraph [ref=e401]: "Sist lagret: 9.6., 22:27"
        - group [ref=e402]:
          - generic "Signalinput 0 aktive" [ref=e403] [cursor=pointer]:
            - generic [ref=e404]: Signalinput
            - generic [ref=e405]: 0 aktive
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Hjem', () => {
  4  | 	test('dashboard rendres uten feil', async ({ page }) => {
  5  | 		await page.goto('/');
  6  | 		await page.waitForLoadState('networkidle');
  7  | 		await expect(page).toHaveScreenshot('hjem.png', { fullPage: true });
  8  | 	});
  9  | });
  10 | 
  11 | test.describe('Ukeplan', () => {
  12 | 	test('ukeplanen rendres', async ({ page }) => {
  13 | 		await page.goto('/ukeplan');
  14 | 		await page.waitForLoadState('networkidle');
  15 | 		await expect(page).toHaveScreenshot('ukeplan.png', { fullPage: true });
  16 | 	});
  17 | });
  18 | 
  19 | test.describe('Helse-tema', () => {
  20 | 	test('helsedashboard rendres', async ({ page }) => {
  21 | 		await page.goto('/tema/helse');
  22 | 		await page.waitForLoadState('networkidle');
> 23 | 		await expect(page).toHaveScreenshot('tema-helse.png', { fullPage: true });
     |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
  24 | 	});
  25 | });
  26 | 
  27 | test.describe('Økonomi-tema', () => {
  28 | 	test('økonomidashboard rendres', async ({ page }) => {
  29 | 		await page.goto('/tema/økonomi');
  30 | 		await page.waitForLoadState('networkidle');
  31 | 		await expect(page).toHaveScreenshot('tema-okonomi.png', { fullPage: true });
  32 | 	});
  33 | });
  34 | 
  35 | test.describe('Design-system', () => {
  36 | 	test('UI-primitiver rendres', async ({ page }) => {
  37 | 		await page.goto('/design');
  38 | 		await page.waitForLoadState('networkidle');
  39 | 		await expect(page).toHaveScreenshot('design.png', { fullPage: true });
  40 | 	});
  41 | });
  42 | 
```