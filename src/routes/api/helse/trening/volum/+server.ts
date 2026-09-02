import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { userWidgets } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { loadVolumeAndQuality } from '$lib/server/training/volume-quality';

/**
 * GET /api/helse/trening/volum?widget=<uuid>&sport=running
 *
 * Slepende volum, bånd, rampe og sonesammensetning. Bak widgetdetaljen.
 *
 * ## Hvorfor `widget`-parameteren
 *
 * Målverdien bor på widgeten brukeren trykket på (`user_widgets.goal`), og «i
 * rute» er meningsløst uten en referanse. Sender vi ikke widget-id-en, får
 * detaljen båndet men aldri målet — og da ville detaljen sagt noe annet enn
 * ringen på widgeten den ble åpnet fra.
 *
 * Ingen widget (eller en som ikke er brukerens) er ikke en feil: da svarer vi
 * mot båndet alene.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const widgetId = url.searchParams.get('widget');
	const sportFamily = url.searchParams.get('sport') ?? 'running';

	let goalKm: number | null = null;
	if (widgetId && /^[0-9a-f-]{36}$/i.test(widgetId)) {
		const widget = await db.query.userWidgets.findFirst({
			columns: { goal: true, unit: true },
			where: and(eq(userWidgets.id, widgetId), eq(userWidgets.userId, userId))
		});
		// Bare km-mål er sammenlignbare med en kilometerkurve. Et mål i «økter»
		// på samme widget ville blitt lest som kilometer og gitt «94 av 4».
		if (widget?.goal && widget.unit === 'km') {
			const parsed = Number(widget.goal);
			if (Number.isFinite(parsed) && parsed > 0) goalKm = parsed;
		}
	}

	const result = await loadVolumeAndQuality(userId, { sportFamily, goalKm });

	return json({
		today: result.today,
		sportFamily: result.sportFamily,
		goalKm,
		zoneCoverage: result.zoneCoverage,
		volume: Object.fromEntries(
			Object.entries(result.volume).map(([days, view]) => [
				days,
				{
					windowDays: view.windowDays,
					current: view.series.current,
					// **Målet gjelder BARE vinduet det ble satt for.** Uten dette
					// tegnet kortet en grønn mållinje på 90-dagersvinduet mens
					// setningen under sammenlignet mot båndet — en strek ingen
					// setning forklarte, i et kort som handler om formål.
					goalKm: view.level?.reference === 'goal' ? goalKm : null,
					// Bare dato + verdi til grafen: `TrailingSeries` bærer også
					// metadata konsumenten ikke trenger, og payloaden er 730 punkter.
					points: view.series.points,
					band: view.band,
					ramp: view.ramp,
					level: view.level,
					text: view.text
				}
			])
		),
		quality: Object.fromEntries(
			Object.entries(result.quality).map(([days, view]) => [
				days,
				{ composition: view.composition, text: view.text }
			])
		)
	});
};
