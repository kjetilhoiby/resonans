/**
 * Én inngang: tekst, bilder og filer gjennom samme ark, og coachen sorterer etterpå.
 * Se `docs/changelog/2026-10-05-en-inngang.md`.
 *
 * Inngangen KOMMER I TILLEGG til kamera-, lyd- og filflytene på hjemskjermen. De
 * ber brukeren velge type først og tar ett vedlegg; her kommer innholdet først,
 * og flere bilder kan høre til samme ting. «Sprang meg en tur» med tre
 * skjermbilder fra Strava, Ekko og klokka var hvordan brukeren limte inn i
 * ChatGPT — det skal kunne gjøres her uten tre runder.
 */

/** Øvre grense per fangst. Flere bilder i ett modellkall koster tid og tokens. */
export const MAX_CAPTURE_ITEMS = 6;

export type CaptureItemKind = 'image' | 'document' | 'audio' | 'video' | 'other';

/** Det filvelgeren tar imot. Bilder og PDF dekker det brukeren limte inn i ChatGPT. */
export const CAPTURE_ACCEPT = 'image/*,application/pdf,.pdf,.txt,.csv';

export function captureItemKind(file: { type?: string | null; name?: string | null }): CaptureItemKind {
	const type = (file.type ?? '').toLowerCase();
	const name = (file.name ?? '').toLowerCase();
	if (type.startsWith('image/') || /\.(png|jpe?g|heic|heif|webp|gif)$/.test(name)) return 'image';
	if (type.startsWith('video/')) return 'video';
	if (type.startsWith('audio/')) return 'audio';
	if (type === 'application/pdf' || /\.(pdf|txt|csv)$/.test(name) || type.startsWith('text/')) return 'document';
	return 'other';
}

/**
 * Hvor mange nye filer som får plass. Resten avvises med ord framfor å kappes
 * stille — et bilde som forsvant uten beskjed ser ut som et bilde coachen så.
 */
export function fitCaptureItems<T>(current: number, incoming: T[]): { accepted: T[]; rejected: number } {
	const room = Math.max(0, MAX_CAPTURE_ITEMS - current);
	return { accepted: incoming.slice(0, room), rejected: Math.max(0, incoming.length - room) };
}

/** Teksten i brukerboblen. Uten tekst sier den hva som ble lagt inn. */
export function captureDisplayText(text: string, kinds: CaptureItemKind[]): string {
	const trimmed = text.trim();
	if (trimmed) return trimmed;
	const images = kinds.filter((k) => k === 'image').length;
	const others = kinds.length - images;
	const parts: string[] = [];
	if (images > 0) parts.push(images === 1 ? '📷 Bilde' : `📷 ${images} bilder`);
	if (others > 0) parts.push(others === 1 ? '📄 Fil' : `📄 ${others} filer`);
	return parts.join(' · ');
}

/**
 * Instruksen som følger en fangst til modellen.
 *
 * Den sier HVA som skal skje (finn ut hva det er, lagre det med riktig verktøy,
 * bekreft kort), ikke HVORDAN hvert tilfelle ser ut — verktøybeskrivelsene eier
 * det. «Spør ett spørsmål framfor å gjette» står fordi en gjettet registrering
 * er verre enn ingen: et måltid lagret som en økt blir ikke oppdaget.
 * Ingen backticks: den limes inn i en prompt.
 */
export const CAPTURE_INSTRUCTION =
	'[System: Dette kom inn gjennom Én inngang, der brukeren legger inn noe uten å si hva det er. ' +
	'Finn ut hva det er — et måltid, en treningsøkt, sult, et symptom, skjermtid, en billett, et dokument, ' +
	'en tanke eller en oppgave — og lagre det med riktig verktøy. Flere bilder hører som regel til samme ting ' +
	'(for eksempel samme tur fra flere apper): registrer det én gang. Ligger tallene alt i brukerens data ' +
	'(en økt fra klokka eller Strava), ikke registrer dem på nytt — si at du ser den, og svar på det brukeren skrev. ' +
	'Bekreft kort hva du lagret. Er det uklart hva brukeren vil, still ETT spørsmål framfor å gjette.]';

/** Rutene som har sitt eget chatfelt nederst, der en flytende knapp ville ligget oppå det. */
const OWN_INPUT_PREFIXES = ['/samtaler', '/tema/', '/aktivitet/', '/economics/lonnsmaned', '/skriv'];
/** Rutene inngangen ikke hører på i det hele tatt: galleriet, innlogging og delte lenker. */
const NO_CAPTURE_PREFIXES = [
	'/design',
	'/design-exploration',
	'/animation-exploration',
	'/auth',
	'/signin',
	'/signout',
	'/share/',
	'/partner-invite',
	'/live'
];

/**
 * Om den flytende inngangsknappen vises på en side. Hjemskjermen har sin egen
 * knapp i toppraden, og sider med et chatfelt nederst har allerede en inngang
 * der knappen ville ligget.
 */
export function showFloatingCapture(pathname: string): boolean {
	if (pathname === '/' || pathname === '') return false;
	const matches = (prefix: string) =>
		prefix.endsWith('/') ? pathname.startsWith(prefix) : pathname === prefix || pathname.startsWith(`${prefix}/`);
	return !OWN_INPUT_PREFIXES.some(matches) && !NO_CAPTURE_PREFIXES.some(matches);
}

/** Hvor mange vedlegg serveren godtar fra én forespørsel, og hvilke. */
export function pickCaptureAttachments<T extends { url: string }>(
	primary: T | null,
	extra: unknown,
	isValid: (value: unknown) => value is T
): T[] {
	const list: T[] = primary ? [primary] : [];
	if (Array.isArray(extra)) {
		for (const item of extra) {
			if (list.length >= MAX_CAPTURE_ITEMS) break;
			if (isValid(item) && /^https?:\/\//i.test(item.url) && !list.some((a) => a.url === item.url)) {
				list.push(item);
			}
		}
	}
	return list;
}

/**
 * Bildeadressene i en vedleggsliste, når det er FLERE. Ett bilde bor allerede i
 * `imageUrl`, og en liste på ett ville bare tegnet det samme bildet to ganger.
 */
export function captureImageUrls(attachments: unknown): string[] | null {
	if (!Array.isArray(attachments)) return null;
	const urls = attachments
		.filter(
			(a): a is { kind: string; url: string } =>
				!!a && typeof a === 'object' && (a as { kind?: unknown }).kind === 'image' && typeof (a as { url?: unknown }).url === 'string'
		)
		.map((a) => a.url);
	return urls.length > 1 ? urls : null;
}
