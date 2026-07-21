# Ekko ↔ Resonans: Live teknikk-analyse (pull-ups)

Spec for å flytte live pull-up-analyse til Ekko-iOS-appen. Ekko eier den raske,
kamerabaserte sanntidsløkka (on-device); Resonans eier LLM-coachingen etterpå.

> **Status:** referanseimplementasjon (TypeScript) finnes i Resonans under
> `src/lib/pose/` med 22 enhetstester (`npm test`). Speccen og koden holdes i
> sync. Swift-porten deler ikke kode, men skal replikere oppførselen og
> testvektorene i §7.

---

## 1. Arkitektur — to løkker

```
┌─ Ekko (iOS, native, on-device) ─────────────────────────┐
│  Kamera → Vision body pose (30 fps)                      │
│    → PullupAnalyzer (§3): reps, hake, ROM, tempo         │
│    → lyd-cues i sanntid (§5)                             │
└──────────────────────────────────────────────────────────┘
                     │ ved øktslutt: kun tall (aldri video)
                     ▼
┌─ Resonans (backend) ────────────────────────────────────┐
│  POST /api/apps/coach  → GPT-4o → coaching på norsk (§6) │
└──────────────────────────────────────────────────────────┘
```

**Prinsipp:** Kroppsvideo forlater aldri enheten. Bare den utledede
øktoppsummeringen sendes til backend.

Sanntids-cues MÅ være deterministiske og on-device — LLM-kall tar sekunder og
kan ikke drive tilbakemelding per rep.

---

## 2. On-device: iOS Vision → normaliserte punkter

Bruk `VNDetectHumanBodyPoseRequest`. Fra `VNHumanBodyPoseObservation` trengs:

| Vår `KeypointName` | Vision joint |
|--------------------|--------------|
| `nose`             | `.nose` |
| `leftShoulder` / `rightShoulder` | `.leftShoulder` / `.rightShoulder` |
| `leftElbow` / `rightElbow`       | `.leftElbow` / `.rightElbow` |
| `leftWrist` / `rightWrist`       | `.leftWrist` / `.rightWrist` |
| `leftHip` / `rightHip`           | `.leftHip` / `.rightHip` (kun til skjelett-tegning) |

Hvert punkt: `{ x, y, score }` der `score` = Visions `confidence`.

> **⚠️ Y-akse (kritisk):** Vision gir normaliserte punkter med origo
> **nederst-til-venstre og y oppover** (0 = bunn, 1 = topp). Denne speccen
> (og referansekoden) bruker **y nedover** (0 = topp), som MediaPipe.
> **Konverter ved inntak:** `y' = 1 − y_vision`. Vinkler er reflektsjons-
> invariante og påvirkes ikke, men hake-over-stang-sammenligningen (§3.4)
> avhenger av y-retning — gjør du ikke flippen, teller den motsatt.

---

## 3. PullupAnalyzer — deterministisk kjerne

Matet med én `PoseFrame` per videoframe + en monotont økende `ts` (ms).
Holder tilstand mellom frames. Referanse: `src/lib/pose/pullup-analyzer.ts`.

### 3.1 Albuevinkel (primærsignal)

For hver arm der skulder, albue OG håndledd har `score ≥ minScore`:
vinkelen ved albuen mellom skulder og håndledd.

```
angle(a, b, c) = acos( clamp((u·v)/(|u||v|), -1, 1) ) · 180/π
   der u = a − b, v = c − b,  b = albuen
```

`elbowAngle` = snitt av de to armene (bruk den ene hvis bare én er synlig,
`null` hvis ingen). ~180° = strak arm (bunn), liten vinkel = bøyd (topp).
Skala-invariant — robust mot kameraavstand.

### 3.2 Tilstandsmaskin med hysterese

To tilstander, start i `hang`. Terskler (§4):

```
hang → top :  elbowAngle ≤ elbowUpDeg   (95°)
top  → hang:  elbowAngle ≥ elbowDownDeg  (150°)
```

Dødsonen 95–150° hindrer dobbelttelling ved dirring. **Én rep telles idet
top → hang** (retur til heng etter å ha nådd toppen).

`phase` (for UI): `hang` (≥150), `pulling` (mellom, på vei opp), `top` (≤95),
`lowering` (mellom, ≥110 = `elbowUpDeg+15`).

### 3.3 Tempo — subtilt, ikke rot det til

- `bottomTs` oppdateres **kun** når `elbowAngle ≥ elbowDownDeg` (ekte bunn) —
  IKKE på hver heng-frame. Ellers kollapser konsentrisk fase til ett frame.
- Ved `hang → top`: `concentricMs = ts − bottomTs` (spenner hele draget).
- Ved rep fullført: `eccentricMs = ts − topTs` (topp → bunn, inkl. evt. hold).

### 3.4 Hake over stang

`barY` = snitt av synlige håndledds `y`. Med y nedover:

```
chinOverBar (dette framet) = nose.y ≤ barY + chinToleranceY   (0.02)
```

Nesen er høyere enn haka, så terskelen er streng med vilje + liten toleranse.
Flagget er **klebrig innen en rep**: når det først er sant i en rep, forblir det
sant til rep-en fullføres.

### 3.5 Per-rep-metrikk (låses ved fullført rep)

| Felt | Beregning |
|------|-----------|
| `index` | 1-basert rep-nummer |
| `chinOverBar` | nådde hake stanga i rep-en (§3.4) |
| `fullExtension` | `maxElbowAngleThisRep ≥ fullExtensionDeg` (160°) |
| `peakElbowAngle` | min albuevinkel i rep-en (mest bøyd), avrundet |
| `bottomElbowAngle` | maks albuevinkel i rep-en (mest strak), avrundet |
| `concentricMs` / `eccentricMs` | §3.3 |

