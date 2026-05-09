interface AppsScriptOptions {
	endpoint: string;
	token: string;
}

export function buildAppsScript({ endpoint, token }: AppsScriptOptions): string {
	return `// Auto-generert av Resonans. Lim inn i script.google.com → Project → Code.gs.
// Sett opp en tidsutløser som kjører syncResonans() hvert 5. minutt.

const ENDPOINT     = ${JSON.stringify(endpoint)};
const TOKEN        = ${JSON.stringify(token)};
const LABEL_PREFIX = 'Resonans/';

function getResonansLabels() {
  return GmailApp.getUserLabels().filter(function(l) {
    return l.getName().indexOf(LABEL_PREFIX) === 0;
  });
}

function syncResonans() {
  const labels = getResonansLabels();
  if (labels.length === 0) {
    console.log('Ingen Gmail-labels funnet med prefiks "' + LABEL_PREFIX + '"');
    return;
  }

  for (const label of labels) {
    const labelName = label.getName();
    const threads = label.getThreads(0, 25);

    for (const thread of threads) {
      const messages = thread.getMessages();
      let allOk = true;

      for (const msg of messages) {
        if (msg.isInTrash()) continue;
        try {
          postMessage(labelName, msg);
        } catch (e) {
          allOk = false;
          console.error('Resonans-post feilet:', labelName, msg.getSubject(), e);
        }
      }

      // Fjern label etter at hele tråden er sendt — sikrer idempotens.
      if (allOk) label.removeFromThread(thread);
    }
  }
}

function postMessage(labelName, msg) {
  const attachments = (msg.getAttachments() || []).map((a) => ({
    name: a.getName(),
    contentType: a.getContentType(),
    base64: Utilities.base64Encode(a.getBytes()),
    size: a.getBytes().length
  }));

  const payload = {
    gmailMessageId: msg.getId(),
    gmailThreadId:  msg.getThread().getId(),
    internalDate:   msg.getDate().getTime(),
    from:           msg.getFrom(),
    to:             msg.getTo(),
    subject:        msg.getSubject(),
    bodyText:       msg.getPlainBody(),
    label:          labelName,
    attachments
  };

  const url = ENDPOINT + (ENDPOINT.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(TOKEN);

  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('HTTP ' + code + ': ' + response.getContentText());
  }
}
`;
}
