/**
 * Engangs partner-registrering mot Tesla Fleet API.
 *
 * Forutsetninger (i denne rekkefølgen):
 *  1. TESLA_CLIENT_ID / TESLA_CLIENT_SECRET ligger i .env (eller .env.local).
 *  2. Public-nøkkelen er DEPLOYET og når-bar på:
 *       https://<domene>/.well-known/appspecific/com.tesla.3p.public-key.pem
 *     Tesla henter den under registreringen — den MÅ være live i prod først.
 *
 * Kjør:  node scripts/tesla-register-partner.mjs
 * Valgfritt:  TESLA_DOMAIN=resonans.vercel.app TESLA_REGION=eu node scripts/...
 *
 * Idempotent: kan kjøres på nytt; Tesla oppdaterer bare registreringen.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Last env (.env.local > .env), samme mønster som øvrige scripts ──────────
const envPath = ['.env.local', '.env']
	.map((f) => resolve(__dirname, '..', f))
	.find((p) => {
		try {
			readFileSync(p);
			return true;
		} catch {
			return false;
		}
	});
if (envPath) {
	readFileSync(envPath, 'utf8')
		.split('\n')
		.forEach((line) => {
			const [k, ...v] = line.split('=');
			if (!k || process.env[k]) return;
			process.env[k] = v.join('=').trim().replace(/^["']|["']$/g, '');
		});
}

const CLIENT_ID = process.env.TESLA_CLIENT_ID;
const CLIENT_SECRET = process.env.TESLA_CLIENT_SECRET;
const DOMAIN = process.env.TESLA_DOMAIN ?? 'resonans.vercel.app';
const REGION = (process.env.TESLA_REGION ?? 'eu').toLowerCase();

const FLEET_BASE =
	REGION === 'na'
		? 'https://fleet-api.prd.na.vn.cloud.tesla.com'
		: 'https://fleet-api.prd.eu.vn.cloud.tesla.com';

const AUTH_TOKEN_URL = 'https://auth.tesla.com/oauth2/v3/token';
// Read-only scopes (samme som appen bruker). client_credentials kan ikke ha offline_access.
const PARTNER_SCOPE = 'openid vehicle_device_data vehicle_location';

if (!CLIENT_ID || !CLIENT_SECRET) {
	console.error('❌ TESLA_CLIENT_ID / TESLA_CLIENT_SECRET mangler i miljøet.');
	process.exit(1);
}

async function main() {
	// 0) Forhåndssjekk: er public-nøkkelen faktisk live på domenet?
	const keyUrl = `https://${DOMAIN}/.well-known/appspecific/com.tesla.3p.public-key.pem`;
	process.stdout.write(`🔎 Sjekker public-nøkkel: ${keyUrl}\n`);
	try {
		const keyRes = await fetch(keyUrl);
		const body = await keyRes.text();
		if (!keyRes.ok || !body.includes('BEGIN PUBLIC KEY')) {
			console.error(
				`❌ Public-nøkkelen er ikke tilgjengelig (HTTP ${keyRes.status}). Deploy først, så kjør på nytt.`
			);
			process.exit(1);
		}
		process.stdout.write('✅ Public-nøkkel funnet og ser gyldig ut.\n');
	} catch (err) {
		console.error(`❌ Klarte ikke å nå ${keyUrl}: ${err.message}`);
		process.exit(1);
	}

	// 1) Hent partner-token (client_credentials)
	process.stdout.write(`🔑 Henter partner-token (region=${REGION}, audience=${FLEET_BASE})…\n`);
	const tokenRes = await fetch(AUTH_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			scope: PARTNER_SCOPE,
			audience: FLEET_BASE
		})
	});
	const tokenJson = await tokenRes.json().catch(() => ({}));
	if (!tokenRes.ok || !tokenJson.access_token) {
		console.error(`❌ Token-feil (HTTP ${tokenRes.status}):`, JSON.stringify(tokenJson, null, 2));
		process.exit(1);
	}
	process.stdout.write('✅ Partner-token hentet.\n');

	// 2) Registrer domenet
	process.stdout.write(`📡 Registrerer domene "${DOMAIN}" hos Tesla…\n`);
	const regRes = await fetch(`${FLEET_BASE}/api/1/partner_accounts`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${tokenJson.access_token}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ domain: DOMAIN })
	});
	const regJson = await regRes.json().catch(() => ({}));
	if (!regRes.ok) {
		console.error(`❌ Registrering feilet (HTTP ${regRes.status}):`, JSON.stringify(regJson, null, 2));
		process.exit(1);
	}
	process.stdout.write('✅ Partner-registrering fullført:\n');
	process.stdout.write(JSON.stringify(regJson, null, 2) + '\n');
	process.stdout.write('\n🎉 Ferdig. Du kan nå koble til Tesla via /settings/sources.\n');
}

main().catch((err) => {
	console.error('❌ Uventet feil:', err);
	process.exit(1);
});
