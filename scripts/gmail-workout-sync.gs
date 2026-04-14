// Google Apps Script – sender GPX/TCX-vedlegg fra Gmail til Resonans-webhook
// Oppsett:
//   1. Gå til https://script.google.com og opprett nytt prosjekt
//   2. Lim inn denne koden
//   3. Sett WEBHOOK_URL og WEBHOOK_SECRET under (eller bruk Script Properties)
//   4. Kjør setupTrigger() én gang manuelt for å opprette minutt-trigger
//   5. Autoriser tilgang til Gmail når du blir bedt om det

var WEBHOOK_URL = 'https://DITT-DOMENE.no/api/workouts/email-inbound';
var WEBHOOK_SECRET = 'DIN_EMAIL_WEBHOOK_SECRET'; // samme verdi som i Vercel env
var GMAIL_LABEL = 'workout-import'; // label som Gmail-filteret setter
var SENDER_EMAIL = Session.getActiveUser().getEmail();

function checkWorkoutEmails() {
  var label = GmailApp.getUserLabelByName(GMAIL_LABEL);
  if (!label) {
    Logger.log('Label "' + GMAIL_LABEL + '" finnes ikke – opprett den i Gmail først');
    return;
  }

  var threads = label.getThreads(0, 20);

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var messages = thread.getMessages();

    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];
      if (message.isUnread() === false) continue;

      var attachments = message.getAttachments();
      var workoutAttachments = [];

      for (var k = 0; k < attachments.length; k++) {
        var att = attachments[k];
        var name = att.getName().toLowerCase();
        if (name.endsWith('.gpx') || name.endsWith('.tcx')) {
          workoutAttachments.push({
            Name: att.getName(),
            Content: Utilities.base64Encode(att.getBytes()),
            ContentType: att.getContentType(),
            ContentLength: att.getSize()
          });
        }
      }

      if (workoutAttachments.length === 0) {
        message.markRead();
        continue;
      }

      var payload = JSON.stringify({
        From: SENDER_EMAIL,
        Subject: message.getSubject(),
        Attachments: workoutAttachments
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
        Logger.log('Respons ' + code + ': ' + body);

        if (code === 200) {
          message.markRead();
        } else {
          Logger.log('Feil fra webhook – beholder som ulest for neste kjøring');
        }
      } catch (e) {
        Logger.log('Nettverksfeil: ' + e.toString());
      }
    }
  }
}

/**
 * Kjør denne manuelt fra Apps Script-editoren for å teste webhooken og se alle GPX-mails.
 * Viser status uten å markere noen meldinger som lest.
 */
function testWebhook() {
  Logger.log('=== WEBHOOK TEST ===');
  Logger.log('URL: ' + WEBHOOK_URL);

  // Sjekk om label eksisterer
  var label = GmailApp.getUserLabelByName(GMAIL_LABEL);
  if (!label) {
    Logger.log('FEIL: Label "' + GMAIL_LABEL + '" finnes ikke i Gmail');
    return;
  }

  var threads = label.getThreads(0, 50);
  Logger.log('Fant ' + threads.length + ' tråder med label "' + GMAIL_LABEL + '"');

  var gpxCount = 0;
  var readCount = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var msg = messages[j];
      var atts = msg.getAttachments();
      var gpxAtts = atts.filter(function(a) {
        var n = a.getName().toLowerCase();
        return n.endsWith('.gpx') || n.endsWith('.tcx');
      });
      if (gpxAtts.length > 0) {
        gpxCount++;
        var status = msg.isUnread() ? 'ULEST' : 'LEST (vil ikke plukkes opp automatisk)';
        Logger.log('[' + status + '] ' + msg.getDate() + ' — ' + msg.getSubject() + ' (' + gpxAtts.map(function(a) { return a.getName(); }).join(', ') + ')');
        if (!msg.isUnread()) readCount++;
      }
    }
  }

  Logger.log('Totalt GPX-meldinger: ' + gpxCount + ', derav allerede lest: ' + readCount);

  if (gpxCount === 0) {
    Logger.log('Ingen GPX-vedlegg funnet. Sjekk at Gmail-filteret setter label "' + GMAIL_LABEL + '" på innkommende meldinger');
    return;
  }

  // Send én minimal test-request til webhook for å verifisere at den svarer
  Logger.log('\n--- Sender testpuls til webhook ---');
  var testPayload = JSON.stringify({
    From: SENDER_EMAIL,
    Subject: 'webhook-test',
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
      Logger.log('FEIL: WEBHOOK_SECRET stemmer ikke med Vercel-miljøet');
    } else if (res.getResponseCode() === 200) {
      Logger.log('OK: Webhook svarer. (Ingen vedlegg = skipped, det er normalt)');
    }
  } catch (e) {
    Logger.log('NETTVERKSFEIL: ' + e.toString());
  }
}

/**
 * Tving re-prosessering av ALLE meldinger med GPX-vedlegg under labelen,
 * inkludert allerede-leste. Bruk dette for å importere Dublin-mails manuelt.
 */
function reprocessAllGpxMails() {
  var label = GmailApp.getUserLabelByName(GMAIL_LABEL);
  if (!label) { Logger.log('Label ikke funnet'); return; }

  var threads = label.getThreads(0, 50);
  var imported = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    for (var j = 0; j < messages.length; j++) {
      var message = messages[j];
      var attachments = message.getAttachments();
      var workoutAttachments = [];

      for (var k = 0; k < attachments.length; k++) {
        var att = attachments[k];
        var name = att.getName().toLowerCase();
        if (name.endsWith('.gpx') || name.endsWith('.tcx')) {
          workoutAttachments.push({
            Name: att.getName(),
            Content: Utilities.base64Encode(att.getBytes()),
            ContentType: att.getContentType(),
            ContentLength: att.getSize()
          });
        }
      }

      if (workoutAttachments.length === 0) continue;

      var payload = JSON.stringify({
        From: SENDER_EMAIL,
        Subject: message.getSubject(),
        Attachments: workoutAttachments
      });

      try {
        var response = UrlFetchApp.fetch(WEBHOOK_URL + '?token=' + encodeURIComponent(WEBHOOK_SECRET), {
          method: 'post',
          contentType: 'application/json',
          payload: payload,
          muteHttpExceptions: true
        });
        var body = response.getContentText();
        Logger.log(message.getSubject() + ' → HTTP ' + response.getResponseCode() + ': ' + body);
        if (response.getResponseCode() === 200) imported++;
      } catch (e) {
        Logger.log('Feil for ' + message.getSubject() + ': ' + e.toString());
      }
    }
  }

  Logger.log('Ferdig. Sendte ' + imported + ' meldinger til webhook.');
}

// Kjør denne funksjonen én gang manuelt for å sette opp automatisk kjøring hvert minutt
function setupTrigger() {
  // Fjern eventuelle eksisterende triggere for denne funksjonen
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkWorkoutEmails') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('checkWorkoutEmails')
    .timeBased()
    .everyMinutes(5)
    .create();

  Logger.log('Trigger opprettet – kjøres hvert 5. minutt');
}
