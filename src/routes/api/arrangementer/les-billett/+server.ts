import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { readTicketFile, readTicketText } from '$lib/server/events/ticket-reader';

/**
 * Les en billett til et UTKAST. Lagrer ingenting.
 *
 * Skillet er med vilje: uttrekket er et forslag brukeren skal se over før det
 * blir et arrangement. Lagret det seg selv, ville en feillest dato ligget i
 * lista som om noen hadde bekreftet den.
 *
 * Tar enten en fil (`multipart/form-data`) eller ren tekst (JSON) — en
 * e-postbekreftelse limt inn er den andre vanlige kilden.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const contentType = request.headers.get('content-type') ?? '';

	try {
		if (contentType.includes('application/json')) {
			const body = (await request.json().catch(() => null)) as { text?: string } | null;
			const text = body?.text?.trim();
			if (!text) return json({ error: 'Ingen tekst å lese.' }, { status: 400 });
			const { draft, raw } = await readTicketText(text);
			return json({ draft, raw, tickets: [] });
		}

		if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
			// Opplasting er ikke konfigurert. Si det — et bilde som stille forsvinner
			// ser ut som at lesingen mislyktes, og brukeren prøver igjen.
			return json({ error: 'Bildeopplasting er ikke satt opp på denne installasjonen.' }, { status: 503 });
		}

		const formData = await request.formData();
		const file = formData.get('file');
		if (!(file instanceof File)) return json({ error: 'Ingen fil mottatt.' }, { status: 400 });

		const noteValue = formData.get('note');
		const note = typeof noteValue === 'string' ? noteValue : '';

		const { draft, tickets, raw } = await readTicketFile(file, note);
		// `tickets` er flertall fordi én billettside kan inneholde én billett per
		// person. De peker på samme opplasting med hvert sitt utsnitt.
		return json({ draft, tickets, raw });
	} catch (error) {
		console.error('[billett] les-billett feilet:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Klarte ikke å lese billetten.' },
			{ status: 500 }
		);
	}
};
