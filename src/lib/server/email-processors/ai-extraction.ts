import { openai } from '$lib/server/openai';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import type { InboundEmailPayload } from './shared';
import type { emailRules } from '$lib/db/schema';

type EmailRule = typeof emailRules.$inferSelect;

const DEFAULT_EXTRACTION_PROMPT = `Du mottar en e-post. Trekk ut strukturert informasjon fra innholdet.

Returner et JSON-objekt med feltene:
- "summary": kort oppsummering (1-2 setninger)
- "items": liste med relevante elementer (varer, hendelser, påminnelser etc.)
- "amounts": eventuelle beløp nevnt (som tall)
- "dates": eventuelle datoer nevnt (ISO-format)
- "category": en kategori som beskriver innholdet (f.eks. "dagligvarer", "ukeplan", "påminnelse", "kvittering")

Svar KUN med valid JSON, ingen annen tekst.`;

function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

export async function processAiExtractionEmail(
	userId: string,
	sensor: { id: string },
	payload: InboundEmailPayload,
	rule: EmailRule
) {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	if (!body && !payload.Subject) {
		return { skipped: true, reason: 'no_content' };
	}

	const emailContent = [
		`Fra: ${payload.From}`,
		`Emne: ${payload.Subject ?? '(ingen)'}`,
		'',
		body.slice(0, 8000)
	].join('\n');

	const prompt = rule.extractionPrompt || DEFAULT_EXTRACTION_PROMPT;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: prompt },
			{ role: 'user', content: emailContent }
		],
		response_format: { type: 'json_object' },
		temperature: 0.1,
		max_tokens: 2000
	});

	const rawContent = completion.choices[0]?.message?.content ?? '{}';
	let extracted: Record<string, unknown>;
	try {
		extracted = JSON.parse(rawContent);
	} catch {
		extracted = { rawResponse: rawContent, parseError: true };
	}

	const { event } = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: rule.eventType,
		dataType: rule.dataType,
		timestamp: new Date(),
		data: {
			...extracted,
			emailSubject: payload.Subject,
			emailFrom: payload.From,
		},
		metadata: {
			source: 'email_inbound',
			ruleName: rule.name,
			ruleId: rule.id,
			processingType: 'ai_extraction',
		},
		source: 'email_inbound'
	}, { conflictMode: 'ignore' });

	return { success: true, eventId: event?.id, extracted };
}
