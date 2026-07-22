/**
 * find-triage.ts — «hva er dette»-triage for lagrede lenker/reels.
 *
 * Brukeren sender en lenke (Instagram-reel, YouTube-short, blogg, nettbutikk
 * osv.) til seg selv på e-post, gjerne med et hint om hva det er. Processoren:
 *   1. finner lenka + et eventuelt «Hint: …» i e-posten,
 *   2. henter OpenGraph-meta (tittel/beskrivelse/bilde) fra lenka,
 *   3. lar GPT klassifisere hva funnet er (domene + type + kort sammendrag),
 *      med hintet vektet tungt,
 *   4. promoterer oppskrifter til mat-temaet (meals) — hele siden hentes for
 *      fetchbare sider (blogg/nettbutikk), caption brukes for murte IG/YT-lenker,
 *   5. lander funnet i «Funn»-innboksen (finds) for triage.
 */

import { openai } from '$lib/server/openai';
import { db } from '$lib/db';
import { finds, type emailRules } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { stripHtml, type InboundEmailPayload } from './shared';
import { extractFirstUrl, fetchLinkPreview, type LinkPreview } from '$lib/server/web/og-tags';
import { importRecipeFromText, importRecipeFromUrl } from '$lib/server/services/recipe-import-service';

type EmailRule = typeof emailRules.$inferSelect;

/** Domener et funn kan klassifiseres til (DomainType-nøkler + 'annet'). */
export const FIND_DOMAINS = ['food', 'home', 'health', 'family', 'self', 'jobb', 'economics', 'annet'] as const;
export type FindDomain = (typeof FIND_DOMAINS)[number];

export interface TriageResult {
	title: string;
	summary: string | null;
	domain: FindDomain;
	kind: string | null;
	isRecipe: boolean;
}

const TRIAGE_SYSTEM_PROMPT = `Du er en triage-assistent for «funn» — lenker en person har lagret fordi de virket nyttige (oppskrifter, snekker-teknikker, treningstips, produkter, artikler, inspirasjon osv.). Lenka kan være en Instagram-reel, en YouTube-video, et blogginnlegg eller en nettbutikk-side. Du får e-postens emne/tekst, et eventuelt hint fra brukeren, og metadata hentet fra lenka. Finn ut HVA dette er.

Returner KUN gyldig JSON:
{
  "title": "kort, beskrivende tittel på norsk",
  "summary": "1-3 setninger: hva dette er / hva man lærer / kort essens",
  "domain": "food|home|health|family|self|jobb|economics|annet",
  "kind": "oppskrift|teknikk|tips|trening|produkt|artikkel|inspirasjon|annet",
  "isRecipe": true
}

domain-guide: mat/oppskrift/drikke → food; snekring/oppussing/hage/husarbeid/reparasjon/møbler → home; trening/kosthold/søvn/helse → health; barn/samliv/relasjoner → family; refleksjon/mental/identitet → self; jobb/produktivitet/karriere → jobb; penger/sparing/økonomi → economics; ellers → annet.
Hvis brukeren har skrevet et HINT, vekt det tungt — det er brukerens egen intensjon. Bruk det til å avgjøre domene, og gjerne som tittel (f.eks. hint «underskap til seng» → tittel «Underskap til seng», domain «home»).
isRecipe: true KUN når innholdet faktisk er en matoppskrift (ingredienser + fremgangsmåte). En video om snekring er ikke en oppskrift.`;

/** Trekk ut et eksplisitt «Hint: …»/«Hint - …» fra e-postteksten. Ren funksjon. */
export function extractHint(payload: InboundEmailPayload): string | null {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const m = body.match(/^\s*hint\s*[:\-–]\s*(.+)$/im);
	return m ? m[1].trim().slice(0, 200) : null;
}

