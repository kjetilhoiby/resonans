import { openai } from '$lib/server/openai';
import { referenceTableForPrompt } from '$lib/domain/nutrition/food-reference';
import {
	describeItem,
	parseEstimateResponse,
	type EstimateSource,
	type NutritionEstimate
} from '$lib/domain/nutrition/estimate';

/**
 * Tekst eller bilde → makroer.
 *
 * Modellen får referansetabellen som grunnlag og beskjed om å bruke den framfor
 * egne tall. Uten den spriker «knekkebrød» fra 25 til 90 kcal per stykk mellom
 * kall, og et logget måltid som endrer seg fra dag til dag er verdiløst i en
 * ukesserie.
 *
 * Selve tolkningen av svaret bor i `$lib/domain/nutrition/estimate`
 * (`parseEstimateResponse`) og er testet der — denne fila er kallet og prompten.
 */

const MODEL = 'gpt-4o';

const RESPONSE_SHAPE = `{
  "label": "kort norsk beskrivelse av måltidet",
  "items": [
    {
      "name": "varenavn på norsk",
      "quantity": tall_eller_null,
      "unit": "enhet som stykk/skive/dl/porsjon/100 g, eller null",
      "referenceKey": "nøkkel fra referansetabellen, eller null hvis varen ikke står der",
      "macros": { "kcal": tall, "proteinG": tall, "carbsG": tall, "fatG": tall }
    }
  ],
  "confidence": 0.0_til_1.0,
  "needsQuantity": true_hvis_du_måtte_gjette_mengde,
  "question": "ett konkret spørsmål som ville fjernet gjetningen, ellers null",
  "notes": "kort merknad om usikkerhet, eller null"
}`;

function systemPrompt(): string {
	return `Du er en ernæringsestimator for en norsk bruker. Du gjør om et beskrevet eller fotografert måltid til makroer.

REFERANSETABELL — bruk disse tallene framfor egne når en vare matcher.
Verdiene er per naturlig enhet (ett stykk, én skive, én dl), ikke per 100 g.
Format: nøkkel | navn | enhet | makroer

${referenceTableForPrompt()}

REGLER
1. Står varen i tabellen: bruk tabellens tall, ganget med antall enheter, og sett referenceKey.
2. Står den ikke der: anslå selv, sett referenceKey til null, og senk confidence.
3. «macros» skal være for HELE mengden brukeren oppgir, ikke per enhet.
   To knekkebrød = 2 × tabellverdien.
4. Del måltidet i varer brukeren kjenner igjen og kan rette på. «Knekkebrød med egg»
   blir to varer, ikke én.
5. Antar brukeren noe implisitt, ta det med: en brødskive spises normalt med smør
   bare hvis brukeren sier det. Ikke legg til det som ikke er nevnt.
6. Mangler mengde, gjett det mest sannsynlige, sett needsQuantity=true og still ETT
   konkret spørsmål i «question» — f.eks. «Hvor mange knekkebrød?». Ikke still
   spørsmål når mengden er oppgitt.
7. confidence: 0,8–0,95 når alt står i tabellen med oppgitt mengde. 0,4–0,6 når du
   gjetter mengde eller vare. Under 0,4 når du er reelt usikker.
8. Svar KUN med gyldig JSON i denne formen:

${RESPONSE_SHAPE}`;
}

/** Det modellen skal vite om et tidligere estimat når brukeren utfyller. */
function priorEstimateBlock(prior: NutritionEstimate): string {
	const items = prior.items.map((item) => `- ${describeItem(item)} (${item.macros.kcal} kcal)`).join('\n');
	return `TIDLIGERE ESTIMAT for samme måltid:
${prior.label}
${items || '(ingen varer)'}
Totalt: ${prior.totals.kcal} kcal, ${prior.totals.proteinG} g protein
${prior.question ? `Du spurte: ${prior.question}` : ''}

Brukeren utfyller nå. Lag et NYTT komplett estimat for hele måltidet — ikke bare
tillegget — og bruk opplysningen til å fjerne gjetningen.`;
}

export interface EstimateIntakeInput {
	/** Fritekst fra brukeren, f.eks. «to knekkebrød med egg». */
	text?: string | null;
	/** Cloudinary-URL fra /api/upload-image. */
	imageUrl?: string | null;
	/** Forrige estimat, når brukeren beskriver mengde i en ny runde. */
	prior?: NutritionEstimate | null;
}

function resolveSource(input: EstimateIntakeInput): EstimateSource {
	if (input.imageUrl && input.text?.trim()) return 'vision+text';
	if (input.imageUrl) return 'vision';
	return 'text';
}

/**
 * Bildet sendes med `detail: 'low'`. En matrett trenger ikke høyoppløst analyse
 * for et porsjonsanslag, og 'high' koster mange ganger mer per kall.
 */
function buildUserContent(input: EstimateIntakeInput) {
	const parts: Array<
		{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail: 'low' } }
	> = [];

	if (input.imageUrl) {
		parts.push({ type: 'image_url', image_url: { url: input.imageUrl, detail: 'low' } });
	}

	const lines: string[] = [];
	if (input.prior) lines.push(priorEstimateBlock(input.prior));
	if (input.imageUrl) {
		lines.push(
			input.text?.trim()
				? `Måltidet på bildet. Brukeren beskriver det slik: «${input.text.trim()}»`
				: 'Måltidet på bildet. Brukeren har ikke beskrevet mengde — anslå porsjonen og spør om den.'
		);
	} else if (input.text?.trim()) {
		lines.push(`Måltidet brukeren beskriver: «${input.text.trim()}»`);
	}

	parts.push({ type: 'text', text: lines.join('\n\n') });
	return parts;
}

export class NutritionEstimateError extends Error {}

/**
 * Kaller modellen og returnerer et estimat.
 *
 * Kaster `NutritionEstimateError` når svaret ikke er tolkbar JSON. Kallstedet
 * skal vise den meldingen — et stille tomt estimat ville sett ut som «måltidet
 * hadde ingen kalorier».
 */
export async function estimateIntake(input: EstimateIntakeInput): Promise<NutritionEstimate> {
	if (!input.text?.trim() && !input.imageUrl) {
		throw new NutritionEstimateError('Beskriv måltidet eller legg ved et bilde.');
	}

	const response = await openai.chat.completions.create({
		model: MODEL,
		messages: [
			{ role: 'system', content: systemPrompt() },
			{ role: 'user', content: buildUserContent(input) }
		],
		// json_object gir gyldig JSON uten markdown-gjerder rundt.
		response_format: { type: 'json_object' },
		temperature: 0.2,
		max_tokens: 900
	});

	const raw = response.choices[0]?.message?.content?.trim() ?? '';
	if (!raw) throw new NutritionEstimateError('Modellen svarte ikke. Prøv igjen.');

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new NutritionEstimateError('Klarte ikke tolke estimatet fra modellen.');
	}

	return parseEstimateResponse(parsed, resolveSource(input));
}
