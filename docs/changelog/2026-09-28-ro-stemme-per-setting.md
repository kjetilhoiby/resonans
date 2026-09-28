# Ro: egen stemme i stillhet og yoga

Dato: 2026-09-28
Status: ferdig

## Kontekst

Ro-stemmen ble instruert som om lytteren alltid var ute og løp, også i Ro i stillhet og i
yoga. Brukeren ønsket forskjellige stemmer for stillhet og løp.

## Endring

- `POST /api/apps/ro/speech` tar `setting: 'moving' | 'still'`. Uten den er det `moving`,
  så eldre Ekko-versjoner får det de alltid har fått.
- `moving`: `Sulafat` og instruksen som før. `still`: `Vindemiatrix` og en mykere,
  langsommere instruks. Begge kan overstyres (`GEMINI_TTS_VOICE`, `GEMINI_TTS_VOICE_STILL`).
- Svaret har `x-ro-setting`.

Ekko sender `still` fra Ro i stillhet og yoga, og cacher lyden per setting. Løpelyden som
alt ligger på telefonen, gjenbrukes.

Kontrakt: `docs/ekko-ro.md`, «Stemmen».
