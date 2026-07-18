/**
 * oda-receipt.ts — parser Oda-ordrebekreftelser og -kvitteringer fra e-post
 * til strukturerte grocery_orders + grocery_order_lines.
 *
 * Kvittering etter levering oppdaterer ordrebekreftelsens rad via unik
 * (user, provider, order_ref) — linjene erstattes. Idempotens per e-post via
 * (user, gmail_message_id). Varelinjer kobles senere til pantry via
 * «Legg i lager»-flyten (apply-pantry-endepunktet) — ingenting skrives
 * automatisk til lageret her.
 */

import { db } from '$lib/db';
import { emailRules, groceryOrders, groceryOrderLines, shoppingLists } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { findOrCreateEmailSensor, stripHtml, type InboundEmailPayload } from './shared';
import {
	guessCategory,
	guessPantryLocation,
	weekContextForDate,
	type GroceryCategory
} from '$lib/domains/food/grocery';

type EmailRule = typeof emailRules.$inferSelect;

interface OdaLine {
	navn: string;
	mengde: number | null;
	enhet: string | null;
	enhetspris: number | null;
	totalpris: number | null;
	kategori: string | null;
}

interface OdaExtraction {
	type: 'ordrebekreftelse' | 'kvittering';
	ordrenummer: string | null;
	ordredato: string | null;
	leveringsdato: string | null;
	total: number | null;
	varelinjer: OdaLine[];
}

const VALID_CATEGORIES: GroceryCategory[] = [
	'frukt_gront', 'meieri', 'brod', 'kjott_fisk', 'torrvarer', 'frys',
	'drikke', 'snacks', 'husholdning', 'pant_gebyr', 'annet'
];

const EXTRACTION_PROMPT = `Du leser en e-post fra Oda (norsk dagligvarelevering) — en ordrebekreftelse eller kvittering.
Trekk ut ordreinformasjon og ALLE varelinjer.

Returner KUN gyldig JSON med denne strukturen:
{
  "type": "ordrebekreftelse" | "kvittering",
  "ordrenummer": "Odas ordrenummer, eller null",
  "ordredato": "YYYY-MM-DD eller null",
  "leveringsdato": "YYYY-MM-DD eller null",
  "total": 1842.50,
  "varelinjer": [
    {
      "navn": "varenavnet NØYAKTIG slik det står i e-posten",
      "mengde": 2,
      "enhet": "stk" | "kg" | "l" | null,
      "enhetspris": 12.90,
      "totalpris": 25.80,
      "kategori": "frukt_gront" | "meieri" | "brod" | "kjott_fisk" | "torrvarer" | "frys" | "drikke" | "snacks" | "husholdning" | "pant_gebyr" | "annet"
    }
  ]
}

Regler:
- Ta med ALLE varelinjer, også pant, leveringsgebyr og poseavgift (kategori "pant_gebyr").
- Ikke finn på priser eller datoer — bruk null når noe ikke står i e-posten.
- Behold norske varenavn ordrett, med merkevare og størrelse.
- Norske desimaltall («12,90») skrives som 12.90 i JSON.`;

async function extractOdaOrder(
	payload: InboundEmailPayload,
	extraPrompt?: string | null
): Promise<OdaExtraction | null> {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	if (!body) return null;

	const systemPrompt = extraPrompt?.trim()
		? `${EXTRACTION_PROMPT}\n\nEkstra instruksjoner fra brukeren (følg disse i tillegg):\n${extraPrompt.trim()}`
		: EXTRACTION_PROMPT;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: systemPrompt },
			{
				role: 'user',
				content: `Emne: ${payload.Subject ?? '(ingen)'}\n\n${body.slice(0, 24000)}`
			}
		],
		response_format: { type: 'json_object' },
		temperature: 0.1,
		max_tokens: 8000
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	try {
		const parsed = JSON.parse(raw) as Partial<OdaExtraction>;
		if (!Array.isArray(parsed.varelinjer) || parsed.varelinjer.length === 0) return null;
		return {
			type: parsed.type === 'ordrebekreftelse' ? 'ordrebekreftelse' : 'kvittering',
			ordrenummer: parsed.ordrenummer ?? null,
			ordredato: isIsoDate(parsed.ordredato) ? parsed.ordredato! : null,
			leveringsdato: isIsoDate(parsed.leveringsdato) ? parsed.leveringsdato! : null,
			total: typeof parsed.total === 'number' ? parsed.total : null,
			varelinjer: parsed.varelinjer.filter((l) => l && typeof l.navn === 'string' && l.navn.trim())
		};
	} catch {
		return null;
	}
}

