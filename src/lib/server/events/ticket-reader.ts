/**
 * Les en billett — skjermbilde eller PDF — til et utkast av et arrangement.
 *
 * **Bilder går ikke gjennom `uploadAndExtractAttachment`.** Den skalerer til
 * 1600 px på lengste kant, og et høyt «hele siden»-skjermbilde blir da ~312×1600:
 * strekkoden uleselig, den lille teksten grøt. Målt 17. september 2026 leste
 * modellen ordrenummeret `163166254` som `151165243` fra et slikt bilde. Bilder
 * lastes derfor opp i full oppløsning (`ticket-upload.ts`) og leses i SNITT —
 * flere utsnitt i samme kall, hvert med nok piksler per tekstlinje.
 *
 * PDF går fortsatt den generiske veien: der er det teksten vi er ute etter, og
 * den skaleres ikke.
 *
 * Tolkningen av svaret bor i `$lib/domain/events/ticket-extraction.ts` og er ren
 * og testet. Her ligger bare kallet.
 */

import { openai } from '$lib/server/openai';
import {
	detectAttachmentKind,
	uploadAndExtractAttachment,
	type ExtractedAttachment
} from '$lib/server/attachment-extract';
import { buildTicketDraft, type TicketDraft } from '$lib/domain/events/ticket-extraction';
import {
	planTicketSlices,
	regionsFromModel,
	splitByRegions
} from '$lib/domain/events/ticket-image';
import { ticketSliceUrls, uploadTicketImage } from '$lib/server/events/ticket-upload';
import type { EventTicketFile } from '$lib/db/schema';

const SYSTEM_PROMPT = `Du leser billetter og bookingbekreftelser (konsert, teater, kino, kamp, forestilling).
Kilden er et skjermbilde, en PDF eller en e-post — ofte på norsk. Svar KUN med gyldig JSON.

{
  "title": "navnet på arrangementet slik det står (artist, forestilling, kamp)",
  "kind": "konsert" | "teater" | "kino" | "sport" | "annet",
  "eventDate": "datoen slik den står på billetten",
  "endDate": "sluttdato, BARE for arrangementer over flere dager (festival)",
  "startTime": "klokkeslettet arrangementet begynner",
  "doorsTime": "klokkeslettet dørene åpner, BARE hvis det står eksplisitt",
  "venue": "spillested / arena / scene",
  "address": "gateadresse hvis den står",
  "entrance": "inngang/port/gate slik det står, f.eks. «Inngang C»",
  "seat": "rad og sete / seksjon / ståplass",
  "ticketCount": antall billetter som tall,
  "bookingReference": "ordre-/bookingnummer",
  "notes": "annet som er verdt å huske (f.eks. «ta med legitimasjon»)",
  "confidence": "low" | "medium" | "high",
  "ticketRegions": [ { "topPct": 0-100, "bottomPct": 0-100 } ]
}

Regler:
- Utelat felter du ikke finner. IKKE gjett. Et tomt felt er riktigere enn et oppdiktet:
  brukeren ser på billetten uansett, men et utfylt felt blir trodd.
- Skriv datoen og klokkeslettet SLIK DE STÅR («fredag 14. november 2026», «kl. 19.30»).
  Normaliseringen skjer etterpå; konverterer du selv, mister vi muligheten til å
  se at årstallet manglet.
- LANGE SIFFERREKKER (ordrenummer, bookingreferanse) skal leses siffer for siffer.
  Er du ikke sikker på hvert eneste siffer, utelat feltet helt. Et ordrenummer med
  ett feil siffer er verre enn ikke noe ordrenummer: det ser riktig ut, og oppdages
  først i billettluka. Strekkodetall skal IKKE brukes som ordrenummer.
- «Dørene åpner» er bare et eget felt når det STÅR på billetten. Står det bare ett
  klokkeslett, er det starttidspunktet — ikke gjett deg til et dørtidspunkt.
- Billettpris, strekkode og kjøpsdato skal IKKE med — de hører ikke til arrangementet.

Om bildene:
- Får du FLERE bilder, er de vannrette SNITT av den SAMME siden, ovenfra og ned og
  med overlapp. Det er én billettside, ikke flere arrangementer. Les dem sammen.
- "ticketRegions": ligger det flere separate billetter under hverandre på siden
  (samme arrangement, én per person), oppgi hvor hver av dem ligger loddrett, som
  prosent av HELE sidens høyde — ikke av det enkelte snittet. Ta med hele
  billettblokka: navn, strekkode og QR-kode. Er det bare én billett, eller er du
  usikker på hvor de går, utelat feltet.`;

