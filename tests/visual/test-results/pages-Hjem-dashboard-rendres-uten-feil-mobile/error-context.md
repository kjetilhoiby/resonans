# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: pages.spec.ts >> Hjem >> dashboard rendres uten feil
- Location: tests/visual/pages.spec.ts:4:2

# Error details

```
Error: expect(page).toHaveScreenshot(expected) failed

  10957 pixels (ratio 0.04 of all image pixels) are different.

  Snapshot: hjem.png

Call log:
  - Expect "toHaveScreenshot(hjem.png)" with timeout 5000ms
    - verifying given screenshot expectation
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - 10957 pixels (ratio 0.04 of all image pixels) are different.
  - waiting 100ms before taking screenshot
  - taking page screenshot
    - disabled all CSS animations
  - waiting for fonts to load...
  - fonts loaded
  - captured a stable screenshot
  - 10957 pixels (ratio 0.04 of all image pixels) are different.

```

# Page snapshot

```yaml
- main [ref=e3]:
  - generic [ref=e5]:
    - generic:
      - img
    - generic [ref=e7]:
      - generic [ref=e9]:
        - button "Åpne ukeplan" [ref=e12] [cursor=pointer]:
          - heading "9. juni" [level=1] [ref=e14]
        - generic [ref=e15]:
          - link "Mål" [ref=e16] [cursor=pointer]:
            - /url: /plan/mal
            - img [ref=e17]
          - link "Innstillinger" [ref=e21] [cursor=pointer]:
            - /url: /settings
            - img [ref=e22]
      - region "Sensor-oversikt" [ref=e25]:
        - button "Administrer widgets" [ref=e26] [cursor=pointer]: +
        - group "Widget-side 1 av 1" [ref=e28]:
          - generic [ref=e29]:
            - button "Gjort" [ref=e30] [cursor=pointer]:
              - generic [ref=e31]:
                - img
              - generic [ref=e32]: Gjort
            - button "5/11 Uka" [ref=e33] [cursor=pointer]:
              - generic [ref=e35]:
                - img [ref=e36]
                - generic:
                  - generic: 5/11
              - generic [ref=e39]: Uka
            - button "3/4 Dagen" [ref=e40] [cursor=pointer]:
              - generic [ref=e42]:
                - img [ref=e43]
                - generic:
                  - generic: 3/4
              - generic [ref=e46]: Dagen
            - button "-0.6 kg" [ref=e48] [cursor=pointer]:
              - generic [ref=e51]: "-0.6"
              - generic [ref=e52]: kg
            - button "57 min" [ref=e53] [cursor=pointer]:
              - generic [ref=e56]: "57"
              - generic [ref=e57]: min
            - button "77.1 km" [ref=e58] [cursor=pointer]:
              - generic [ref=e59]:
                - img [ref=e61]
                - generic [ref=e64]: "77.1"
              - generic [ref=e65]: km
      - region "Temaer" [ref=e66]:
        - paragraph [ref=e67]: Temaer
        - generic [ref=e68]:
          - button "🏋️‍♂️ Helse" [ref=e69] [cursor=pointer]:
            - generic [ref=e70]: 🏋️‍♂️
            - generic [ref=e71]: Helse
          - button "👨‍👩‍👦 Familie" [ref=e72] [cursor=pointer]:
            - generic [ref=e73]: 👨‍👩‍👦
            - generic [ref=e74]: Familie
          - button "🔄 Egenfrekvens" [ref=e75] [cursor=pointer]:
            - generic [ref=e76]: 🔄
            - generic [ref=e77]: Egenfrekvens
          - button "🏡 Hjem" [ref=e78] [cursor=pointer]:
            - generic [ref=e79]: 🏡
            - generic [ref=e80]: Hjem
          - button "📚 Bøker" [ref=e81] [cursor=pointer]:
            - generic [ref=e82]: 📚
            - generic [ref=e83]: Bøker
          - button "🏖️ Sommerferie 2026" [ref=e84] [cursor=pointer]:
            - generic [ref=e85]: 🏖️
            - generic [ref=e86]: Sommerferie 2026
      - region "Chat" [ref=e87]:
        - button "Dagens treningstilstand" [ref=e88] [cursor=pointer]:
          - generic [ref=e89]: 🟠
          - generic [ref=e90]: "I dag: Lett Styrke A"
        - group "Foreslåtte handlinger" [ref=e92]:
          - button "✨ Sjekk inn · kveld" [ref=e93] [cursor=pointer]:
            - generic [ref=e94]: ✨
            - generic [ref=e95]: Sjekk inn · kveld
          - button "📋 Planlegg i morgen" [ref=e96] [cursor=pointer]:
            - generic [ref=e97]: 📋
            - generic [ref=e98]: Planlegg i morgen
          - 'button "💪 I dag: Styrke A" [ref=e99] [cursor=pointer]':
            - generic [ref=e100]: 💪
            - generic [ref=e101]: "I dag: Styrke A"
          - button "💭 Kort refleksjon" [ref=e102] [cursor=pointer]:
            - generic [ref=e103]: 💭
            - generic [ref=e104]: Kort refleksjon
          - button "📥 Noter" [ref=e105] [cursor=pointer]:
            - generic [ref=e106]: 📥
            - generic [ref=e107]: Noter
        - generic [ref=e108]:
          - textbox "Melding" [ref=e109]:
            - /placeholder: Hva tenker du på?
          - generic "Input-handlinger" [ref=e110]:
            - button "Legg ved bilde" [ref=e111] [cursor=pointer]:
              - img [ref=e112]
            - button "Legg ved lyd" [ref=e115] [cursor=pointer]:
              - img [ref=e116]
            - button "Legg ved fil" [ref=e118] [cursor=pointer]:
              - img [ref=e119]
            - button "Sjekk inn" [ref=e121] [cursor=pointer]:
              - img [ref=e122]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Hjem', () => {
  4  | 	test('dashboard rendres uten feil', async ({ page }) => {
  5  | 		await page.goto('/');
  6  | 		await page.waitForLoadState('networkidle');
> 7  | 		await expect(page).toHaveScreenshot('hjem.png', { fullPage: true });
     |                      ^ Error: expect(page).toHaveScreenshot(expected) failed
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