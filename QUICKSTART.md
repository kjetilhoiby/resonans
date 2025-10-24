# 🚀 Quick Start Guide

## Rask test uten database

Hvis du bare vil teste chat-funksjonen raskt:

1. **Installer og sett opp OpenAI nøkkel:**
   ```bash
   npm install --force
   ```

2. **Legg til OpenAI API-nøkkel i `.env`:**
   ```bash
   OPENAI_API_KEY=sk-din-api-nøkkel-her
   ```

3. **Start appen:**
   ```bash
   npm run dev
   ```

4. Åpne [http://localhost:5173](http://localhost:5173) og start å chatte!

## Full setup med database

### Steg 1: Sett opp Neon database

1. Gå til [neon.tech](https://neon.tech) og logg inn/registrer deg
2. Klikk "Create Project"
3. Velg navn og region
4. Kopier connection string (starter med `postgresql://`)
5. Lim inn i `.env`:
   ```
   DATABASE_URL=postgresql://...
   ```

### Steg 2: Push database schema

```bash
npm run db:push
```

Dette oppretter alle tabellene i databasen.

### Steg 3: (Valgfritt) Åpne Drizzle Studio

For å se databasen visuelt:

```bash
npm run db:studio
```

Dette åpner et web-interface på [https://local.drizzle.studio](https://local.drizzle.studio)

## Neste steg

Nå som basis-appen fungerer, kan du:

1. **Teste chatting** - Prøv å snakke med AI-en om mål
2. **Se koden** - Utforsk `src/routes/api/chat/+server.ts` for API-logikk
3. **Utvid funksjonalitet** - Legg til database-lagring av samtaler
4. **Sett opp Google Chat** - For pushvarsler (se README.md)

## Feilsøking

### Problem: npm install feiler
**Løsning:** Bruk `npm install --force`

### Problem: Database connection error
**Løsning:** Sjekk at `DATABASE_URL` i `.env` er riktig og at Neon-prosjektet kjører

### Problem: OpenAI API error
**Løsning:** 
- Sjekk at `OPENAI_API_KEY` er satt riktig
- Verifiser at du har credits på OpenAI-kontoen
- Sjekk at nøkkelen starter med `sk-`

### Problem: TypeScript errors
**Løsning:** Kjør `npm run dev` først - dette genererer nødvendige type-filer

## 💡 Tips for utvikling

- Start dev-serveren med `npm run dev` - den reloader automatisk
- Bruk browser DevTools (F12) for å se console errors
- Test API-et direkte i DevTools Network-tab
- Commit ofte til git mens du utvikler
