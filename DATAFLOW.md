# Resonans — Dataflyt & Brukerflyter

## 1. System-arkitektur og dataflyt

```mermaid
flowchart TB
    subgraph Ext["Eksterne datakilder"]
        direction TB
        Withings["Withings API\nvekt · søvn · skritt · vo2max"]
        SpareBank1["SpareBank1\ntransaksjoner · balanse"]
        Email["E-post (Postmark)\nGPX/TCX-vedlegg"]
        Dropbox["Dropbox\ntreningsfiler"]
        Manual["Manuell input\nchat · bilde · vedlegg"]
    end

    subgraph Ingest["Datainnhenting"]
        WSync["cron/withings-sync"]
        SBSync["cron/sparebank1-sync"]
        EmailWH["workouts/email-inbound\n(webhook)"]
        DBSync["sensors/dropbox/sync"]
        AttTriage["attachment-triage\n(vision-matching)"]
    end

    subgraph DB["Database (PostgreSQL via Drizzle)"]
        direction TB
        SE[("sensor_events\nunified event stream")]
        CE[("categorized_events\ntransaksjoner m/ kategori")]
        SA[("sensor_aggregates\nukentlig / månedlig")]
        DS[("domain_signals\nberegnede signaler")]
        MM[("merchant_mappings\nLLM-kategorisert")]
        TS[("tracking_series\nbrukerens sporserier")]
        Mem[("memories\nAI-fakta per bruker")]
    end

    subgraph Processing["Prosessering"]
        CatEngine["categorized-events.ts\nkeyword → LLM fallback"]
        AggEngine["sensor-aggregates.ts\nrullende snitt + totaler"]
        SignalEngine["cron/domain-signals\nkryssdomene-signaler"]
        SpendLLM["economics/analyze-spending\nbatch-LLM kategorisering"]
    end

    subgraph AI["AI-lag"]
        Router["chat-router.ts\ndomenedeteksjon + skill-routing"]
        Prompt["buildModularSystemPrompt\nkontekstbygging"]
        LLM["OpenAI GPT-4o\nstreaming SSE"]
        Tools["AI-verktøy\ncreate_widget · log_activity\ncreate_checklist · web_search"]
    end

    subgraph UI["Brukergrensesnitt"]
        direction LR
        Home["/\nHjem + widgets"]
        Samtaler["/samtaler\nAI-chat"]
        Econ["/economics\nØkonomi"]
        Workouts["/workouts\nTrening"]
        Tema["/tema/[id]\nTema / mål"]
        Settings["/settings\nInnstillinger"]
    end

    Withings --> WSync
    SpareBank1 --> SBSync
    Email --> EmailWH
    Dropbox --> DBSync
    Manual --> AttTriage

    WSync --> SE
    SBSync --> SE
    EmailWH --> SE
    DBSync --> SE
    AttTriage --> TS

    SE --> CatEngine --> CE
    SE --> AggEngine --> SA
    SA --> SignalEngine --> DS
    CE --> SpendLLM --> MM
    MM --> CatEngine

    SE --> Router
    SA --> Router
    DS --> Router
    CE --> Router
    Mem --> Router
    TS --> Router

    Router --> Prompt --> LLM --> Tools
    LLM --> Mem

    SA --> Home
    DS --> Home
    CE --> Econ
    SE --> Workouts
    DS --> Tema
    Router --> Samtaler
    TS --> Home
```

---

## 2. Brukerflyt

