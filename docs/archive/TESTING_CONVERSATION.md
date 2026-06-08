# 💬 Testing Samtale-historikk

## Hva er nytt?

AI-en husker nå tidligere meldinger i samtalen! Dette gir:
- **Kontinuitet**: AI-en refererer til ting du har sagt tidligere
- **Bedre kontekst**: Mer naturlige samtaler
- **Persistent lagring**: Samtaler lagres i database
- **Ny samtale-knapp**: Start fresh når du vil

## 🧪 Slik tester du

### Test 1: Basis samtale-historikk

1. **Åpne http://localhost:5174**

2. **Send første melding:**
   ```
   "Hei! Jeg heter [ditt navn]"
   ```

3. **Send oppfølging:**
   ```
   "Hva var navnet mitt igjen?"
   ```
   
   ✅ AI-en skal huske navnet ditt!

### Test 2: Mål-diskusjon med kontekst

1. **Start diskusjon:**
   ```
   "Jeg vil bli bedre i stand"
   ```

2. **AI spør oppfølgingsspørsmål** - svar gjerne:
   ```
   "Jeg vil løpe 5 km uten pause"
   ```

3. **Fortsett dialogen:**
   ```
   "Hvorfor synes du det er et godt mål?"
   ```
   
   ✅ AI-en skal referere til 5 km-målet du nevnte!

### Test 3: Refresh og last inn historikk

1. **Ha en samtale med noen meldinger**

2. **Refresh siden (F5 eller Cmd+R)**

3. **Se at samtalen er lastet inn!**
   - Alle tidligere meldinger vises
   - Kan fortsette der du slapp
   
   ✅ Historikk persisteres!

### Test 4: Ny samtale

1. **Klikk "Ny samtale"-knappen** (øverst til høyre)

2. **Bekreft dialogen**

3. **Siden reloader med tom chat**
   - Gammel samtale er lagret i database
   - Klar for ny diskusjon
   
   ✅ Kan starte fresh!

### Test 5: Verifiser i database

1. **Åpne Drizzle Studio:**
   ```bash
   npm run db:studio
   ```

2. **Gå til "conversations"-tabellen**
   - Se dine samtaler
   - Noter `id` på en samtale

3. **Gå til "messages"-tabellen**
   - Filtrer på `conversation_id`
   - Se alle meldinger i samtalen
   - Både bruker og assistent-meldinger

## 🎯 Forventet oppførsel

### AI husker:
- ✅ Navn og personlig info
- ✅ Mål du har diskutert
- ✅ Tidligere preferanser
- ✅ Kontekst fra tidligere i samtalen

### AI husker IKKE (på tvers av samtaler):
- ❌ Meldinger fra forrige samtale (når du starter ny)
- ❌ Dette er by design - hver samtale er isolert

## 📊 Teknisk oversikt

### Backend-flyt:
```
1. Bruker sender melding
2. Lagre melding i database
3. Hent siste 10 meldinger fra conversation
4. Send til OpenAI med full historikk
5. Motta AI-svar
6. Lagre AI-svar i database
7. Returner til frontend
```

### Database-struktur:
```
conversations (id, user_id, title, created_at, updated_at)
    ↓
messages (id, conversation_id, role, content, created_at)
```

### Historikk-limit:
- Frontend viser: **Alle meldinger** i samtalen
- Backend sender til AI: **Siste 10 meldinger** (for å spare tokens)
- Dette kan justeres i `src/lib/server/conversations.ts`

## 🔧 Justeringer

### Endre antall meldinger som sendes til AI:

I `src/routes/api/chat/+server.ts`, linje ~90:
```typescript
const history = await getConversationHistory(conversation.id, 10);
// Endre 10 til ønsket antall (f.eks. 20)
```

### Automatisk tittel på samtaler:

Vi kan senere legge til en funksjon som automatisk navngir samtaler basert på første mål som diskuteres.

## 🐛 Feilsøking

### Historikk vises ikke etter refresh
- Sjekk at database er koblet til
- Sjekk console for errors
- Verifiser at meldinger lagres i database

### AI husker ikke
- Sjekk at `getConversationHistory` kalles
- Se i Network-tab at meldinger sendes
- Verifiser limit (må være > 0)

### "Ny samtale" fungerer ikke
- Sjekk at `/api/conversations/new` endpoint svarer
- Se i console for errors
- Verifiser at reload skjer

## ✨ Neste forbedringer

- [ ] Liste over alle tidligere samtaler
- [ ] Bytte mellom samtaler
- [ ] Søk i samtale-historikk
- [ ] Eksporter samtale
- [ ] Dele samtale
- [ ] Auto-generert tittel basert på innhold
