/**
 * Les en billett — skjermbilde eller PDF — til et utkast av et arrangement.
 *
 * Vedlegget går gjennom `uploadAndExtractAttachment`, som alt gjør de to tunge
 * jobbene: laster opp til Cloudinary (så billettbildet HAR en url å vise) og
 * trekker ut tekst av PDF/DOCX. Bilder får ingen tekst der (`extractionKind`
 * er `vision`), og de leses derfor av modellen mot Cloudinary-url-en.
 *
 * Tolkningen av svaret bor i `$lib/domain/events/ticket-extraction.ts` og er
 * ren og testet. Her ligger bare kallet.
 */

import { openai } from '$lib/server/openai';
import {
	detectAttachmentKind,
	uploadAndExtractAttachment,
	type ExtractedAttachment
} from '$lib/server/attachment-extract';
import { buildTicketDraft, type TicketDraft } from '$lib/domain/events/ticket-extraction';
import type { EventTicketFile } from '$lib/db/schema';

const SYSTEM_PROMPT = `Du leser billetter og bookingbekreftelser (konsert, teater, kino, kamp, forestilling).
Kilden er et skjermbilde, en PDF eller en e-post — ofte på norsk. Svar KUN med gyldig JSON.

{
  "title": "navnet på arrangementet slik det står (artist, forestilling, kamp)",
  "kind": "konsert" | "teater" | "kino" | "sport" | "annet",
  "eventDate": "datoen slik den står på billetten",
  "endDate": "sluttdato, BARE for arrangementer over flere dager (festival)",
  "startTime": "klokkeslettet arrangementet begynner",
  "doorsTime": "klokkeslettet dørene åpner, hvis det står separat",
  "venue": "spillested / arena / scene",
  "address": "gateadresse hvis den står",
  "entrance": "inngang/port/gate slik det står, f.eks. «Inngang C»",
  "seat": "rad og sete / seksjon / ståplass",
  "ticketCount": antall billetter som tall,
  "bookingReference": "ordre-/bookingnummer",
  "notes": "annet som er verdt å huske (f.eks. «ta med legitimasjon»)",
  "confidence": "low" | "medium" | "high"
}

Regler:
- Utelat felter du ikke finner. IKKE gjett. Et tomt felt er riktigere enn et oppdiktet:
  brukeren ser på billetten uansett, men et utfylt felt blir trodd.
- Skriv datoen og klokkeslettet SLIK DE STÅR («fredag 14. november 2026», «kl. 19.30»).
  Normaliseringen skjer etterpå; konverterer du selv, mister vi muligheten til å
  se at årstallet manglet.
- Står det både «Dørene åpner» og et starttidspunkt, er det to ulike felter.
- Billettpris, strekkode og kjøpsdato skal IKKE med — de hører ikke til arrangementet.
- confidence: "high" bare når du faktisk leser tydelig tekst, "low" når du tolker
  et uklart bilde.`;

export interface TicketReadResult {
	attachment: ExtractedAttachment;
	ticket: EventTicketFile;
	draft: TicketDraft;
	/** Modellens rå svar, lagret på arrangementet for etterprøving. */
	raw: Record<string, unknown> | null;
}

export function toTicketFile(attachment: ExtractedAttachment): EventTicketFile {
	return {
		url: attachment.url,
		publicId: attachment.publicId,
		kind: attachment.kind === 'image' ? 'image' : attachment.kind === 'document' ? 'document' : 'other',
		name: attachment.name,
		mimeType: attachment.mimeType,
		addedAt: new Date().toISOString()
	};
}

/**
 * Last opp billetten og les den.
 *
 * Feiler modellkallet, får brukeren likevel vedlegget tilbake med et tomt
 * utkast — bildet er lastet opp og skal ikke gå tapt fordi tolkningen glapp.
 * Et arrangement fylt ut for hånd med billetten vedlagt er fortsatt hele
 * poenget med funksjonen.
 */
export async function readTicketFile(file: File, note = ''): Promise<TicketReadResult> {
	const { attachment } = await uploadAndExtractAttachment(file, note, 'file');
	const kind = detectAttachmentKind(file);

	let raw: Record<string, unknown> | null = null;
	try {
		raw = await askModel(kind === 'image' ? { imageUrl: attachment.url } : { text: attachment.contentText }, note);
	} catch (error) {
		console.error('[billett] lesing feilet:', error);
	}

	const draft = buildTicketDraft(raw ?? {});
	if (!raw) {
		draft.warnings.unshift('Klarte ikke å lese billetten automatisk — fyll inn feltene selv.');
	}

	return { attachment, ticket: toTicketFile(attachment), draft, raw };
}

/**
 * Les en billett som alt er tekst (e-postbekreftelse limt inn).
 *
 * Ingen opplasting: det finnes ingen fil å ta vare på.
 */
export async function readTicketText(text: string): Promise<{ draft: TicketDraft; raw: Record<string, unknown> | null }> {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = await askModel({ text }, '');
	} catch (error) {
		console.error('[billett] lesing av tekst feilet:', error);
	}
	const draft = buildTicketDraft(raw ?? {});
	if (!raw) draft.warnings.unshift('Klarte ikke å lese teksten automatisk — fyll inn feltene selv.');
	return { draft, raw };
}

async function askModel(
	source: { imageUrl: string } | { text: string },
	note: string
): Promise<Record<string, unknown> | null> {
	const hint = note.trim() ? `\n\nBrukerens notat: ${note.trim()}` : '';

	const userContent =
		'imageUrl' in source
			? ([
					{ type: 'text' as const, text: `Les denne billetten.${hint}` },
					{ type: 'image_url' as const, image_url: { url: source.imageUrl } }
				])
			: `Les denne billetten.${hint}\n\n${(source.text ?? '').slice(0, 12_000)}`;

	if (!('imageUrl' in source) && !source.text?.trim()) return null;

	const completion = await openai.chat.completions.create({
		// Vision krever gpt-4o; ren tekst klarer mini, og en billett er kort.
		model: 'imageUrl' in source ? 'gpt-4o' : 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: userContent }
		],
		temperature: 0,
		response_format: { type: 'json_object' },
		max_tokens: 600
	});

	const content = completion.choices[0]?.message?.content;
	if (!content) return null;
	try {
		const parsed = JSON.parse(content);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}
