# Quiz: riktig svar ga null poeng

Dato: 2026-06-26
Status: ferdig

## Kontekst

I bilferie-quizen kunne en spiller svare riktig — quizmasteren sa «Riktig, Kjetil!» i tale —
uten å få poeng. Stillingen viste f.eks. «Anita 1, Kjetil 0» selv om begge svarte rett.

Årsaken var **ikke** i selve scoringen (`applyAnswer` er korrekt og testet). Poenget gis kun
når modellen kaller `quiz_score action="record"`. Med `tool_choice: 'auto'` kunne modellen
«skli»: si verdikten i ren tekst og gå rett videre til neste spiller uten å kalle `record`.
Da ble svaret aldri bokført, og spilleren ble stående på null. Dette er nøyaktig
tracking-svakheten designet skulle løse («modellen mister tellingen»), men på *registrerings*-
steget i stedet for *telle*-steget.

## Faser

### Fase 1: Server-vakt mot uregistrerte svar
- Ny ren funksjon `hasPendingAnswer(session)` i `quiz-logic.ts`: sant når et spørsmål er stilt
  (`currentQuestion`) uten at et resultat er bokført (`lastResult` er null).
- `askQuestion` (`quiz-tools.ts`) avviser nå et nytt spørsmål når forrige svar ikke er
  registrert, med en feilmelding som ber modellen kalle `record` først. Feilen mates tilbake i
  agent-løkka, så modellen selv-korrigerer og bokfører før den går videre — i stedet for at
  poenget forsvinner stille.
- 3 nye enhetstester for `hasPendingAnswer` (`quiz-logic.test.ts`).

### Fase 2: Hardere prompt
- Quizmaster-instruksen (`assistant.ts`) sier nå eksplisitt: kall `record` etter HVERT svar,
  FØR du sier rett/galt og før du går videre — «sier du bare 'riktig!' i tale uten å
  registrere, blir det stående med null poeng».

## Beslutninger

- **Invariant håndheves på serveren, ikke bare i prompten.** Prompt-hardning alene ville fortsatt
  vært en «myk» regel modellen kan glemme. Vakten i `askQuestion` gjør at man ikke *kan* gå
  videre til neste spørsmål uten å registrere det forrige.

## Verifisering

- `npm test`: 806 tester passerer (64 filer), inkl. 3 nye for `hasPendingAnswer`.
- `npm run check`: 0 feil, 0 advarsler.