function isIsoDate(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function osloIsoDate(now: Date): string {
	return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

export async function processOdaReceiptEmail(
	userId: string,
	payload: InboundEmailPayload,
	rule: EmailRule
) {
	const gmailMessageId = payload.GmailMessageId ?? null;

	// Idempotens: samme e-post skal ikke gi to ordrer.
	if (gmailMessageId) {
		const already = await db.query.groceryOrders.findFirst({
			where: and(
				eq(groceryOrders.userId, userId),
				eq(groceryOrders.gmailMessageId, gmailMessageId)
			),
			columns: { id: true }
		});
		if (already) return { skipped: true, reason: 'already_imported' };
	}

	const extraction = await extractOdaOrder(payload, rule.extractionPrompt);
	if (!extraction) return { skipped: true, reason: 'no_lines_extracted' };

	const kind = extraction.type === 'ordrebekreftelse' ? 'order_confirmation' : 'receipt';
	const effectiveDate = extraction.leveringsdato ?? extraction.ordredato ?? osloIsoDate(new Date());
	const weekContext = weekContextForDate(effectiveDate);

	// Koble til ukas handleliste (DEL A) hvis den finnes — muliggjør plan-vs-kjøp.
	const weekList = await db.query.shoppingLists.findFirst({
		where: and(
			eq(shoppingLists.userId, userId),
			eq(shoppingLists.weekContext, weekContext),
			eq(shoppingLists.kind, 'week')
		),
		columns: { id: true }
	});

	// Kvittering erstatter ordrebekreftelse for samme ordrenummer.
	const existing = extraction.ordrenummer
		? await db.query.groceryOrders.findFirst({
				where: and(
					eq(groceryOrders.userId, userId),
					eq(groceryOrders.provider, 'oda'),
					eq(groceryOrders.orderRef, extraction.ordrenummer)
				)
			})
		: null;

	let orderId: string;
	if (existing) {
		await db
			.update(groceryOrders)
			.set({
				kind,
				orderDate: extraction.ordredato ?? existing.orderDate,
				deliveryDate: extraction.leveringsdato ?? existing.deliveryDate,
				weekContext,
				totalAmount: extraction.total != null ? String(extraction.total) : existing.totalAmount,
				gmailMessageId: gmailMessageId ?? existing.gmailMessageId,
				emailSubject: payload.Subject ?? existing.emailSubject,
				shoppingListId: existing.shoppingListId ?? weekList?.id ?? null,
				updatedAt: new Date()
			})
			.where(eq(groceryOrders.id, existing.id));
		await db.delete(groceryOrderLines).where(eq(groceryOrderLines.orderId, existing.id));
		orderId = existing.id;
	} else {
		const [created] = await db
			.insert(groceryOrders)
			.values({
				userId,
				provider: 'oda',
				orderRef: extraction.ordrenummer,
				kind,
				orderDate: extraction.ordredato,
				deliveryDate: extraction.leveringsdato,
				weekContext,
				totalAmount: extraction.total != null ? String(extraction.total) : null,
				gmailMessageId,
				emailSubject: payload.Subject ?? null,
				shoppingListId: weekList?.id ?? null
			})
			.returning({ id: groceryOrders.id });
		orderId = created.id;
	}

	if (extraction.varelinjer.length > 0) {
		await db.insert(groceryOrderLines).values(
			extraction.varelinjer.map((line, index) => {
				const category = VALID_CATEGORIES.includes(line.kategori as GroceryCategory)
					? (line.kategori as GroceryCategory)
					: guessCategory(line.navn);
				return {
					userId,
					orderId,
					name: line.navn.trim(),
					quantity: line.mengde != null ? String(line.mengde) : null,
					unit: line.enhet,
					unitPrice: line.enhetspris != null ? String(line.enhetspris) : null,
					totalPrice: line.totalpris != null ? String(line.totalpris) : null,
					category,
					pantryLocationGuess: guessPantryLocation(category, line.navn),
					sortOrder: index
				};
			})
		);
	}

	// Sensor-event holder e-poststrømmen konsistent med de andre prosessorene.
	const sensor = await findOrCreateEmailSensor(userId, 'oda_receipt');
	await SensorEventService.write(
		{
			userId,
			sensorId: sensor.id,
			eventType: 'grocery_receipt',
			dataType: 'grocery_order',
			timestamp: new Date(),
			data: {
				orderRef: extraction.ordrenummer,
				kind,
				total: extraction.total,
				lineCount: extraction.varelinjer.length,
				weekContext,
				deliveryDate: extraction.leveringsdato
			},
			metadata: { source: 'email_inbound', ruleId: rule.id, gmailMessageId },
			source: 'email_inbound'
		},
		{ conflictMode: 'ignore' }
	);

	return {
		success: true,
		orderId,
		kind,
		lines: extraction.varelinjer.length,
		total: extraction.total,
		weekContext
	};
}
