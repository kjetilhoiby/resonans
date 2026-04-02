import { json } from '@sveltejs/kit';
import { syncDropboxWorkoutsForUser } from '$lib/server/integrations/dropbox-sync';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, url }) => {
	try {
		const fullRescan = url.searchParams.get('fullRescan') === 'true';
		const result = await syncDropboxWorkoutsForUser(locals.userId, {
			fullRescan,
			appUrl: url.origin
		});

		return json({
			success: true,
			fullRescan,
			...result,
			message: `Importerte ${result.imported} fil(er), hoppet over ${result.skipped}, feilet ${result.failed}.${result.notified ? ` Sendte ${result.notified} Google Chat-varsel.` : ''}`
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('Dropbox sync error:', message);
		return json({ success: false, error: message }, { status: 500 });
	}
};
