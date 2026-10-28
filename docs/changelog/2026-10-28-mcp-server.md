# MCP-server med OAuth: Resonans i Claude og ChatGPT

Dato: 2026-10-28
Status: ferdig i kode, testet ende-til-ende mot prod-build lokalt; ikke prøvd mot claude.ai/chatgpt.com

## Kontekst

Resonans-verktøyene fantes på to flater: web-chatten og Ekko-assistenten. Ønsket var å
bruke dem fra Claude og ChatGPT, med innlogging framfor en hemmelighet å lime inn. Begge
klientene snakker MCP over Streamable HTTP og forventer OAuth 2.1 med dynamisk
klientregistrering og PKCE.

## Hva som ble gjort

- Resonans er sin egen autorisasjonsserver: oppdagelse (RFC 9728/8414), registrering
  (RFC 7591), samtykkeside bak Google-innloggingen, token med roterende refresh, revokering
  (RFC 7009). Tre tabeller: `oauth_clients`, `oauth_authorization_codes`, `oauth_grants`
  (migrering `0078_oauth_mcp.sql`).
- `/mcp` eksponerer `ASSISTANT_TOOLS` minus quiz/forteller — 55 verktøy, samme beskrivelser
  som Ekko.
- `/settings/external-apps` viser MCP-adressen og tilkoblingene, med «Koble fra».

## To funn underveis

**SvelteKits CSRF-sjekk ville avvist hver token-forespørsel i drift.** Den avviser
skjema-POST uten `Origin`, sjekker bare utenfor dev, og kjører før hooks. Lokalt med
`vite dev` ville alt virket; i prod ville innloggingen stoppet på siste steg med 403
«Cross-site POST form submissions are forbidden». Sjekken er nå gjenskapt i `csrfHandle`
med unntak for `/oauth/token` og `/oauth/revoke`, og verifisert mot `npm run build`:
token-vekslingen uten `Origin` går gjennom, samtykke-POST uten `Origin` og andre
skjema-POST avvises fortsatt.

**`adaptSharedTool` lot argumentene overstyre `userId`.** `{ userId, ...inject, ...args }`
— et `userId` i argumentene vant. Skjemaet skjulte feltet for modellen, men ingenting
hindret en klient i å sende det. Med Ekko var klienten vår egen app; med MCP er den en
tredjepart, og da er rekkefølgen en tilgangsgrense. Nå `{ ...args, userId, ...inject }`,
med test.

Se `docs/mcp.md` for reglene.
