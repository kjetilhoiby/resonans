import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * POST /api/books/analyze-image
 * Accepts a FormData field 'image', sends it to GPT-4o vision,
 * and returns extracted book metadata: title, author, format, totalMinutes, currentMinutes.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await request.formData().catch(() => null);
	const imageFile = formData?.get('image') as File | null;
	if (!imageFile || typeof imageFile === 'string') {
		return json({ error: 'Mangler bilde' }, { status: 400 });
	}

	const bytes = await imageFile.arrayBuffer();
	const base64 = Buffer.from(bytes).toString('base64');
	const mimeType = imageFile.type || 'image/jpeg';

	const response = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'image_url',
						image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' }
					},
					{
						type: 'text',
						text: `Analyser dette bildet. Er det et bokomslag, en lydbok-app, et skjermbilde fra en lydboklytter, eller noe annet?

Svar KUN med gyldig JSON (ingen markdown, ingen forklaring):
{
  "title": "boktittel eller null",
  "author": "forfatter eller null",
  "format": "audio" | "print" | "unknown",
  "totalMinutes": heltall_total_varighet_i_minutter_eller_null,
  "currentMinutes": heltall_nåværende_posisjon_i_minutter_eller_null
}

Regler:
- Hvis bildet viser en lydbok-app med tider (f.eks. "0:47:33" av "2:43:48"): konverter H:MM:SS til minutter
- Hvis det er et bokomslag uten tider: format="print", totalMinutes=null, currentMinutes=null
- Hvis du er usikker på noe felt, bruk null`
					}
				]
			}
		],
		max_tokens: 300
	});

	const raw = (response.choices[0].message.content ?? '').trim();
	try {
		// Strip potential markdown code fences
		const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
		const parsed = JSON.parse(clean);
		return json({
			title: typeof parsed.title === 'string' ? parsed.title : null,
			author: typeof parsed.author === 'string' ? parsed.author : null,
			format: ['audio', 'print', 'both'].includes(parsed.format) ? parsed.format : 'print',
			totalMinutes: typeof parsed.totalMinutes === 'number' ? Math.round(parsed.totalMinutes) : null,
			currentMinutes: typeof parsed.currentMinutes === 'number' ? Math.round(parsed.currentMinutes) : null
		});
	} catch {
		return json({ error: 'Klarte ikke tolke bildet' }, { status: 422 });
	}
};
