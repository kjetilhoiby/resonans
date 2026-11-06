import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseInboundPayload, hasWorkoutAttachments } from '$lib/server/email/inbound';
import { loadActiveRules, matchRules } from '$lib/server/email/process-inbound';

/**
 * «Hvilke regler treffer denne e-posten?» — mot brukerens EKTE regler, med
 * samme matching som /api/email/inbound. Kjører ingen prosessor og skriver
 * ingenting.
 *
 * Fram til november 2026 gikk testknappen gjennom et eget, gammelt
 * label-oppsett (`router.ts`) som ikke var det Gmail-scriptet postet til, så en
 * grønn test sa ingenting om prod.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	let raw: Record<string, unknown>;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const payload = parseInboundPayload(raw);
	const matched = matchRules(await loadActiveRules(locals.userId), payload);

	return json({
		matched: matched.map((r) => ({ id: r.id, name: r.name, processingType: r.processingType })),
		workoutFallback: matched.length === 0 && hasWorkoutAttachments(payload)
	});
};
