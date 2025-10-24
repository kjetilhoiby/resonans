# 🎯 Resonans

En intelligent målcoach-app som kombinerer chat med LLM, database og pushvarsler for å hjelpe deg med å sette og følge opp mål innen parforhold, trening, mental helse og mer.

## 🏗️ Arkitektur

- **Frontend**: SvelteKit 2 med TypeScript
- **Backend**: SvelteKit API routes
- **Database**: Neon (Postgres) med Drizzle ORM
- **LLM**: OpenAI GPT-4
- **Notifikasjoner**: Google Chat webhooks
- **Deployment**: Vercel

## �� Database-skjema

Appen bruker følgende tabeller:
- `users` - Brukerinformasjon
- `categories` - Målkategorier (parforhold, trening, etc.)
- `goals` - Overordnede mål
- `tasks` - Konkrete oppgaver knyttet til mål
- `progress` - Fremdriftsregistreringer
- `conversations` - Samtaler med AI
- `messages` - Meldinger i samtaler
- `reminders` - Planlagte påminnelser

## 🚀 Komme i gang

### 1. Installer dependencies

```bash
npm install --force
```

*Note: `--force` er nødvendig pga. Node v23 compatibility issues*

### 2. Sett opp miljøvariabler

Kopier `.env.example` til `.env` og fyll inn verdier:

```bash
cp .env.example .env
```

#### Neon Database
1. Gå til [neon.tech](https://neon.tech)
2. Opprett en ny database
3. Kopier connection string til `DATABASE_URL`

#### OpenAI API
1. Gå til [platform.openai.com](https://platform.openai.com)
2. Opprett en API-nøkkel
3. Legg til i `OPENAI_API_KEY`

#### Google Chat (valgfritt for første test)
1. Gå til Google Chat
2. Opprett en webhook for et space
3. Legg til i `GOOGLE_CHAT_WEBHOOK_URL`

### 3. Sett opp database

Generer og kjør migrasjoner:

```bash
# Generer migrasjonsfiler
npm run db:generate

# Kjør migrasjoner (eller bruk push for rask utvikling)
npm run db:push
```

### 4. Start dev-server

```bash
npm run dev
```

Appen kjører nå på [http://localhost:5173](http://localhost:5173)

## 📝 Database-kommandoer

```bash
# Generer migrasjonsfiler fra schema
npm run db:generate

# Push schema direkte til database (rask utvikling)
npm run db:push

# Åpne Drizzle Studio for å se data
npm run db:studio

# Kjør migrasjoner
npm run db:migrate
```

## 🧪 Teste appen

1. Åpne appen i nettleseren
2. Chat med AI-en om dine mål
3. AI-en vil hjelpe deg med å:
   - Definere konkrete, målbare mål
   - Bryte ned i handlingsplaner
   - Sette opp oppfølging

## 📦 Deployment til Vercel

### 1. Push til GitHub

```bash
git add .
git commit -m "Initial commit"
git push
```

### 2. Deploy på Vercel

1. Gå til [vercel.com](https://vercel.com)
2. Importer GitHub repository
3. Legg til miljøvariabler:
   - `DATABASE_URL`
   - `OPENAI_API_KEY`
   - `GOOGLE_CHAT_WEBHOOK_URL`
4. Deploy!

### 3. Kjør database migrations

Etter første deploy, kjør migrasjoner i Vercel:
- Bruk Vercel CLI eller kjør `npm run db:push` lokalt mot production database

## 🎯 Roadmap / Neste steg

- [x] Basis prosjektstruktur
- [x] Database-skjema
- [x] Chat-interface
- [x] LLM-integrasjon
- [ ] Lagre samtaler til database
- [ ] Implementere mål- og oppgavehåndtering
- [ ] Google Chat notifikasjoner
- [ ] Fremdriftsvisning
- [ ] Autentisering (f.eks. med Auth.js)
- [ ] Planlagte check-ins fra AI
- [ ] Visualisering av fremgang (grafer)
- [ ] Multi-bruker støtte

## 🛠️ Utvikling

Prosjektstrukturen:

```
resonans/
├── src/
│   ├── lib/
│   │   ├── components/      # Svelte-komponenter
│   │   ├── db/              # Database schema og client
│   │   └── server/          # Server-side kode (OpenAI, etc.)
│   └── routes/
│       ├── api/             # API endpoints
│       └── +page.svelte     # Hovedside med chat
├── drizzle/                 # Database migrations
├── drizzle.config.ts        # Drizzle konfigurasjon
└── svelte.config.js         # SvelteKit konfigurasjon
```

## 💡 Tips

- Bruk `npm run db:studio` for å se og redigere data visuelt
- Test chat-funksjonalitet uten database først
- Start med én kategori (f.eks. trening) før du ekspanderer
- Bruk Vercel preview deployments for testing

## 📄 Lisens

MIT
