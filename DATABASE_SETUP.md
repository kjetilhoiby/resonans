# Database Setup - Steg for steg

## Alternativ 1: Bruk Neon (anbefalt for deployment)

### 1. Opprett Neon database

1. Gå til [neon.tech](https://neon.tech)
2. Logg inn eller registrer deg (gratis tier er nok)
3. Klikk "Create Project"
4. Velg:
   - **Project name**: resonans
   - **Region**: Europe (Frankfurt) eller nærmeste
   - **Postgres version**: 16 (default)
5. Klikk "Create Project"

### 2. Hent connection string

1. I prosjekt-dashboardet, klikk "Connection Details"
2. Kopier connection string (velger "Pooled connection")
3. Den ser omtrent slik ut:
   ```
   postgresql://user:password@ep-xxx-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

### 3. Legg til i .env

Åpne `.env` og oppdater:
```bash
DATABASE_URL=postgresql://din-connection-string-her
```

### 4. Push database schema

```bash
npm run db:push
```

Dette oppretter alle tabellene automatisk!

### 5. Verifiser i Drizzle Studio

```bash
npm run db:studio
```

Åpner på [https://local.drizzle.studio](https://local.drizzle.studio)

Du skal se disse tabellene:
- users
- categories
- goals
- tasks
- progress
- conversations
- messages
- reminders

## Alternativ 2: Lokal Postgres (for utvikling)

### 1. Installer Postgres

**macOS (med Homebrew):**
```bash
brew install postgresql@16
brew services start postgresql@16
```

**Windows:**
Last ned fra [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Opprett database

```bash
createdb resonans
```

### 3. Oppdater .env

```bash
DATABASE_URL=postgresql://localhost:5432/resonans
```

### 4. Push schema

```bash
npm run db:push
```

## Testing

### Test database connection

Opprett en fil `test-db.ts` i root:

```typescript
import { db } from './src/lib/db';
import { users } from './src/lib/db/schema';

async function test() {
  const allUsers = await db.select().from(users);
  console.log('Users:', allUsers);
}

test();
```

Kjør:
```bash
npx tsx test-db.ts
```

## Feilsøking

### "Connection refused"
- Sjekk at DATABASE_URL er riktig
- For Neon: Sjekk at prosjektet er aktivt
- For lokal: Sjekk at Postgres kjører

### "SSL required"
For Neon, bruk alltid `?sslmode=require` i connection string

### "Permission denied"
- Sjekk brukernavn og passord
- For lokal Postgres, kanskje du må opprette bruker først

### "Database does not exist"
For lokal Postgres: `createdb resonans`

## Neste steg

Når databasen er klar:

1. Start dev server: `npm run dev`
2. Åpne http://localhost:5173
3. Chat med AI-en om dine mål
4. AI-en vil automatisk opprette mål i databasen
5. Gå til http://localhost:5173/goals for å se målene

## Produksjon (Vercel)

Når du deployer til Vercel:

1. Legg til `DATABASE_URL` som environment variable i Vercel
2. Bruk Neon connection string
3. Etter deploy, kjør migrations:
   ```bash
   vercel env pull
   npm run db:push
   ```
