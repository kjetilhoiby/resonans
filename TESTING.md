# 🧪 Testing Guide

## Test 1: Mock Chat (ingen OpenAI nødvendig)

Denne testen bruker forhåndsdefinerte svar og krever ingen API-nøkler.

1. **Endre chat endpoint i `src/routes/+page.svelte`:**
   
   Finn linjen:
   ```typescript
   const response = await fetch('/api/chat', {
   ```
   
   Endre til:
   ```typescript
   const response = await fetch('/api/chat-mock', {
   ```

2. **Start dev server:**
   ```bash
   npm run dev
   ```

3. **Test chat:**
   - Åpne [http://localhost:5173](http://localhost:5173)
   - Skriv meldinger og se mock-responser

## Test 2: Ekte OpenAI Chat

1. **Hent OpenAI API-nøkkel:**
   - Gå til [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
   - Opprett en ny nøkkel
   - Kopier nøkkelen

2. **Legg til i `.env`:**
   ```
   OPENAI_API_KEY=sk-din-nøkkel-her
   ```

3. **Sørg for at du bruker `/api/chat` endpoint** (ikke mock)

4. **Start server og test:**
   ```bash
   npm run dev
   ```

## Test 3: Database-integrasjon

1. **Sett opp Neon database** (se QUICKSTART.md)

2. **Push schema:**
   ```bash
   npm run db:push
   ```

3. **Åpne Drizzle Studio:**
   ```bash
   npm run db:studio
   ```
   
   - Se at tabellene er opprettet
   - Du kan legge til test-data manuelt her

4. **Test at connection fungerer:**
   
   Opprett `src/routes/api/db-test/+server.ts`:
   ```typescript
   import { json } from '@sveltejs/kit';
   import { db } from '$lib/db';
   
   export async function GET() {
     try {
       // Simple query test
       return json({ status: 'Database connected!' });
     } catch (error) {
       return json({ error: 'Database connection failed' }, { status: 500 });
     }
   }
   ```
   
   Besøk: [http://localhost:5173/api/db-test](http://localhost:5173/api/db-test)

## Test 4: End-to-end

1. **Ha OpenAI og Database satt opp**

2. **Implementer database-lagring i chat API** (se neste steg i utvikling)

3. **Test full flyt:**
   - Chat med AI
   - Se at meldinger lagres i database (via Drizzle Studio)
   - Refresh siden - samtaler bør lastes fra database

## Feilsøking

### TypeScript errors
- Kjør `npm run dev` først
- Wait for "VITE ready" message
- TypeScript types genereres automatisk

### API ikke tilgjengelig
- Sjekk at server kjører
- Se etter feil i terminal
- Åpne DevTools Network tab i browser

### Database connection timeout
- Sjekk at Neon database er aktiv
- Verifiser connection string
- Test connection fra Neon dashboard

## Performance Testing

For å teste ytelse:

```bash
# Install autocannon
npm install -g autocannon

# Test chat API
autocannon -c 10 -d 10 http://localhost:5173/api/chat-mock
```

Dette sender 10 samtidige requests i 10 sekunder.