export interface TicketReadResult {
	attachment: ExtractedAttachment | null;
	/**
	 * Billettfilene. Flere enn én når siden inneholdt flere billetter under
	 * hverandre: alle peker på samme opplasting, med hvert sitt utsnitt.
	 */
	tickets: EventTicketFile[];
	draft: TicketDraft;
	raw: Record<string, unknown> | null;
}

export function toTicketFile(attachment: ExtractedAttachment): EventTicketFile {
	return {
		url: attachment.url,
		publicId: attachment.publicId,
		kind: attachment.kind === 'image' ? 'image' : attachment.kind === 'document' ? 'document' : 'other',
		name: attachment.name,
		mimeType: attachment.mimeType,
		addedAt: new Date().toISOString(),
		region: null,
		label: null
	};
}

/**
 * Last opp billetten og les den.
 *
 * Feiler modellkallet, får brukeren likevel vedlegget tilbake med et tomt utkast
 * — bildet er lastet opp og skal ikke gå tapt fordi tolkningen glapp. Et
 * arrangement fylt ut for hånd med billetten vedlagt er fortsatt hele poenget.
 */
export async function readTicketFile(file: File, note = ''): Promise<TicketReadResult> {
	if (detectAttachmentKind(file) === 'image') return readTicketImage(file, note);

	const { attachment } = await uploadAndExtractAttachment(file, note, 'file');
	const raw = await askModelSafely({ text: attachment.contentText }, note);
	const draft = buildTicketDraft(raw ?? {});
	if (!raw) draft.warnings.unshift('Klarte ikke å lese billetten automatisk — fyll inn feltene selv.');

	return { attachment, tickets: [toTicketFile(attachment)], draft, raw };
}

async function readTicketImage(file: File, note: string): Promise<TicketReadResult> {
	const { ticket, width, height } = await uploadTicketImage(file);

	const slices = planTicketSlices(width, height);
	const urls = ticketSliceUrls(ticket.publicId, slices);

	const raw = await askModelSafely({ imageUrls: urls }, note);
	const draft = buildTicketDraft(raw ?? {});
	if (!raw) draft.warnings.unshift('Klarte ikke å lese billetten automatisk — fyll inn feltene selv.');

	const regions = regionsFromModel(raw?.ticketRegions);
	const tickets = splitByRegions(ticket, regions);
	if (tickets.length > 1) {
		draft.warnings.push(
			`Delte siden i ${tickets.length} billetter. Sjekk at utsnittene ble riktige — originalen er tatt vare på uansett.`
		);
	}

	return { attachment: null, tickets, draft, raw };
}

/**
 * Les en billett som alt er tekst (e-postbekreftelse limt inn).
 *
 * Ingen opplasting: det finnes ingen fil å ta vare på.
 */
export async function readTicketText(
	text: string
): Promise<{ draft: TicketDraft; raw: Record<string, unknown> | null }> {
	const raw = await askModelSafely({ text }, '');
	const draft = buildTicketDraft(raw ?? {});
	if (!raw) draft.warnings.unshift('Klarte ikke å lese teksten automatisk — fyll inn feltene selv.');
	return { draft, raw };
}

type ModelSource = { imageUrls: string[] } | { text: string };

async function askModelSafely(
	source: ModelSource,
	note: string
): Promise<Record<string, unknown> | null> {
	try {
		return await askModel(source, note);
	} catch (error) {
		console.error('[billett] lesing feilet:', error);
		return null;
	}
}

async function askModel(source: ModelSource, note: string): Promise<Record<string, unknown> | null> {
	const hint = note.trim() ? `\n\nBrukerens notat: ${note.trim()}` : '';

	let userContent: string | Array<Record<string, unknown>>;
	if ('imageUrls' in source) {
		if (source.imageUrls.length === 0) return null;
		const intro =
			source.imageUrls.length > 1
				? `Les denne billetten. Bildene er ${source.imageUrls.length} vannrette snitt av samme side, ovenfra og ned, med overlapp.${hint}`
				: `Les denne billetten.${hint}`;
		userContent = [
			{ type: 'text', text: intro },
			// `detail: 'high'` er poenget med hele oppdelingen: uten den nedskalerer
			// OpenAI bildet til lav oppløsning, og da er snittene bortkastet.
			...source.imageUrls.map((url) => ({
				type: 'image_url',
				image_url: { url, detail: 'high' }
			}))
		];
	} else {
		if (!source.text?.trim()) return null;
		userContent = `Les denne billetten.${hint}\n\n${source.text.slice(0, 12_000)}`;
	}

	const completion = await openai.chat.completions.create({
		// Vision krever gpt-4o; ren tekst klarer mini, og en billett er kort.
		model: 'imageUrls' in source ? 'gpt-4o' : 'gpt-4o-mini',
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: userContent as never }
		],
		temperature: 0,
		response_format: { type: 'json_object' },
		max_tokens: 900
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
