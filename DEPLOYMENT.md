# Deployment Guide til Vercel

## Før deployment

### 1. Sjekk at alt fungerer lokalt
```bash
npm run build
npm run preview
```

### 2. Push koden til GitHub
```bash
git add .
git commit -m "Klar for deployment"
git push origin main
```

## Deploy til Vercel

### Alternativ 1: Via Vercel CLI (raskest)

1. Installer Vercel CLI:
```bash
npm i -g vercel
```

2. Deploy:
```bash
vercel
```

3. Følg promptene:
   - Link to existing project? → N (første gang)
   - What's your project's name? → resonans
   - In which directory is your code located? → ./
   - Want to override settings? → N

4. Deploy til produksjon:
```bash
vercel --prod
```

### Alternativ 2: Via Vercel Dashboard (enklest)

1. Gå til [vercel.com](https://vercel.com)
2. Logg inn med GitHub
3. Klikk "Add New Project"
4. Importer `kjetilhoiby/resonans` repository
5. Vercel vil automatisk detektere SvelteKit
6. Klikk "Deploy"

## Miljøvariabler

Du må legge til følgende miljøvariabler i Vercel Dashboard:

### Required
- `DATABASE_URL` - Din Neon database connection string
- `OPENAI_API_KEY` - Din OpenAI API-nøkkel

### Optional
- `GOOGLE_CHAT_WEBHOOK_URL` - For pushvarsler (kommer senere)

### Hvordan legge til miljøvariabler:
1. Gå til prosjektet ditt på Vercel
2. Klikk "Settings" → "Environment Variables"
3. Legg til hver variabel:
   - **Name**: Variabelnavn (f.eks. `DATABASE_URL`)
   - **Value**: Verdien fra din `.env` fil
   - **Environment**: Velg "Production", "Preview" og "Development" (alle tre)
4. Klikk "Save"

## Database Migrations

Databasen kjører allerede på Neon, så ingen migrations trengs. Men hvis du endrer schema:

```bash
# Generer migration
npm run db:generate

# Push til database
npm run db:push
```

## Verifiser deployment

1. Etter deployment får du en URL som `https://resonans-xxx.vercel.app`
2. Test:
   - Chat-grensesnittet fungerer
   - OpenAI-integrasjonen fungerer
   - Mål blir lagret i database
   - Goals-siden viser data

## Troubleshooting

### Build feiler
- Sjekk at `npm run build` fungerer lokalt først
- Se build logs i Vercel Dashboard

### Database connection feiler
- Verifiser at `DATABASE_URL` er riktig i Vercel miljøvariabler
- Sjekk at Neon database er aktiv og tilgjengelig

### OpenAI API feiler
- Verifiser at `OPENAI_API_KEY` er riktig i Vercel miljøvariabler
- Sjekk API usage limits på OpenAI Dashboard

### Runtime errors
- Se "Functions" logs i Vercel Dashboard
- Bruk `console.log` for debugging (vises i logs)

## Automatisk deployment

Når du pusher til GitHub, vil Vercel automatisk:
- Bygge ny versjon
- Deploye til preview URL (for pull requests)
- Deploye til produksjon (for main branch)

## Neste steg

Etter deployment kan du:
1. Sette opp custom domain
2. Aktivere Analytics i Vercel Dashboard
3. Sette opp monitoring og alerts
