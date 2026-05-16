import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';

/**
 * POST /api/coffee/analyze-image
 * Accepts FormData with 'front' (required) and 'back' (optional) images.
 * Uses GPT-4o vision to extract coffee metadata from packaging photos.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const formData = await request.formData().catch(() => null);
	const frontFile = formData?.get('front') as File | null;
	if (!frontFile || typeof frontFile === 'string') {
		return json({ error: 'Mangler bilde (front)' }, { status: 400 });
	}

	const imageContent: Array<{ type: 'image_url'; image_url: { url: string; detail: 'low' | 'high' } }> = [];

	const frontBytes = await frontFile.arrayBuffer();
	const frontBase64 = Buffer.from(frontBytes).toString('base64');
	const frontMime = frontFile.type || 'image/jpeg';
	imageContent.push({
		type: 'image_url',
		image_url: { url: `data:${frontMime};base64,${frontBase64}`, detail: 'high' }
	});

	const backFile = formData?.get('back') as File | null;
	if (backFile && typeof backFile !== 'string') {
		const backBytes = await backFile.arrayBuffer();
		const backBase64 = Buffer.from(backBytes).toString('base64');
		const backMime = backFile.type || 'image/jpeg';
		imageContent.push({
			type: 'image_url',
			image_url: { url: `data:${backMime};base64,${backBase64}`, detail: 'high' }
		});
	}

	const response = await openai.chat.completions.create({
		model: 'gpt-4o',
		messages: [
			{
				role: 'user',
				content: [
					...imageContent,
					{
						type: 'text',
						text: `Analyser dette bildet/bildene av en kaffeemballasje. Trekk ut all tilgjengelig informasjon.

Svar KUN med gyldig JSON (ingen markdown, ingen forklaring):
{
  "name": "kaffenavnet eller null",
  "producer": "produsent/brenneri eller null",
  "originCountry": "opprinnelsesland eller null",
  "roastLevel": "Lys" | "Medium lys" | "Medium" | "Medium mørk" | "Mørk" | null,
  "grindLevel": "Ekstra fin" | "Fin" | "Medium fin" | "Medium" | "Medium grov" | "Grov" | "Ekstra grov" | null,
  "color": "Lys" | "Medium lys" | "Medium" | "Medium mørk" | "Mørk" | null,
  "flavorProfile": "smaksbeskrivelse eller null"
}

Regler:
- Hent informasjon fra BEGGE bilder hvis to bilder er gitt (forside og bakside).
- "name" er kaffenavnet/blandingen, ikke produsentnavnet.
- "producer" er brenneriet/merkevaren.
- "originCountry" er opprinnelsesland for bønnene (f.eks. "Etiopia", "Colombia"). Hvis blend fra flere land, list dem med komma.
- "roastLevel" må være en av de eksakte verdiene over, basert på det du ser eller leser. Bruk "color" for å gjette visuelt hvis ikke oppgitt eksplisitt.
- "grindLevel" er sjelden oppgitt — bruk null med mindre det står eksplisitt.
- "color" er bønnenes farge hvis synlig, ellers gjett fra brenningsgrad.
- "flavorProfile" skal samle smaksnotater, aroma, ettersmak — alt som beskrives på pakken. Skriv på norsk.
- Bruk null for alt du ikke finner eller er usikker på.`
					}
				]
			}
		],
		max_tokens: 500
	});

	const raw = (response.choices[0].message.content ?? '').trim();
	try {
		const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
		const parsed = JSON.parse(clean);

		const validRoast = ['Lys', 'Medium lys', 'Medium', 'Medium mørk', 'Mørk'];
		const validGrind = [
			'Ekstra fin',
			'Fin',
			'Medium fin',
			'Medium',
			'Medium grov',
			'Grov',
			'Ekstra grov'
		];
		const validColor = ['Lys', 'Medium lys', 'Medium', 'Medium mørk', 'Mørk'];

		return json({
			name: typeof parsed.name === 'string' ? parsed.name : null,
			producer: typeof parsed.producer === 'string' ? parsed.producer : null,
			originCountry: typeof parsed.originCountry === 'string' ? parsed.originCountry : null,
			roastLevel: validRoast.includes(parsed.roastLevel) ? parsed.roastLevel : null,
			grindLevel: validGrind.includes(parsed.grindLevel) ? parsed.grindLevel : null,
			color: validColor.includes(parsed.color) ? parsed.color : null,
			flavorProfile: typeof parsed.flavorProfile === 'string' ? parsed.flavorProfile : null
		});
	} catch {
		return json({ error: 'Klarte ikke tolke bildet' }, { status: 422 });
	}
};
