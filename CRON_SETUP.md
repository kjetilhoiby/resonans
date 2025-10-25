# Vercel Cron Setup

## Automatiske Daglige Notifikasjoner

Resonans bruker Vercel Cron Jobs for å sende daglige check-ins til Google Chat automatisk.

### Konfigurasjon

1. **Generer en Cron Secret**
   ```bash
   openssl rand -base64 32
   ```

2. **Legg til Environment Variable i Vercel**
   - Gå til Vercel Dashboard → Settings → Environment Variables
   - Legg til: `CRON_SECRET` med verdien fra steg 1
   - Velg: Production, Preview, og Development

3. **Deploy**
   - Push endringene til GitHub
   - Vercel vil automatisk deploye med cron job aktivert

### Cron Schedule

Definert i `vercel.json`:
- **Daglig Check-in**: `0 9 * * *` (kl. 09:00 UTC = 10:00/11:00 norsk tid)

For å endre tidspunkt, oppdater `schedule` i `vercel.json`:
- `0 8 * * *` = 08:00 UTC
- `0 7 * * *` = 07:00 UTC (09:00 norsk sommertid)

### Testing

Test cron-endepunktet lokalt:
```bash
curl http://localhost:5174/api/cron/daily-checkin \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

Test i produksjon (kun Vercel kan kalle dette automatisk):
```bash
curl https://your-app.vercel.app/api/cron/daily-checkin \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Hvordan det fungerer

1. Vercel kjører GET-request til `/api/cron/daily-checkin` hver dag kl. 09:00 UTC
2. Endepunktet finner alle brukere med:
   - Google Chat webhook konfigurert
   - Daily check-in aktivert i innstillinger
3. For hver bruker:
   - Henter aktive mål og oppgaver
   - Beregner fremgang
   - Bygger formatert melding
   - Sender til brukerens Google Chat webhook

### Notater

- **Vercel Cron krever Hobby plan eller høyere** (gratis plan støtter ikke cron)
- Cron secret beskytter endepunktet mot uautoriserte kall
- Brukere kan deaktivere daily check-in i `/settings`
- Tidssone håndteres per bruker via `timezone` felt
