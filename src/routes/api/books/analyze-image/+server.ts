import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import { parsePctBox, pctBoxToPixelCrop } from '$lib/server/book-cover-crop';

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

/**
 * Laster opp originalbildet til Cloudinary og returnerer en URL som er
 * beskåret til selve bokomslaget (basert på GPT-4o sin bounding-box).
 * Returnerer null hvis Cloudinary ikke er konfigurert eller noe feiler —
 * coveret er nice-to-have, ikke kritisk for bildeanalysen.
 */
async function extractCoverFromImage(dataURI: string, coverBox: unknown): Promise<string | null> {
	const box = parsePctBox(coverBox);
	if (!box) return null;
	if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
		return null;
	}

	try {
		// Ingen incoming-transformasjon: prosentboksen må regnes om mot de
		// faktiske lagrede dimensjonene som upload-responsen rapporterer.
		const upload = await cloudinary.uploader.upload(dataURI, {
			folder: 'resonans/book-covers',
			resource_type: 'image'
		});

		const crop = pctBoxToPixelCrop(box, upload.width, upload.height);
		if (!crop) return null;

		return cloudinary.url(upload.public_id, {
			secure: true,
			transformation: [
				{ crop: 'crop', x: crop.x, y: crop.y, width: crop.width, height: crop.height },
				{ width: 480, crop: 'limit' },
				{ quality: 'auto:good' },
				{ fetch_format: 'auto' }
			]
		});
	} catch (err) {
		console.error('Cover-ekstraksjon feilet:', err);
		return null;
	}
}

/**
 * POST /api/books/analyze-image
 * Accepts a FormData field 'image', sends it to GPT-4o vision,
 * and returns extracted book metadata: title, author, format, totalMinutes,
 * currentMinutes — plus coverUrl (omslaget beskåret ut av bildet via Cloudinary).
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
	const dataURI = `data:${mimeType};base64,${base64}`;

	const response = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{
				role: 'user',
				content: [
					{
						type: 'image_url',
						// 'high' for at coverBox-koordinatene skal bli presise nok til beskjæring
						image_url: { url: dataURI, detail: 'high' }
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
  "currentMinutes": heltall_nåværende_posisjon_i_minutter_eller_null,
  "coverBox": {"x": tall, "y": tall, "w": tall, "h": tall} | null
}

Regler:
- Hvis bildet viser en lydbok-app med tider (f.eks. "0:47:33" av "2:43:48"): konverter H:MM:SS til minutter
- Hvis det er et bokomslag uten tider: format="print", totalMinutes=null, currentMinutes=null
- coverBox: bounding-box rundt selve omslagskunsten (cover-bildet) i prosent av bildets bredde/høyde. x = prosent fra venstre kant, y = prosent fra toppen, w = bredde i prosent, h = høyde i prosent. Vær presis — boksen skal ramme inn akkurat omslaget, ikke resten av skjermen. Hvis hele bildet ER omslaget: {"x": 0, "y": 0, "w": 100, "h": 100}. Hvis ingen omslagskunst er synlig: null
- Hvis du er usikker på noe felt, bruk null`
					}
				]
			}
		],
		max_tokens: 300
	});

	const raw = (response.choices[0].message.content ?? '').trim();
	let parsed: Record<string, unknown>;
	try {
		// Strip potential markdown code fences
		const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
		parsed = JSON.parse(clean);
	} catch {
		return json({ error: 'Klarte ikke tolke bildet' }, { status: 422 });
	}

	const coverUrl = await extractCoverFromImage(dataURI, parsed.coverBox);

	return json({
		title: typeof parsed.title === 'string' ? parsed.title : null,
		author: typeof parsed.author === 'string' ? parsed.author : null,
		format: typeof parsed.format === 'string' && ['audio', 'print', 'both'].includes(parsed.format) ? parsed.format : 'print',
		totalMinutes: typeof parsed.totalMinutes === 'number' ? Math.round(parsed.totalMinutes) : null,
		currentMinutes: typeof parsed.currentMinutes === 'number' ? Math.round(parsed.currentMinutes) : null,
		coverUrl
	});
};
