// Google Apps Script – videresender e-post fra Gmail til Resonans
// Støtter flere Gmail-labels for ulike e-posttyper (treningsfiler, kvitteringer, ukeplaner, etc.)
//
// Oppsett:
//   1. Gå til https://script.google.com og opprett nytt prosjekt
//   2. Lim inn denne koden
//   3. Sett WEBHOOK_URL og WEBHOOK_SECRET under (eller bruk Script Properties)
//   4. Legg til Gmail-labels i GMAIL_LABELS-listen
//   5. Opprett matchende Gmail-filter som setter riktig label
//   6. Kjør setupTrigger() én gang manuelt for å opprette minutt-trigger
//   7. Autoriser tilgang til Gmail når du blir bedt om det
//
// Gmail-filter eksempler:
//   - Fra: noreply@oda.com → Label: resonans/oda
//   - Fra: *@spond.com Emne: "Ukeplan" → Label: resonans/ukeplan
//   - Har vedlegg: .gpx OR .tcx → Label: resonans/trening

var WEBHOOK_URL = 'https://resonans.vercel.app/api/email/inbound';
var WEBHOOK_SECRET = ''; // samme verdi som EMAIL_WEBHOOK_SECRET i Vercel env
var SENDER_EMAIL = Session.getActiveUser().getEmail();

// Alle labels som skal sjekkes. Gmail-filter ruter e-poster hit.
var GMAIL_LABELS = [
  'resonans/trening',
  'resonans/oda',
  'resonans/ukeplan',
  'resonans/bibliotek'
];

function checkEmails() {
  for (var l = 0; l < GMAIL_LABELS.length; l++) {
    var labelName = GMAIL_LABELS[l];
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) continue;

    var threads = label.getThreads(0, 20);

    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();

      for (var j = 0; j < messages.length; j++) {
        var message = messages[j];
        if (!message.isUnread()) continue;

        var success = forwardEmail(message, labelName);
        if (success) {
          message.markRead();
        }
      }
    }
  }
}

function forwardEmail(message, labelName) {
  var attachments = message.getAttachments();
  var payloadAttachments = [];

  for (var k = 0; k < attachments.length; k++) {
    var att = attachments[k];
    payloadAttachments.push({
      Name: att.getName(),
      Content: Utilities.base64Encode(att.getBytes()),
      ContentType: att.getContentType(),
      ContentLength: att.getSize()
    });
  }

  var payload = JSON.stringify({
    UserEmail: SENDER_EMAIL,
    From: message.getFrom() || SENDER_EMAIL,
    Subject: message.getSubject(),
    TextBody: message.getPlainBody(),
    HtmlBody: message.getBody(),
    Label: labelName,
    Attachments: payloadAttachments,
    GmailMessageId: message.getId(),
    GmailDate: message.getDate().toISOString()
  });

  try {
    var response = UrlFetchApp.fetch(WEBHOOK_URL + '?token=' + encodeURIComponent(WEBHOOK_SECRET), {
      method: 'post',
      contentType: 'application/json',
      payload: payload,
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    var body = response.getContentText();
    Logger.log('[' + labelName + '] ' + message.getSubject() + ' → HTTP ' + code + ': ' + body);

    return code === 200;
  } catch (e) {
    Logger.log('[' + labelName + '] Nettverksfeil: ' + e.toString());
    return false;
  }
}

function testWebhook() {
  Logger.log('=== WEBHOOK TEST ===');
  Logger.log('URL: ' + WEBHOOK_URL);
  Logger.log('Labels: ' + GMAIL_LABELS.join(', '));

  for (var l = 0; l < GMAIL_LABELS.length; l++) {
    var labelName = GMAIL_LABELS[l];
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      Logger.log('[' + labelName + '] Label finnes ikke i Gmail – opprett den først');
      continue;
    }

    var threads = label.getThreads(0, 20);
    var unreadCount = 0;
    var totalCount = 0;

    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var j = 0; j < messages.length; j++) {
        totalCount++;
        if (messages[j].isUnread()) unreadCount++;
      }
    }
    Logger.log('[' + labelName + '] ' + totalCount + ' meldinger, ' + unreadCount + ' uleste');
  }

  // Ping webhook
  Logger.log('\n--- Sender testpuls ---');
  var testPayload = JSON.stringify({
    UserEmail: SENDER_EMAIL,
    From: SENDER_EMAIL,
    Subject: 'webhook-test',
    TextBody: 'Test fra Apps Script',
    Label: 'resonans/test',
    Attachments: []
  });
  try {
    var res = UrlFetchApp.fetch(WEBHOOK_URL + '?token=' + encodeURIComponent(WEBHOOK_SECRET), {
      method: 'post',
      contentType: 'application/json',
      payload: testPayload,
      muteHttpExceptions: true
    });
    Logger.log('HTTP ' + res.getResponseCode() + ': ' + res.getContentText());
    if (res.getResponseCode() === 401) {
      Logger.log('FEIL: WEBHOOK_SECRET stemmer ikke');
    }
  } catch (e) {
    Logger.log('NETTVERKSFEIL: ' + e.toString());
  }
}

function reprocessAll() {
  for (var l = 0; l < GMAIL_LABELS.length; l++) {
    var labelName = GMAIL_LABELS[l];
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) continue;

    var threads = label.getThreads(0, 50);
    var sent = 0;

    for (var i = 0; i < threads.length; i++) {
      var messages = threads[i].getMessages();
      for (var j = 0; j < messages.length; j++) {
        if (forwardEmail(messages[j], labelName)) sent++;
      }
    }
    Logger.log('[' + labelName + '] Sendt ' + sent + ' meldinger');
  }
}

function setupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Fjern gammel trigger for checkWorkoutEmails hvis den finnes
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkWorkoutEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('checkEmails')
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log('Trigger opprettet – kjøres hvert minutt');
}
