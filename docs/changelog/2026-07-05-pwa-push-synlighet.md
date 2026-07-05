# PWA-push: alltid synlig i settings + fiks for stille tap av pwa-ruting

Dato: 2026-07-05
Status: ferdig

## Kontekst

Bruker rapporterte at PWA-push-varsler hadde sluttet å komme, og at PWA-push
ikke lenger var synlig i `/settings/notifications`. Koden var ikke mistet —
hele PWA-blokken (status, Aktiver/Deaktiver/Test og PWA-avkrysningene i
kanal-rutingen) var pakket i `{#if pwaChannelSupported}`, en **enhets-lokal**
sjekk (`supportsPwaChannel()`) som krever Push API i nettleseren som viser
siden. På en enhet uten push-støtte (f.eks. iPhone i Safari-fanen i stedet
for installert PWA, eller desktop-nettlesere uten Push API) forsvant hele
seksjonen uten forklaring.

Den skjulte avkrysningen hadde en alvorlig bivirkning: skjemaet
`?/updateChannels` lagrer rutingen som `data.getAll('route_*')`. Når
PWA-checkboxene ikke rendres, sendes de heller ikke inn — et trykk på
«Lagre kanaler» fra en slik enhet lagret dermed ruting **uten** `pwa` for
alle varseltyper. Siden `resolveRoutesForNotification` bruker lagret ruting
foran defaults (`routing?.[key] ?? defaultRoutes(...)`), sluttet alle
nudge-sendere (`routeTargetsPwa`) å sende push — på alle enheter, selv om
abonnementene i `web_push_subscriptions` levde i beste velgående.

## Faser

### Fase 1: Rotårsaksanalyse
Verifisert at all push-infrastruktur er intakt: `src/service-worker.ts`
(push + notificationclick), `/api/push/*`-endepunktene,
`PushDeliveryService`, VAPID-oppsett og ruting i `notification-channels.ts`.
Ingen commits siden juni har fjernet noe av dette.

### Fase 2: Fiks i settings-UI
`src/routes/settings/notifications/+page.svelte`:
- PWA-avkrysningene i kanal-rutingen rendres **alltid** — ruting er
  konto-nivå (gjelder alle enheter med aktiv subscription), ikke
  enhets-nivå. Dette fjerner også datataps-feilen ved lagring.
- «PWA-kanal status»-boksen vises alltid, med forklaring når enheten ikke
  støtter push (iOS: må installeres på hjemskjermen; ellers: nettleseren
  mangler støtte).
- Aktiver/Deaktiver Push er disabled (ikke skjult) på enheter uten støtte.

### Fase 3: Tester
Ny `src/lib/server/notification-channels.test.ts` dekker
`resolveRoutesForNotification` (defaults, overstyring, filtrering av
slettede kanaler), `normalizeGoogleChatChannels` og
`getGoogleChatWebhooksForRoutes` — inkludert en test som dokumenterer
hvorfor PWA-checkboxen alltid må rendres.

## Beslutninger

- Ingen automatisk datareparasjon av allerede lagret ruting uten `pwa` —
  vi kan ikke skille «mistet ved en feil» fra «bevisst skrudd av». Brukeren
  kan nå se og re-krysse PWA i settings. Sjekk også at abonnementet ikke
  står som `disabled` i `web_push_subscriptions` (statusboksen viser
  «Abonnert: Nei» i så fall — trykk «Aktiver Push» på nytt fra PWA-en).

## Verifisering

- `npm test`: 1082 tester grønne (inkl. 9 nye).
- `npm run check`: 0 feil.
- Settings-siden er ikke dekket av visuelle baselines (5 andre sider), så
  ingen piksel-diff-oppdatering nødvendig.
