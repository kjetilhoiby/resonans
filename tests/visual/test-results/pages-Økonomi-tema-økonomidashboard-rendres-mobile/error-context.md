# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> Økonomi-tema >> økonomidashboard rendres
- Location: tests/visual/pages.spec.ts:28:2

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  Expected an image 390px by 1834px, received 390px by 1811px. 44617 pixels (ratio 0.07 of all image pixels) are different.

  Snapshot: tema-okonomi.png

Call log:
  - Expect "toHaveScreenshot(tema-okonomi.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - Expected an image 390px by 1834px, received 390px by 1811px. 44617 pixels (ratio 0.07 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - Expected an image 390px by 1834px, received 390px by 1811px. 44617 pixels (ratio 0.07 of all image pixels) are different.

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
            - generic [ref=e14]: 💰
            - heading "Økonomi" [level=1] [ref=e15]
        - paragraph [ref=e16]: Håndtere økonomiske mål, budsjett, sparing og utgifter.
      - tablist "Tema-seksjoner" [ref=e17]:
        - tab "💬 Samtaler" [ref=e18] [cursor=pointer]
        - tab "💰 Økonomi" [selected] [ref=e19] [cursor=pointer]
        - tab "🎯 Mål" [ref=e20] [cursor=pointer]
        - tab "🧭 Flyter" [ref=e21] [cursor=pointer]
        - tab "📁 Filer" [ref=e22] [cursor=pointer]
      - generic [ref=e24]:
        - generic [ref=e25]:
          - tablist [ref=e26]:
            - tab "Oversikt" [selected] [ref=e27] [cursor=pointer]
            - tab "Forbruk" [ref=e28] [cursor=pointer]
            - tab "Lønnsmåned" [ref=e29] [cursor=pointer]
          - paragraph [ref=e30]: Forbruk per dag siden lønn — nåværende periode er 20 dager.Stiplet linje viser snitt av 3 foregående perioder.
          - generic [ref=e31]:
            - button "6 997 kr/dag 139 937 kr totalt Forbruk / dag fra 21. mai til i dag ↑ 6 851 kr/dag forrige" [ref=e32] [cursor=pointer]:
              - generic [ref=e33]:
                - paragraph [ref=e34]: 6 997 kr/dag
                - paragraph [ref=e35]: 139 937 kr totalt
              - img [ref=e37]
              - generic [ref=e41]:
                - paragraph [ref=e42]: Forbruk / dag
                - paragraph [ref=e43]: fra 21. mai til i dag
                - paragraph [ref=e44]: ↑ 6 851 kr/dag forrige
            - button "650 kr/dag 13 004 kr totalt Dagligvare / dag fra 21. mai til i dag ↑ 349 kr/dag forrige" [ref=e45] [cursor=pointer]:
              - generic [ref=e46]:
                - paragraph [ref=e47]: 650 kr/dag
                - paragraph [ref=e48]: 13 004 kr totalt
              - img [ref=e50]
              - generic [ref=e54]:
                - paragraph [ref=e55]: Dagligvare / dag
                - paragraph [ref=e56]: fra 21. mai til i dag
                - paragraph [ref=e57]: ↑ 349 kr/dag forrige
          - generic [ref=e58]:
            - region "Kontoer" [ref=e59]:
              - generic [ref=e60]:
                - generic [ref=e61]:
                  - heading "Kontoer" [level=3] [ref=e62]
                  - paragraph [ref=e63]: Viser alle kontoer
                - generic [ref=e64]:
                  - button "Kontoinnstillinger" [ref=e65] [cursor=pointer]
                  - generic [ref=e66]: "9"
              - list [ref=e67]:
                - listitem [ref=e68]:
                  - button "Sparekonto Ekteskapet Sparekonto 65 637 kr" [ref=e69] [cursor=pointer]:
                    - generic [ref=e70]:
                      - paragraph [ref=e71]: Sparekonto Ekteskapet
                      - paragraph [ref=e72]: Sparekonto
                    - paragraph [ref=e74]: 65 637 kr
                - listitem [ref=e75]:
                  - button "Brukskonto Kjetil Brukskonto 9 867 kr" [ref=e76] [cursor=pointer]:
                    - generic [ref=e77]:
                      - paragraph [ref=e78]: Brukskonto Kjetil
                      - paragraph [ref=e79]: Brukskonto
                    - paragraph [ref=e81]: 9 867 kr
                - listitem [ref=e82]:
                  - button "Nils Grønningsæter Høiby SPAREKONTO UNG 5 314 kr" [ref=e83] [cursor=pointer]:
                    - generic [ref=e84]:
                      - paragraph [ref=e85]: Nils Grønningsæter Høiby
                      - paragraph [ref=e86]: SPAREKONTO UNG
                    - paragraph [ref=e88]: 5 314 kr
                - listitem [ref=e89]:
                  - button "Erle Grønningsæter Høiby SPAREKONTO UNG 3 863 kr" [ref=e90] [cursor=pointer]:
                    - generic [ref=e91]:
                      - paragraph [ref=e92]: Erle Grønningsæter Høiby
                      - paragraph [ref=e93]: SPAREKONTO UNG
                    - paragraph [ref=e95]: 3 863 kr
                - listitem [ref=e96]:
                  - button "Felleskonto Ekteskapet Brukskonto 3 683 kr" [ref=e97] [cursor=pointer]:
                    - generic [ref=e98]:
                      - paragraph [ref=e99]: Felleskonto Ekteskapet
                      - paragraph [ref=e100]: Brukskonto
                    - paragraph [ref=e102]: 3 683 kr
                - listitem [ref=e103]:
                  - button "Regningskonto Brukskonto 3 669 kr" [ref=e104] [cursor=pointer]:
                    - generic [ref=e105]:
                      - paragraph [ref=e106]: Regningskonto
                      - paragraph [ref=e107]: Brukskonto
                    - paragraph [ref=e109]: 3 669 kr
                - listitem [ref=e110]:
                  - button "Iver Grønningsæter Høiby SPAREKONTO UNG 1 147 kr" [ref=e111] [cursor=pointer]:
                    - generic [ref=e112]:
                      - paragraph [ref=e113]: Iver Grønningsæter Høiby
                      - paragraph [ref=e114]: SPAREKONTO UNG
                    - paragraph [ref=e116]: 1 147 kr
                - listitem [ref=e117]:
                  - button "Sparekonto Kjetil Sparekonto 0 kr" [ref=e118] [cursor=pointer]:
                    - generic [ref=e119]:
                      - paragraph [ref=e120]: Sparekonto Kjetil
                      - paragraph [ref=e121]: Sparekonto
                    - paragraph [ref=e123]: 0 kr
                - listitem [ref=e124]:
                  - button "Europaferie PLASSERINGSKONTO PM 0 kr" [ref=e125] [cursor=pointer]:
                    - generic [ref=e126]:
                      - paragraph [ref=e127]: Europaferie
                      - paragraph [ref=e128]: PLASSERINGSKONTO PM
                    - paragraph [ref=e130]: 0 kr
            - region "Siste transaksjoner" [ref=e131]:
              - generic [ref=e132]:
                - generic [ref=e133]:
                  - heading "Siste transaksjoner" [level=3] [ref=e134]
                  - paragraph [ref=e135]: Oppdatert 9.6., 22:27
                - generic [ref=e136]:
                  - button "Utforsk" [ref=e137] [cursor=pointer]
                  - generic [ref=e138]: "5"
              - list [ref=e139]:
                - listitem [ref=e140]:
                  - button "Småsparing stk avrunding 💰 Småsparing – avrunding 56 kr 7.6." [ref=e141] [cursor=pointer]:
                    - generic [ref=e142]:
                      - paragraph [ref=e143]: Småsparing stk avrunding
                      - paragraph [ref=e144]: 💰 Småsparing – avrunding
                    - generic [ref=e145]:
                      - paragraph [ref=e146]: 56 kr
                      - paragraph [ref=e147]: 7.6.
                - listitem [ref=e148]:
                  - 'button "Nettgiro til: Lambertseter SK … 📦 Ukategorisert −500 kr 7.6." [ref=e149] [cursor=pointer]':
                    - generic [ref=e150]:
                      - paragraph [ref=e151]: "Nettgiro til: Lambertseter SK …"
                      - paragraph [ref=e152]: 📦 Ukategorisert
                    - generic [ref=e153]:
                      - paragraph [ref=e154]: −500 kr
                      - paragraph [ref=e155]: 7.6.
                - listitem [ref=e156]:
                  - button "Ruter 🚇 Ruter – kollektivtransport −41 kr 7.6." [ref=e157] [cursor=pointer]:
                    - generic [ref=e158]:
                      - paragraph [ref=e159]: Ruter
                      - paragraph [ref=e160]: 🚇 Ruter – kollektivtransport
                    - generic [ref=e161]:
                      - paragraph [ref=e162]: −41 kr
                      - paragraph [ref=e163]: 7.6.
                - listitem [ref=e164]:
                  - button "Oda.com - mmdmst 🛒 Dagligvarer −28 kr 7.6." [ref=e165] [cursor=pointer]:
                    - generic [ref=e166]:
                      - paragraph [ref=e167]: Oda.com - mmdmst
                      - paragraph [ref=e168]: 🛒 Dagligvarer
                    - generic [ref=e169]:
                      - paragraph [ref=e170]: −28 kr
                      - paragraph [ref=e171]: 7.6.
                - listitem [ref=e172]:
                  - 'button "Nettgiro til: Betalt: 📦 Ukategorisert −696 kr 7.6." [ref=e173] [cursor=pointer]':
                    - generic [ref=e174]:
                      - paragraph [ref=e175]: "Nettgiro til: Betalt:"
                      - paragraph [ref=e176]: 📦 Ukategorisert
                    - generic [ref=e177]:
                      - paragraph [ref=e178]: −696 kr
                      - paragraph [ref=e179]: 7.6.
          - button "Vis alle (8)" [ref=e180] [cursor=pointer]
        - paragraph [ref=e181]: "Sist lagret: 9.6., 22:27"
        - group [ref=e182]:
          - generic "Signalinput 0 aktive" [ref=e183] [cursor=pointer]:
            - generic [ref=e184]: Signalinput
            - generic [ref=e185]: 0 aktive
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
  23 | 		await expect(page).toHaveScreenshot('tema-helse.png', { fullPage: true });
  24 | 	});
  25 | });
  26 | 
  27 | test.describe('Økonomi-tema', () => {
  28 | 	test('økonomidashboard rendres', async ({ page }) => {
  29 | 		await page.goto('/tema/økonomi');
  30 | 		await page.waitForLoadState('networkidle');
> 31 | 		await expect(page).toHaveScreenshot('tema-okonomi.png', { fullPage: true });
     |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
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