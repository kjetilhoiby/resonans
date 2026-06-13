/**
 * Årets bilder — bilder lastet opp i selvangivelsen.
 *
 * Lagres som egen refleksjon (kind 'birthday_photos', periodKey = årstall)
 * med content = JSON-array. Passer ikke inn i intervjuets markdown-kontrakt,
 * derfor en søsken-refleksjon (samme mønster som birthday_interview_chat).
 */

export interface BirthdayPhoto {
	url: string;
	publicId: string;
	caption: string;
}

const MAX_PHOTOS = 6;

/** Serialiser til JSON for lagring — dropper bilder uten url, trimmer bildetekst, maks 6 */
export function serializeBirthdayPhotos(photos: BirthdayPhoto[]): string {
	const clean = photos
		.filter((p): p is BirthdayPhoto => !!p && typeof p.url === 'string' && p.url.trim().length > 0)
		.slice(0, MAX_PHOTOS)
		.map((p) => ({
			url: p.url.trim(),
			publicId: typeof p.publicId === 'string' ? p.publicId : '',
			caption: typeof p.caption === 'string' ? p.caption.trim() : ''
		}));
	return JSON.stringify(clean);
}

/** Parse lagret JSON tilbake til bilder. Tom liste ved søppel, manglende url eller feil form. */
export function parseBirthdayPhotos(content: string | null | undefined): BirthdayPhoto[] {
	if (!content) return [];
	try {
		const parsed = JSON.parse(content);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(p): p is { url: string; publicId?: unknown; caption?: unknown } =>
					!!p && typeof (p as { url?: unknown }).url === 'string' && (p as { url: string }).url.trim().length > 0
			)
			.slice(0, MAX_PHOTOS)
			.map((p) => ({
				url: p.url.trim(),
				publicId: typeof p.publicId === 'string' ? p.publicId : '',
				caption: typeof p.caption === 'string' ? p.caption : ''
			}));
	} catch {
		return [];
	}
}
