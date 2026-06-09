# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> Ukeplan >> ukeplanen rendres
- Location: tests/visual/pages.spec.ts:12:2

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  Expected an image 390px by 1639px, received 390px by 1598px. 42997 pixels (ratio 0.07 of all image pixels) are different.

  Snapshot: ukeplan.png

Call log:
  - Expect "toHaveScreenshot(ukeplan.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - Expected an image 390px by 1639px, received 390px by 1598px. 42995 pixels (ratio 0.07 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - Expected an image 390px by 1639px, received 390px by 1598px. 42997 pixels (ratio 0.07 of all image pixels) are different.

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e5]:
    - generic:
      - img
    - generic [ref=e7]:
      - generic [ref=e8]:
        - link "Uke 24" [ref=e11] [cursor=pointer]:
          - /url: /
          - heading "Uke 24" [level=1] [ref=e13]
        - generic [ref=e14]:
          - link "Til månedsplan" [ref=e15] [cursor=pointer]:
            - /url: /maanedsplan?month=2026-06
            - text: Mnd
          - generic [ref=e16]:
            - button "Velg uke" [ref=e17]:
              - img [ref=e18]
            - textbox: 2026-06-08
      - group "Planleggingshandlinger" [ref=e20]:
        - button "📋 Planlegg dag" [ref=e21] [cursor=pointer]:
          - generic [ref=e22]: 📋
          - generic [ref=e23]: Planlegg dag
        - button "✅ Avslutt dag" [ref=e24] [cursor=pointer]:
          - generic [ref=e25]: ✅
          - generic [ref=e26]: Avslutt dag
      - generic [ref=e27]:
        - heading "Ukesnotat" [level=2] [ref=e29]
        - textbox "Ferien er over og vi skal tilbake til jobb, skole og barnehage." [ref=e32]: En litt rolig uke før VM og bursdag og avslutningsmaraton. Faguke på jobb, Anita skal kanskje til Volda fredag-søndag.
      - generic [ref=e34]:
        - generic [ref=e35]:
          - heading "Ukas oppgaver" [level=2] [ref=e36]
          - generic [ref=e37]: 11 totalt
        - list [ref=e40]:
          - listitem [ref=e41]:
            - generic [ref=e42]:
              - generic [ref=e43]: 🏃 Jogge
              - generic [ref=e44]:
                - button "Marker som gjort" [ref=e46] [cursor=pointer]
                - button "Marker som gjort" [ref=e48] [cursor=pointer]
                - button "Marker som ikke gjort" [ref=e50] [cursor=pointer]:
                  - generic [ref=e51]: ✓
                - button "Marker som ikke gjort" [ref=e53] [cursor=pointer]:
                  - generic [ref=e54]: ✓
          - listitem [ref=e55]:
            - generic [ref=e56]:
              - generic [ref=e57]: 🧘 Yoga
              - generic [ref=e58]:
                - button "Marker som gjort" [ref=e60] [cursor=pointer]
                - button "Marker som gjort" [ref=e62] [cursor=pointer]
                - button "Marker som gjort" [ref=e64] [cursor=pointer]
                - button "Marker som gjort" [ref=e66] [cursor=pointer]
                - button "Marker som ikke gjort" [ref=e68] [cursor=pointer]:
                  - generic [ref=e69]: ✓
          - listitem [ref=e70]:
            - generic [ref=e71]:
              - generic [ref=e72]: 🏃 Jogge langt
              - generic [ref=e73]:
                - button "Marker som ikke gjort" [ref=e75] [cursor=pointer]:
                  - generic [ref=e76]: ✓
                - button "Marker som ikke gjort" [ref=e78] [cursor=pointer]:
                  - generic [ref=e79]: ✓
        - textbox "Skriv punkt og trykk Enter (skriv @ for å nevne en person)" [ref=e82]
      - generic [ref=e84]:
        - heading "Dager og dagsmål" [level=2] [ref=e86]
        - generic "Ukas dager" [ref=e87]:
          - button "Man 8" [ref=e88] [cursor=pointer]:
            - generic [ref=e89]: Man
            - generic [ref=e90]: "8"
          - button "I dag 9" [ref=e91] [cursor=pointer]:
            - generic [ref=e92]: I dag
            - generic [ref=e93]: "9"
          - button "Ons 10" [ref=e94] [cursor=pointer]:
            - generic [ref=e95]: Ons
            - generic [ref=e96]: "10"
          - button "Tor 11" [ref=e97] [cursor=pointer]:
            - generic [ref=e98]: Tor
            - generic [ref=e99]: "11"
          - button "Fre 12" [ref=e100] [cursor=pointer]:
            - generic [ref=e101]: Fre
            - generic [ref=e102]: "12"
          - button "Lør 13" [ref=e103] [cursor=pointer]:
            - generic [ref=e104]: Lør
            - generic [ref=e105]: "13"
          - button "Søn 14" [ref=e106] [cursor=pointer]:
            - generic [ref=e107]: Søn
            - generic [ref=e108]: "14"
        - textbox "Liten plan for I dag..." [ref=e111]
        - list [ref=e113]:
          - listitem [ref=e114]:
            - generic [ref=e116]:
              - button "Utvid rutine" [ref=e117] [cursor=pointer]: ▸
              - button "☕️ Morgen" [ref=e118] [cursor=pointer]:
                - generic [ref=e119]: ☕️
                - generic [ref=e120]: Morgen
              - img [ref=e121]
          - listitem [ref=e124]:
            - generic [ref=e126]:
              - button "Utvid rutine" [ref=e127] [cursor=pointer]: ▸
              - button "🏫 Kveld" [ref=e128] [cursor=pointer]:
                - generic [ref=e129]: 🏫
                - generic [ref=e130]: Kveld
              - img [ref=e131]
          - listitem [ref=e134]:
            - generic [ref=e136]:
              - button "Bytte sykkeldekk" [ref=e137] [cursor=pointer]:
                - generic [ref=e139]: Bytte sykkeldekk
              - button "Marker som gjort" [ref=e140] [cursor=pointer]
              - generic [ref=e141]: ⋮⋮
          - listitem [ref=e142]:
            - generic [ref=e144]:
              - button "Løpe til jobb 🏃 Auto" [ref=e145] [cursor=pointer]:
                - generic [ref=e147]: Løpe til jobb
                - generic "Registrert som aktivitet – hakes av automatisk når en matchende økt synkes" [ref=e148]: 🏃 Auto
              - button "Marker som ikke gjort" [ref=e149] [cursor=pointer]:
                - generic [ref=e150]: ✓
              - generic [ref=e151]: ⋮⋮
          - listitem [ref=e152]:
            - generic [ref=e154]:
              - button "Ekstra skift til Iver" [ref=e155] [cursor=pointer]:
                - generic [ref=e157]: Ekstra skift til Iver
              - button "Marker som ikke gjort" [ref=e158] [cursor=pointer]:
                - generic [ref=e159]: ✓
              - generic [ref=e160]: ⋮⋮
          - listitem [ref=e161]:
            - generic [ref=e163]:
              - button "Levere Iver" [ref=e164] [cursor=pointer]:
                - generic [ref=e166]: Levere Iver
              - button "Marker som ikke gjort" [ref=e167] [cursor=pointer]:
                - generic [ref=e168]: ✓
              - generic [ref=e169]: ⋮⋮
        - textbox "Ny oppgave (skriv @ for å nevne en person)" [ref=e172]
      - generic [ref=e174]:
        - heading "Målbilde og retning" [level=2] [ref=e176]
        - list [ref=e177]:
          - listitem [ref=e178]:
            - link "Redusere vekt til 100 kg 15. juni 101.4 kg mål 100 kg" [ref=e179] [cursor=pointer]:
              - /url: /goals?goal=63f601c4-9491-4f8d-92a7-9d4f5436fbb1
              - generic [ref=e180]:
                - generic [ref=e181]: Redusere vekt til 100 kg
                - generic [ref=e182]: 15. juni
              - generic [ref=e187]:
                - generic [ref=e188]: 101.4 kg
                - generic [ref=e189]: mål 100 kg
          - listitem [ref=e190]:
            - link "Løping 30. juni 26.6 km av 60 km · 44%" [ref=e191] [cursor=pointer]:
              - /url: /goals?goal=4e90c17f-4a55-4fe8-99d7-68aa426ff34a
              - generic [ref=e192]:
                - generic [ref=e193]: Løping
                - generic [ref=e194]: 30. juni
              - generic [ref=e198]:
                - generic [ref=e199]: 26.6 km
                - generic [ref=e200]: av 60 km · 44%
          - listitem [ref=e201]:
            - link "Planlegging uten dato" [ref=e202] [cursor=pointer]:
              - /url: /goals?goal=e7840083-9cab-4582-9e0a-acdcb6551523
              - generic [ref=e203]:
                - generic [ref=e204]: Planlegging
                - generic [ref=e205]: uten dato
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
> 15 | 		await expect(page).toHaveScreenshot('ukeplan.png', { fullPage: true });
     |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
  16 | 	});
  17 | });
  18 | 
  19 | test.describe('Helse-tema', () => {
  20 | 	test('helsedashboard rendres', async ({ page }) => {
  21 | 		await page.goto('/tema/helse');
  22 | 		await page.waitForLoadState('networkidle');
  23 | 		await expect(page).toHaveScreenshot('tema-helse.png', { fullPage: true });
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