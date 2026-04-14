/**
 * Test email-inbound webhook locally
 * Usage: node scripts/test-email-webhook.mjs [url]
 * Default URL: http://localhost:5173
 */
import { config } from 'dotenv';
import postgres from 'postgres';

config();

const baseUrl = process.argv[2] ?? 'http://localhost:5173';
const secret = process.env.EMAIL_WEBHOOK_SECRET;
if (!secret) {
	console.error('❌ EMAIL_WEBHOOK_SECRET not set in .env');
	process.exit(1);
}

// Look up the user's email from the database to build a valid payload
const client = postgres(process.env.DATABASE_URL);
const [user] = await client`SELECT email FROM users LIMIT 1`;
await client.end();
if (!user?.email) {
	console.error('❌ No user found in database');
	process.exit(1);
}
console.log(`📧 Using sender email: ${user.email}`);

// Minimal valid GPX (1 km test run)
const testGpx = `<?xml version="1.0"?>
<gpx version="1.1" creator="test">
  <trk><trkseg>
    <trkpt lat="53.3498" lon="-6.2603"><ele>15</ele><time>2026-04-12T08:00:00Z</time><extensions><gpxtpx:hr>145</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="53.3508" lon="-6.2593"><ele>16</ele><time>2026-04-12T08:02:00Z</time><extensions><gpxtpx:hr>152</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="53.3518" lon="-6.2583"><ele>17</ele><time>2026-04-12T08:04:00Z</time><extensions><gpxtpx:hr>158</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="53.3528" lon="-6.2573"><ele>16</ele><time>2026-04-12T08:06:00Z</time><extensions><gpxtpx:hr>155</gpxtpx:hr></extensions></trkpt>
    <trkpt lat="53.3538" lon="-6.2563"><ele>15</ele><time>2026-04-12T08:08:00Z</time><extensions><gpxtpx:hr>150</gpxtpx:hr></extensions></trkpt>
  </trkseg></trk>
</gpx>`;

const payload = {
	From: user.email,
	FromFull: { Email: user.email, Name: 'Test' },
	Subject: 'Webhook test',
	Attachments: [
		{
			Name: 'test-run-dublin.gpx',
			Content: Buffer.from(testGpx).toString('base64'),
			ContentType: 'application/gpx+xml',
			ContentLength: testGpx.length
		}
	]
};

const url = `${baseUrl}/api/workouts/email-inbound?token=${encodeURIComponent(secret)}`;
console.log(`\n🚀 POST ${url}\n`);

const res = await fetch(url, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify(payload)
});

const body = await res.json();
console.log(`Status: ${res.status}`);
console.log('Response:', JSON.stringify(body, null, 2));

if (res.status === 200 && body.success) {
	console.log(`\n✅ Webhook fungerer! Importerte ${body.imported} økt(er).`);
	console.log('Sjekk /api/workouts/unified?days=7 for å bekrefte.');
} else if (res.status === 401) {
	console.log('\n❌ Unauthorized — EMAIL_WEBHOOK_SECRET stemmer ikke med det appen forventer.');
} else if (body.skipped) {
	console.log(`\n⚠️  Hoppet over: ${body.reason}`);
	if (body.reason === 'unknown_sender') {
		console.log(`   Brukeren med e-post "${user.email}" finnes ikke i databasen.`);
	}
} else {
	console.log('\n❌ Uventet respons.');
}
