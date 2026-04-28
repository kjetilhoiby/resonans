import { z } from 'zod';
import { openai } from '$lib/server/openai';

export const analyzeMealImageTool = {
	name: 'analyze_meal_image',
	description: `Analyze a meal photo (Cloudinary URL) using GPT-4o vision and return a rough estimate of dish, ingredients and nutrition.

Use when the user uploads a food photo and wants to identify what's on the plate or get a coarse nutrition estimate.
Returns confidence score; nutrition is a best-effort guess and should be presented as an estimate, not a measurement.`,

	parameters: z.object({
		imageUrl: z.string().url().describe('Cloudinary URL from /api/upload-image or similar'),
		servings: z.number().optional().describe('Estimated portions in the photo (default 1)')
	}),

	execute: async (args: { imageUrl: string; servings?: number }) => {
		const servings = args.servings ?? 1;

		const response = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image_url', image_url: { url: args.imageUrl, detail: 'low' } },
						{
							type: 'text',
							text: `Analyser dette matbildet. Anslå rett, ingredienser og næringsinnhold per porsjon (${servings} porsjon(er) totalt).

Svar KUN med gyldig JSON (ingen markdown):
{
  "detectedDish": "navn på rett eller null",
  "ingredientsGuess": [{"name": "string", "quantity": number_or_null, "unit": "string_or_null"}],
  "nutritionEstimate": {
    "kcal": number_per_porsjon_eller_null,
    "proteinG": number_eller_null,
    "carbsG": number_eller_null,
    "fatG": number_eller_null
  },
  "confidence": 0.0_til_1.0,
  "notes": "kort kommentar om usikkerhet"
}`
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
			return {
				detectedDish: typeof parsed.detectedDish === 'string' ? parsed.detectedDish : null,
				ingredientsGuess: Array.isArray(parsed.ingredientsGuess) ? parsed.ingredientsGuess : [],
				nutritionEstimate: parsed.nutritionEstimate ?? null,
				confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.3,
				notes: typeof parsed.notes === 'string' ? parsed.notes : null,
				source: 'vision' as const
			};
		} catch {
			return { error: 'Klarte ikke tolke bildet', raw };
		}
	}
};
