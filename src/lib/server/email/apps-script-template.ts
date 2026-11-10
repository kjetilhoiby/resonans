import { CURRENT_SCRIPT_VERSION, INBOUND_SERVICE } from './inbound';

interface AppsScriptOptions {
	endpoint: string;
	token: string;
}

/**
 * Apps Script-kilden brukeren limer inn i script.google.com. Endrer du den så
 * brukeren bør hente den på nytt, øk `CURRENT_SCRIPT_VERSION` i `inbound.ts`;
 * innstillingene sier da fra om at det installerte scriptet er gammelt.
 *
 * Det v2 gjør annerledes enn v1, og hvorfor:
 * - **Sjekker serveren før noe sendes** (GET → `service`). v1 postet e-post og
 *   hemmelighet til `resonans.vercel.app` i uker etter at navnet hadde fått en
 *   ny eier.
 * - **Hemmeligheten i `Authorization`**, ikke i URL-en.
 * - **`userEmail` er kontoen scriptet kjører som.** v1 sendte bare `to`, som er
 *   et alias (`workout@hoi.by`) eller en annen adresse ved videresending.
 * - **HTML-innholdet sendes med**; uten det mister Funn og Oda lenker og tabeller.
 * - **Innebygde bilder er ikke vedlegg**, og store vedlegg hoppes over med navn.
 * - **«Resonans/Feilet» etter MAX_ATTEMPTS** i stedet for å prøve hvert minutt
 *   for alltid. Feilen blir synlig i Gmail, og tråden kan flyttes tilbake.
 */
export function buildAppsScript({ endpoint, token }: AppsScriptOptions): string {
	return `// Auto-generert av Resonans (script v${CURRENT_SCRIPT_VERSION}).
// Oppsett:
//   1. Lim inn i script.google.com → prosjektet «Resonans» → Code.gs (erstatt alt).
//   2. Kjør testResonans() én gang og se at loggen sier «OK».
//   3. Kjør installTrigger() én gang. Den fjerner gamle utløsere og lager en ny
//      som kjører syncResonans() hvert 5. minutt.
// Hent scriptet på nytt fra Resonans → Innstillinger → Kilder når Resonans sier
// at det er utdatert. Hemmeligheten under er den samme som EMAIL_WEBHOOK_SECRET.

const SCRIPT_VERSION = ${CURRENT_SCRIPT_VERSION};
const ENDPOINT       = ${JSON.stringify(endpoint)};
const TOKEN          = ${JSON.stringify(token)};
const SERVICE        = ${JSON.stringify(INBOUND_SERVICE)};
const LABEL_PREFIX   = 'Resonans/';
const FAILED_LABEL   = 'Resonans/Feilet';
const MAX_ATTEMPTS   = 12;              // ~1 time med 5-minutters utløser
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_HTML_CHARS = 400000;

function syncResonans() {
  const labels = GmailApp.getUserLabels().filter(function (l) {
    const name = l.getName();
    return name.indexOf(LABEL_PREFIX) === 0 && name !== FAILED_LABEL;
  });
  if (labels.length === 0) return;

  const pending = labels.some(function (l) { return l.getThreads(0, 1).length > 0; });
  if (!pending) return;

  // Ingenting sendes før serveren har vist at den er Resonans.
  if (!verifyServer_()) return;

  const props = PropertiesService.getScriptProperties();
  const userEmail = Session.getEffectiveUser().getEmail();

  for (const label of labels) {
    const labelName = label.getName();
    for (const thread of label.getThreads(0, 25)) {
      let allOk = true;
      let lastError = '';
      for (const msg of thread.getMessages()) {
        if (msg.isInTrash()) continue;
        try {
          postMessage_(labelName, msg, userEmail);
        } catch (e) {
          allOk = false;
          lastError = String(e).slice(0, 300);
        }
      }

      const key = 'attempts:' + thread.getId();
      if (allOk) {
        label.removeFromThread(thread);
        props.deleteProperty(key);
        continue;
      }

      const attempts = Number(props.getProperty(key) || '0') + 1;
      console.error('Resonans: ' + labelName + ' «' + thread.getFirstMessageSubject() + '» feilet (forsøk ' + attempts + '): ' + lastError);
      if (attempts >= MAX_ATTEMPTS) {
        const failed = GmailApp.getUserLabelByName(FAILED_LABEL) || GmailApp.createLabel(FAILED_LABEL);
        thread.addLabel(failed);
        label.removeFromThread(thread);
        props.deleteProperty(key);
      } else {
        props.setProperty(key, String(attempts));
      }
    }
  }
}

function verifyServer_() {
  try {
    const res = UrlFetchApp.fetch(ENDPOINT, { method: 'get', muteHttpExceptions: true, followRedirects: false });
    const body = JSON.parse(res.getContentText());
    if (res.getResponseCode() === 200 && body && body.service === SERVICE) {
      if (body.scriptVersion > SCRIPT_VERSION) {
        console.warn('Resonans: en nyere versjon av scriptet finnes (v' + body.scriptVersion + '). Hent den fra Innstillinger → Kilder.');
      }
      return true;
    }
  } catch (e) {
    // faller gjennom til feilmeldingen
  }
  console.error('Resonans: ' + ENDPOINT + ' svarer ikke som Resonans. Ingenting ble sendt. Sjekk adressen i Innstillinger → Kilder.');
  return false;
}

function postMessage_(labelName, msg, userEmail) {
  const attachments = [];
  const skippedAttachments = [];
  for (const a of msg.getAttachments({ includeInlineImages: false })) {
    const bytes = a.getBytes();
    if (bytes.length > MAX_ATTACHMENT_BYTES) {
      skippedAttachments.push(a.getName());
      continue;
    }
    attachments.push({
      name: a.getName(),
      contentType: a.getContentType(),
      base64: Utilities.base64Encode(bytes),
      size: bytes.length
    });
  }

  const payload = {
    scriptVersion:  SCRIPT_VERSION,
    userEmail:      userEmail,
    gmailMessageId: msg.getId(),
    gmailThreadId:  msg.getThread().getId(),
    internalDate:   msg.getDate().getTime(),
    from:           msg.getFrom(),
    to:             msg.getTo(),
    subject:        msg.getSubject(),
    bodyText:       msg.getPlainBody(),
    htmlBody:       (msg.getBody() || '').slice(0, MAX_HTML_CHARS),
    label:          labelName,
    attachments:    attachments,
    skippedAttachments: skippedAttachments
  };

  const res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + TOKEN },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: false
  });

  const code = res.getResponseCode();
  let body = null;
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* ikke JSON */ }
  if (!body || body.service !== SERVICE) {
    throw new Error('HTTP ' + code + ' fra noe som ikke er Resonans');
  }
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + (body.error || body.status || ''));
  }
}

/** Kjør én gang etter innliming. */
function testResonans() {
  console.log(verifyServer_() ? 'OK: ' + ENDPOINT + ' er Resonans (script v' + SCRIPT_VERSION + ').' : 'FEIL: se meldingen over.');
}

/** Kjør én gang: erstatter alle utløsere for syncResonans med én hvert 5. minutt. */
function installTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'syncResonans') ScriptApp.deleteTrigger(t);
  }
  ScriptApp.newTrigger('syncResonans').timeBased().everyMinutes(5).create();
  console.log('Utløser satt: syncResonans hvert 5. minutt.');
}
`;
}
