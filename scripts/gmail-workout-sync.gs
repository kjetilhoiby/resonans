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
        var response = UrlFetchApp.fetch(WEBHOOK_URL + '?token=' + WEBHOOK_SECRET, {
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
