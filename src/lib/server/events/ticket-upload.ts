/**
 * Opplasting og visning av billettbilder.
 *
 * Egen vei forbi `uploadAndExtractAttachment` for BILDER, og grunnen er målt:
 * den generiske veien skalerer til 1600 px på lengste kant, som gjør et høyt
 * skjermbilde av en billettside til ~312×1600. Strekkoden blir uleselig i døra,
 * og den lille teksten blir grøt for modellen — 17. september 2026 leste den
 * ordrenummeret `163166254` som `151165243` fra et slikt bilde.
 *
 * Her lagres originalen urørt, og hver visning er et utsnitt utledet via
 * Cloudinary-URL. PDF går fortsatt gjennom den generiske veien: der er det
 * teksten vi er ute etter, og den skaleres ikke.
 */

import { v2 as cloudinary } from 'cloudinary';
import { env } from '$env/dynamic/private';
import type { EventTicketFile } from '$lib/db/schema';
import type { ImageRegion } from '$lib/domain/events/ticket-image';

cloudinary.config({
	cloud_name: env.CLOUDINARY_CLOUD_NAME,
	api_key: env.CLOUDINARY_API_KEY,
	api_secret: env.CLOUDINARY_API_SECRET
});

export interface UploadedTicketImage {
	ticket: EventTicketFile;
	width: number;
	height: number;
}

/**
 * Last opp et billettbilde i full oppløsning.
 *
 * Ingen `transformation` i det hele tatt: det som ligger i Cloudinary er nøyaktig
 * fila brukeren valgte. `quality`/`fetch_format` hører hjemme på LESINGEN av
 * bildet (URL-ene under), ikke på lagringen — en komprimering vi gjør ved
 * opplasting kan ikke angres.
 */
export async function uploadTicketImage(file: File): Promise<UploadedTicketImage> {
	const buffer = Buffer.from(await file.arrayBuffer());
	const dataUri = `data:${file.type || 'image/jpeg'};base64,${buffer.toString('base64')}`;

	const uploaded = await cloudinary.uploader.upload(dataUri, {
		folder: 'resonans/billetter',
		resource_type: 'image',
		use_filename: true,
		unique_filename: true
	});

	return {
		ticket: {
			url: uploaded.secure_url,
			publicId: uploaded.public_id,
			kind: 'image',
			name: file.name,
			mimeType: file.type,
			addedAt: new Date().toISOString(),
			region: null,
			label: null
		},
		width: uploaded.width ?? 0,
		height: uploaded.height ?? 0
	};
}

/**
 * URL til et utsnitt, skalert til `maxWidth`.
 *
 * Rekkefølgen er ikke likegyldig: beskjær FØRST (mot originalens mål), skaler
 * etterpå. Motsatt vei ville utsnittet blitt regnet mot et bilde som alt var
 * krympet, og andelene ville pekt et annet sted.
 */
export function ticketViewUrl(
	publicId: string,
	options: { region?: ImageRegion | null; maxWidth?: number; quality?: string } = {}
): string {
	const { region, maxWidth, quality = 'auto:good' } = options;

	const transformation: Record<string, unknown>[] = [];
	if (region && region.height < 1) {
		// Desimalverdier tolkes av Cloudinary som andeler av originalen, så
		// utsnittet er uavhengig av pikselmålene — som vi ikke alltid har.
		transformation.push({ crop: 'crop', width: 1.0, height: region.height, y: region.top, x: 0 });
	}
	if (maxWidth) transformation.push({ width: maxWidth, crop: 'limit' });
	transformation.push({ quality, fetch_format: 'auto' });

	return cloudinary.url(publicId, { secure: true, resource_type: 'image', transformation });
}

/** Lita utgave til lista. Her er komprimering riktig — dette er ikke arkivet. */
export function ticketThumbUrl(ticket: EventTicketFile): string {
	if (ticket.kind !== 'image' || !ticket.publicId) return ticket.url;
	return ticketViewUrl(ticket.publicId, { region: ticket.region, maxWidth: 300, quality: 'auto:eco' });
}

/**
 * Utgaven man åpner for å vise i døra.
 *
 * Ingen breddegrense når bildet ikke er beskåret — da ER originalen svaret, og
 * en «visningsvennlig» nedskalering er nøyaktig feilen denne modulen finnes for.
 * Et utsnitt får et tak, siden det uansett er regnet om.
 */
export function ticketFullUrl(ticket: EventTicketFile): string {
	if (ticket.kind !== 'image' || !ticket.publicId) return ticket.url;
	if (!ticket.region) return ticket.url;
	return ticketViewUrl(ticket.publicId, { region: ticket.region, maxWidth: 2000, quality: 'auto:best' });
}

/**
 * URL-ene modellen skal lese.
 *
 * `maxWidth` 1400 er valgt mot OpenAI-visions flislegging: bildet deles i
 * 512-ruter, og over ~1500 px kastes det bort detalj uten at noe blir mer
 * lesbart. `auto:best` fordi komprimeringsartefakter er nettopp det som gjør
 * sifre til andre sifre.
 */
export function ticketSliceUrls(publicId: string, slices: ImageRegion[]): string[] {
	return slices.map((region) =>
		ticketViewUrl(publicId, { region, maxWidth: 1400, quality: 'auto:best' })
	);
}