Nullstill min/maks-albue og hake-flagg etter hver fullført rep.

### 3.6 Ingen person i bildet

Når `elbowAngle == null` i `noPersonFrames` (30) frames på rad: send
no-person-cue **én gang** (ikke spam). Nullstill telleren så snart en gyldig
frame kommer.

---

## 4. Standardterskler

| Parameter | Verdi | Betydning |
|-----------|-------|-----------|
| `minScore` | 0.40 | minste keypoint-konfidens |
| `elbowUpDeg` | 95° | ≤ ⇒ topp |
| `elbowDownDeg` | 150° | ≥ ⇒ bunn/heng |
| `fullExtensionDeg` | 160° | full utstrekning i bunn |
| `chinToleranceY` | 0.02 | hake-over-stang-slingring (normalisert) |
| `noPersonFrames` | 30 | ~1 sek ved 30 fps |

> Kalibrert etter fornuft, ikke ekte opptak. Juster mot faktiske Vision-data på
> enhet — spesielt `elbowUpDeg` (grep-bredde/kameravinkel påvirker toppvinkelen)
> og `chinToleranceY`.

---

## 5. Lyd-cues (prioritert, én per rep)

Rekkefølge — første som slår til vinner:

| # | Betingelse | Norsk cue | `cueKind` |
|---|-----------|-----------|-----------|
| 1 | `!chinOverBar` | «Kom høyere — få haka over stanga.» | `chin` |
| 2 | `!fullExtension` | «Strekk armene helt ut i bunn.» | `rom` |
| 3 | `concentricMs > 0 && < 400` | «Litt mer kontroll oppover.» | `tempo` |
| 4 | ellers | «Bra rep! {index}.» | `form-ok` |

No-person: «Jeg ser deg ikke helt — steg litt tilbake så hele kroppen er i
bildet.» (`cueKind` = `no-person`).

Lyd er hovedkanalen (man ser ikke skjermen i stanga). Norsk TTS (`AVSpeechSynthesizer`,
`nb-NO`) + et kort pip ved hver fullført rep. Demp overlappende tale (~900 ms
minsteavstand).

---

## 6. Backend: øktoppsummering (den trege løkka)

**Anbefalt: gjenbruk `POST /api/apps/coach`** (se `docs/archive/EKKO_PROGRAMS_INTEGRATION.md`
§ coach). Det tar allerede fri-tekst + efemær `context` (live-metrikk) og
håndterer etter-økt-vurdering.

**Request:**
```
POST /api/apps/coach
Authorization: Bearer rsn_<token>
Content-Type: application/json

{
  "prompt": "Gi meg en kort oppsummering av pull-up-økta og det viktigste jeg bør jobbe med.",
  "context": "Pull-up-økt:\n- Reps: 8\n- Hake over stang: 5 av 8\n- Full utstrekning i bunn: 8 av 8\n- Rene reps: 5 av 8\n- Snitt opp-fase: 1.2 s\n- Snitt ned-fase: 1.8 s"
}
```

`context` bygges fra `SessionSummary` via `buildCoachContext()`
(`src/lib/pose/session-summary.ts`). Send ALDRI video, bilder eller
per-frame-data — bare de aggregerte tallene.

**Response:** `{ ok: true, text: "<coaching på norsk>" }`

### SessionSummary (bygg `context` fra denne)

| Felt | Beregning |
|------|-----------|
| `reps` | antall fullførte reps |
| `chinOverBarReps` | reps med `chinOverBar` |
| `fullExtensionReps` | reps med `fullExtension` |
| `cleanReps` | reps med `chinOverBar && fullExtension` |
| `avgConcentricMs` / `avgEccentricMs` | snitt over reps med verdi > 0 (null hvis ingen) |
| `durationMs` | `lastTs − startedTs` |

---

## 7. Testvektorer (port disse)

Speiler `src/lib/pose/pullup-analyzer.test.ts`. Bygg syntetiske frames med
kjent albuevinkel og nese-høyde (`nose.y ≤ 0.22` ⇒ hake, med håndledd på y=0.2):

| Sekvens | Forventet |
|---------|-----------|
| Ren rep: heng(170°)→dra→topp(90°, nese 0.2)→senk→heng(170°) | `reps=1`, `chinOverBar=true`, `fullExtension=true`, cue `form-ok` |
| Albue oscillerer 100°↔145° (aldri ≤95) | `reps=0` (hysterese) |
| Flere topp-frames før retur til heng | `reps=1` (ingen dobbelttelling) |
| Topp med nese høyt (0.5, aldri ≤ stang) | cue `chin`, `chinOverBar=false` |
| Bunn når bare 152° (< 160) | cue `rom`, `fullExtension=false` |
| Kort konsentrisk fase (< 400 ms) | cue `tempo` |
| 30+ tomme frames | no-person-cue én gang |
| 2 reps (én ren, én uten hake) | `reps=2`, `chinOverBarReps=1`, `cleanReps=1` |

Vinkel-hjelpere: 180° = strak (bunn), ~90° = topp. En reflektert (y-flippet)
frame gir samme vinkler — bekreft at hake-logikken bruker riktig y-retning (§2).

---

## 8. Skjelett-overlay (valgfritt, UX)

Tegn armsegmenter (skulder–albue–håndledd), skulderlinje, hofter, nese, og en
stiplet «stang»-linje på `barY`. Fargekod på fase (topp = grønn, dra = accent).
Speilvend som selfie-kamera. Ren kosmetikk — påvirker ikke tellingen.