/** Bygg brukermeldingen til triagen fra e-post + lenke-preview + hint. Ren funksjon. */
export function buildTriageContent(
	payload: InboundEmailPayload,
	preview: LinkPreview | null,
	hint: string | null = null
): string {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	return [
		hint ? `BRUKERENS HINT (vekt tungt): ${hint}` : '',
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

/** Tolk og normaliser triage-JSON. Klemmer domene til gyldig verdi. Ren funksjon. */
export function parseTriageResult(raw: string): TriageResult {
	let obj: Record<string, unknown> = {};
	try {
		obj = JSON.parse(raw) as Record<string, unknown>;
	} catch {
		obj = {};
	}

	const domainRaw = typeof obj.domain === 'string' ? obj.domain.toLowerCase().trim() : '';
	const domain: FindDomain = (FIND_DOMAINS as readonly string[]).includes(domainRaw)
		? (domainRaw as FindDomain)
		: 'annet';

	const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : '';
	const summary = typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : null;
	const kind = typeof obj.kind === 'string' && obj.kind.trim() ? obj.kind.trim().toLowerCase() : null;
	const isRecipe = obj.isRecipe === true || obj.isRecipe === 'true';

	return { title, summary, domain, kind, isRecipe };
}

/** IG/YT-sider er murt bak innlogging — der har vi bare caption/OG, ikke sideinnhold. */
export function isWalledMediaUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	return /instagram\.com|youtube\.com|youtu\.be/i.test(url);
}

export async function processFindTriageEmail(
	userId: string,
	payload: InboundEmailPayload,
	_rule: EmailRule
) {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const url = extractFirstUrl(body) ?? extractFirstUrl(payload.Subject);
	const hint = extractHint(payload);

	// Dedup: samme lenke sendt på nytt skal ikke lage et nytt funn.
	if (url) {
		const existing = await db.query.finds.findFirst({
			where: and(eq(finds.userId, userId), eq(finds.sourceUrl, url))
		});
		if (existing) {
			return { success: true, findId: existing.id, deduped: true, domain: existing.domain };
		}
	}

	const preview = url ? await fetchLinkPreview(url) : null;

	const completion = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: TRIAGE_SYSTEM_PROMPT },
			{ role: 'user', content: buildTriageContent(payload, preview, hint) }
		],
		response_format: { type: 'json_object' },
		temperature: 0.2,
		max_tokens: 600
	});

	const triage = parseTriageResult(completion.choices[0]?.message?.content ?? '{}');

	// Tekst tilgjengelig for oppskrifts-uttrekk fra murte medier: caption + OG + emne.
	const captionText = [preview?.title, preview?.description, body]
		.filter(Boolean)
		.join('\n\n')
		.trim();

	let mealId: string | null = null;
	let domain: FindDomain = triage.domain;
	const extracted: Record<string, unknown> = {};
	if (triage.kind) extracted.kind = triage.kind;
	if (hint) extracted.hint = hint;

	if (triage.isRecipe) {
		try {
			let recipe = null;
			if (url && !isWalledMediaUrl(url)) {
				// Fetchbar side (blogg/nettbutikk/artikkel) → hent hele oppskriften (JSON-LD).
				recipe = await importRecipeFromUrl(userId, url);
				// Faller tilbake til caption/OG-tekst hvis sidehenting ikke ga oppskrift.
				if (!recipe.ok && captionText) {
					recipe = await importRecipeFromText(userId, {
						text: captionText,
						sourceUrl: url,
						imageUrl: preview?.image ?? undefined
					});
				}
			} else if (captionText) {
				// Murt IG/YT-lenke → bruk caption/OG-teksten vi klarte å hente.
				recipe = await importRecipeFromText(userId, {
					text: captionText,
					sourceUrl: url ?? undefined,
					imageUrl: preview?.image ?? undefined
				});
			}

			if (recipe?.ok) {
				mealId = recipe.meal.id;
				domain = 'food';
				extracted.promotedMealId = recipe.meal.id;
			} else if (recipe) {
				extracted.recipePromotion = { failed: true, reason: recipe.error };
			}
		} catch (err) {
			extracted.recipePromotion = { failed: true, reason: String(err) };
		}
	}

	const title = triage.title || hint || preview?.title || payload.Subject || 'Funn';

	const [row] = await db
		.insert(finds)
		.values({
			userId,
			title: title.slice(0, 300),
			summary: triage.summary,
			domain,
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

	return { success: true, findId: row?.id, domain, promotedMealId: mealId };
}