```mermaid
flowchart TD
    Start([Bruker åpner appen]) --> Auth{Innlogget?}
    Auth -- Nei --> SignIn["/signin\nGoogle OAuth"]
    Auth -- Ja --> Home

    SignIn --> Home["/\nHjem\nwidgets + tema-oversikt"]

    Home --> Chat["/samtaler\nVelg eller start samtale"]
    Home --> Econ["/economics\nØkonomiinfo"]
    Home --> WO["/workouts\nTreningsoversikt"]
    Home --> TemaList["Tema-kort\n→ tema/[id]"]
    Home --> Settings["/settings"]

    Chat --> ChatMsg["Skriv melding\nel. send bilde/vedlegg"]
    ChatMsg --> AIResp["AI-svar (streaming)\n+ eventuelle verktøy"]
    AIResp --> ToolAction{Verktøy kalt?}
    ToolAction -- "create_widget" --> Home
    ToolAction -- "log_activity" --> WO
    ToolAction -- "create_checklist" --> TemaDetail
    ToolAction -- Ingen --> ChatMsg

    TemaList --> TemaDetail["/tema/[id]\nMål · lister · filer · signaler"]
    TemaDetail --> GoalView["Mål-detaljer\n+ fremgang"]
    TemaDetail --> Lists["Lister\n(pakkeliste, itinerary)"]
    TemaDetail --> Files["Filer\n(bilder, PDF)"]

    Econ --> AccDetail["/economics/[accountId]\nPer-konto transaksjoner"]
    AccDetail --> SpendBreakdown["Kategori-breakdown\nmer. statistikk"]

    Settings --> SettClass["/settings/classification\nKlassifiserings-regler"]
    Settings --> SettSrc["/settings/sources\nDatakilder / OAuth"]
    Settings --> SettTrack["/settings/tracking\nSporserier"]
    SettSrc --> OAuthFlow["OAuth-kobling\nWithings / SpareBank1 / Dropbox"]
    OAuthFlow --> SyncStart["Første synkronisering\n→ sensor_events"]
    SyncStart --> Home

    WO --> WODetail["/aktivitet/[id]\nTreningdetalj + kart"]
```

---

## 3. Nøkkel dataflyt-detaljer

### Treningsfil-innhenting (to veier)
```
Email (GPX/TCX-vedlegg)
  → Postmark webhook → /api/workouts/email-inbound
  → parseWorkoutFile()
  → sensor_events (dataType='workout')
  → Push-varsling til bruker

Dropbox-mappe
  → Cron eller manuell trigger → /api/sensors/dropbox/sync
  → listDropboxFolder() → downloadDropboxFile()
  → parseWorkoutFile()
  → sensor_events (dataType='workout')
```

### Bankdata (SpareBank1)
```
SpareBank1 Open Banking (OAuth2)
  → OAuth callback → token lagret i sensors-tabell
  → Cron /api/cron/sparebank1-sync (daglig)
  → fetchSparebank1Transactions()
  → sensor_events (dataType='bank_transaction' | 'bank_balance')
  → categorized-events.ts (materialisert projeksjon)
      → merchant_mappings (LLM, batch ~80 merchants)
      → classification_overrides (manuelle overstyringer)
      → keyword-regler (fallback)
  → categorized_events
```

### AI Chat pipeline
```
Bruker sender melding
  → GET /api/chat-stream?conversationId=...&message=...
  → chat-router.ts: detectPromptFocusModules()
      → domener: health | economics | planning | themes | general
      → skills: widget_creation | checklist_planning | goal_planning | ...
  → buildModularSystemPrompt()
      → henter: sensor-aggregates, domain-signals, memories, tracking-series
  → OpenAI streaming → SSE-events til klient
  → Lagrer assistent-melding i messages-tabell
  → Kan kalle verktøy: create_widget, log_activity, create_checklist, web_search
```

### Vedlegg-triage (bildematching)
```
Bruker sender bilde i chat
  → POST /api/attachment-triage
  → Upload til Cloudinary
  → OpenAI Vision: ekstraher signaler, detekter intensjon
  → tracking-triage.ts: match mot tracking_series
      → beregn bilde-signatur (hash, oppsett, farger, tokens)
      → sammenlign mot tracking_series_examples
  → Ved match: auto-logg eller be om bekreftelse
  → recordTrackingEvent() → sensor_events
```
