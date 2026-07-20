/**
 * find-triage.ts — «hva er dette»-triage for lagrede lenker/reels.
 *
 * Brukeren sender en Instagram-reel (eller annen lenke) til seg selv på
 * e-post, gjerne med caption limt inn. Processoren:
 *   1. finner lenka i e-posten og henter OpenGraph-meta (tittel/beskrivelse/bilde),
 *   2. lar GPT klassifisere hva funnet er (tema + type + kort sammendrag),
 *   3. promoterer oppskrifter til mat-temaet (meals) via importRecipeFromText,
 *   4. lander funnet i «Funn»-innboksen (finds) for triage.
 */

import { openai } from '$lib/server/openai';
import { db } from '$lib/db';
import { finds, type emailRules } from '$lib/db/schema';
import { stripHtml, type InboundEmailPayload } from './shared';
import { extractFirstUrl, fetchLinkPreview, type LinkPreview } from '$lib/server/web/og-tags';
import { importRecipeFromText } from '$lib/server/services/recipe-import-service';

type EmailRule = typeof emailRules.$inferSelect;

/** Temaer et funn kan klassifiseres til (DomainType-nøkler + 'annet'). */
export const FIND_THEMES = ['food', 'home', 'health', 'family', 'self', 'jobb', 'economics', 'annet'] as const;
export type FindTheme = (typeof FIND_THEMES)[number];

export interface TriageResult {
	title: string;
	summary: string | null;
	theme: FindTheme;
	kind: string | null;
	isRecipe: boolean;
}

const TRIAGE_SYSTEM_PROMPT = `Du er en triage-assistent for «funn» — lenker og reels en person har lagret fordi de virket nyttige (oppskrifter, snekker-teknikker, treningstips, inspirasjon osv.). Du får e-postens emne/tekst og metadata hentet fra lenka. Finn ut HVA dette er.

Returner KUN gyldig JSON:
{
  "title": "kort, beskrivende tittel på norsk",
  "summary": "1-3 setninger: hva dette er / hva man lærer / kort essens",
  "theme": "food|home|health|family|self|jobb|economics|annet",
  "kind": "oppskrift|teknikk|tips|trening|inspirasjon|annet",
  "isRecipe": true
}

theme-guide: mat/oppskrift/drikke → food; snekring/oppussing/hage/husarbeid/reparasjon → home; trening/kosthold/søvn/helse → health; barn/samliv/relasjoner → family; refleksjon/mental/identitet → self; jobb/produktivitet/karriere → jobb; penger/sparing/økonomi → economics; ellers → annet.
isRecipe: true KUN når innholdet faktisk er en matoppskrift (ingredienser + fremgangsmåte). En video om snekring er ikke en oppskrift.`;

/** Bygg brukermeldingen til triagen fra e-post + lenke-preview. Ren funksjon. */
export function buildTriageContent(payload: InboundEmailPayload, preview: LinkPreview | null): string {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	return [
		`Emne: ${payload.Subject ?? '(ingen)'}`,
		preview?.siteName ? `Kilde: ${preview.siteName}` : '',
		preview?.title ? `Lenke-tittel: ${preview.title}` : '',
		preview?.description ? `Lenke-beskrivelse: ${preview.description}` : '',
		'',
		body ? `E-posttekst:\n${body.slice(0, 6000)}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

/** Tolk og normaliser triage-JSON. Klemmer tema til gyldig verdi. Ren funksjon. */
export function parseTriageResult(raw: string): TriageResult {
	let obj: Record<string, unknown> = {};
	try {
		obj = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		obj = {};
	}

	const themeRaw = typeof obj.theme === 'string' ? obj.theme.toLowerCase().trim() : '';
	const theme: FindTheme = (FIND_THEMES as readonly string[]).includes(themeRaw)
		? (themeRaw as FindTheme)
		: 'annet';

	const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : '';
	const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : null;
	const kind = typeof obj.kind === 'string' && obj.kind.trim() ? obj.kind.trim().toLowerCase() : null;
	const isRecipe = obj.isRecipe === true || obj.isRecipe === 'true';

	return { title, summary, theme, kind, isRecipe };
}

export async function processFindTriageEmail(
	userId: string,
	payload: InboundEmailPayload,
	_rule: EmailRule
) {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const url = extractFirstUrl(body) ?? extractFirstUrl(payload.Subject);
	const preview = url ? await fetchLinkPreview(url) : null;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: TRIAGE_SYSTEM_PROMPT },
			{ role: 'user', content: buildTriageContent(payload, preview) }
		],
		response_format: { type: 'json_object' },
		temperature: 0.2,
		max_tokens: 600
	});

	const triage = parseTriageResult(completion.choices[0]?.message?.content ?? '{}');

	// Tekst tilgjengelig for oppskrifts-uttrekk: caption + OG-beskrivelse + emne.
	const captionText = [preview?.title, preview?.description, body]
		.filter(Boolean)
		.join('\n\n')
		.trim();

	let mealId: string | null = null;
	let theme: FindTheme = triage.theme;
	const extracted: Record<string, unknown> = {};
	if (triage.kind) extracted.kind = triage.kind;

	if (triage.isRecipe && captionText) {
		try {
			const recipe = await importRecipeFromText(userId, {
				text: captionText,
				sourceUrl: url ?? undefined,
				imageUrl: preview?.image ?? undefined
			});
			if (recipe.ok) {
				mealId = recipe.meal.id;
				theme = 'food';
				extracted.promotedMealId = recipe.meal.id;
			} else {
				extracted.recipePromotion = { failed: true, reason: recipe.error };
			}
		} catch (err) {
			extracted.recipePromotion = { failed: true, reason: String(err) };
		}
	}

	const title = triage.title || preview?.title || payload.Subject || 'Funn';

	const [row] = await db
		.insert(finds)
		.values({
			userId,
			title: title.slice(0, 300),
			summary: triage.summary,
			theme,
			kind: triage.kind,
			sourceUrl: url ?? null,
			thumbnailUrl: preview?.image ?? null,
			rawText: captionText ? captionText.slice(0, 5000) : null,
			extracted: Object.keys(extracted).length ? extracted : null,
			status: 'inbox',
			mealId,
			emailFrom: payload.From ?? null,
			emailSubject: payload.Subject ?? null
		})
		.returning();

	return { success: true, findId: row?.id, theme, promotedMealId: mealId };
}
