import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import {
	refreshGoogleSheetsToken,
	readGoogleSheet,
	getSpreadsheetMeta
} from '$lib/server/integrations/google-sheets';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

type GoogleCredentials = {
	access_token: string;
	refresh_token?: string;
	expires_at: number;
	scope?: string;
	token_type?: string;
};

async function getValidAccessToken(sensor: typeof sensors.$inferSelect): Promise<string> {
	const credentials: GoogleCredentials = JSON.parse(atob(sensor.credentials ?? ''));
	const now = Math.floor(Date.now() / 1000);

	if (!credentials.expires_at || now < credentials.expires_at - 60) {
		return credentials.access_token;
	}

	if (!credentials.refresh_token) {
		throw new Error('Token utløpt. Koble til Google Regneark på nytt under Innstillinger.');
	}

	const refreshed = await refreshGoogleSheetsToken(credentials.refresh_token);
	const newExpiresAt = now + (refreshed.expires_in ?? 3600);
	const newCredentials: GoogleCredentials = {
		...credentials,
		access_token: refreshed.access_token,
		expires_at: newExpiresAt
	};

	await db
		.update(sensors)
		.set({
			credentials: btoa(JSON.stringify(newCredentials)),
			config: { expiresAt: newExpiresAt, scope: credentials.scope },
			updatedAt: new Date()
		})
		.where(eq(sensors.id, sensor.id));

	return refreshed.access_token;
}

/**
 * GET /api/sensors/google-sheets/read?spreadsheetId=…&range=…&meta=true
 *
 * spreadsheetId  — required: the Google Spreadsheet ID or full URL
 * range          — optional: A1 notation, e.g. "Sheet1!A1:D50". Defaults to the whole first sheet.
 * meta           — optional: if "true", returns sheet/tab names instead of values
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const sensor = await db.query.sensors.findFirst({
		where: and(
			eq(sensors.userId, locals.userId),
			eq(sensors.provider, 'google_sheets'),
			eq(sensors.type, 'spreadsheet'),
			eq(sensors.isActive, true)
		)
	});

	if (!sensor) {
		return json(
			{ error: 'Ingen tilkobling til Google Regneark. Koble til under Innstillinger.' },
			{ status: 401 }
		);
	}

	const rawId = url.searchParams.get('spreadsheetId') ?? '';
	// Accept either a bare ID or a full sheets URL
	const spreadsheetId = rawId.includes('docs.google.com')
		? (rawId.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ?? rawId)
		: rawId.trim();

	if (!spreadsheetId) {
		return json({ error: 'Mangler spreadsheetId parameter.' }, { status: 400 });
	}

	const range = url.searchParams.get('range') ?? '';
	const wantMeta = url.searchParams.get('meta') === 'true';

	try {
		const accessToken = await getValidAccessToken(sensor);

		if (wantMeta) {
			const meta = await getSpreadsheetMeta(accessToken, spreadsheetId);
			return json({
				spreadsheetId: meta.spreadsheetId,
				title: meta.properties.title,
				sheets: meta.sheets.map((s) => ({
					index: s.properties.index,
					sheetId: s.properties.sheetId,
					title: s.properties.title
				}))
			});
		}

		const data = await readGoogleSheet(accessToken, spreadsheetId, range);

		await db
			.update(sensors)
			.set({ lastSync: new Date(), lastError: null, updatedAt: new Date() })
			.where(eq(sensors.id, sensor.id));

		return json({
			spreadsheetId,
			range: data.range,
			values: data.values ?? [],
			rowCount: data.values?.length ?? 0,
			colCount: data.values?.[0]?.length ?? 0
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		await db
			.update(sensors)
			.set({ lastError: message, updatedAt: new Date() })
			.where(eq(sensors.id, sensor.id));

		return json({ error: message }, { status: 500 });
	}
};
