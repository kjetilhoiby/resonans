/**
 * Innkommende e-post fra Gmail (Apps Script → POST /api/email/inbound).
 *
 * Rene funksjoner: parsing av payloaden, adresseuttrekk og regelmatching.
 * Endepunktet gjør databasearbeidet; her bor det som kan testes uten base.
 *
 * ## Hvorfor endepunktet svarer med `service`
 *
 * Fram til november 2026 postet det installerte scriptet til
 * `resonans.vercel.app`, lenge etter at appen flyttet til
 * `resonans.apps.hoi.by`. Vercel-navnet ble tatt av noen andre, og scriptet
 * sendte e-postene og webhook-hemmeligheten dit hvert minutt i flere uker. Den
 * fremmede siden svarte 404, så labelen ble aldri fjernet og feilen var bare
 * synlig i Apps Scripts egen kjøringslogg.
 *
 * Script v2 gjør derfor en GET først og sender ingenting (verken innhold eller
 * hemmelighet) før svaret er JSON med `service === INBOUND_SERVICE`. Alle svar
 * fra endepunktet bærer feltet, så scriptet kan også skille et Resonans-svar fra
 * en tilfeldig side som svarer 200.
 */

export const INBOUND_SERVICE = 'resonans-email-inbound';

/**
 * Versjonen av Apps Script-malen i `apps-script-template.ts`. Øk den når malen
 * endres på en måte brukeren bør hente; innstillingene sier fra når scriptet
 * som poster er eldre. Script v1 sendte ikke versjon i det hele tatt.
 */
export const CURRENT_SCRIPT_VERSION = 2;

export interface InboundAttachment {
	Name: string;
	Content: string; // base64
	ContentType: string;
	ContentLength: number;
}

/** Felles form prosessorene i `email-processors/` leser. */
export interface InboundEmailPayload {
	UserEmail: string;
	To?: string;
	From: string;
	Subject?: string;
	TextBody?: string;
	HtmlBody?: string;
	Label?: string;
	Attachments?: InboundAttachment[];
	GmailMessageId?: string;
	GmailThreadId?: string;
	GmailDate?: string;
	ScriptVersion?: number;
	SkippedAttachments?: string[];
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

/**
 * Godtar både script v2 (camelCase) og den gamle Postmark-formen (PascalCase),
 * som `email-processors/` fortsatt leser.
 */
export function parseInboundPayload(raw: Record<string, unknown>): InboundEmailPayload {
	const attachmentsRaw = Array.isArray(raw.Attachments)
		? raw.Attachments
		: Array.isArray(raw.attachments)
			? raw.attachments
			: [];

	const internalDate = raw.GmailDate ?? raw.gmailDate ?? raw.internalDate;
	const version = Number(raw.scriptVersion ?? raw.ScriptVersion);

	return {
		UserEmail: str(raw.UserEmail) ?? str(raw.userEmail) ?? '',
		To: str(raw.To) ?? str(raw.to),
		From: str(raw.From) ?? str(raw.from) ?? '',
		Subject: str(raw.Subject) ?? str(raw.subject),
		TextBody: str(raw.TextBody) ?? str(raw.bodyText),
		HtmlBody: str(raw.HtmlBody) ?? str(raw.htmlBody),
		Label: str(raw.Label) ?? str(raw.label),
		GmailMessageId: str(raw.GmailMessageId) ?? str(raw.gmailMessageId),
		GmailThreadId: str(raw.GmailThreadId) ?? str(raw.gmailThreadId),
		GmailDate: internalDate !== undefined && internalDate !== null ? String(internalDate) : undefined,
		ScriptVersion: Number.isFinite(version) && version > 0 ? version : undefined,
		SkippedAttachments: Array.isArray(raw.skippedAttachments)
			? raw.skippedAttachments.filter((s): s is string => typeof s === 'string')
			: undefined,
		Attachments: (attachmentsRaw as Array<Record<string, unknown>>)
			.map((a) => ({
				Name: str(a.Name) ?? str(a.name) ?? '',
				Content: str(a.Content) ?? str(a.base64) ?? '',
				ContentType: str(a.ContentType) ?? str(a.contentType) ?? 'application/octet-stream',
				ContentLength: Number(a.ContentLength ?? a.size ?? 0) || 0
			}))
			.filter((a) => a.Name && a.Content)
	};
}

/**
 * Alle e-postadresser i et adressefelt, med små bokstaver.
 * `"Oda" <hei@oda.com>, kari@x.no` → ['hei@oda.com', 'kari@x.no'].
 */
export function extractAddresses(raw: string | undefined | null): string[] {
	if (!raw) return [];
	const matches = raw.toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/g);
	return matches ? [...new Set(matches)] : [];
}

/**
 * Hvem e-posten gjelder, i prioritert rekkefølge.
 *
 * `UserEmail` er kontoen scriptet kjører som (v2). Script v1 sendte bare `to`,
 * og det traff ikke når filteret går på et alias (`to:workout@hoi.by`) eller
 * e-posten er videresendt — da gjettet endepunktet tidligere på «første bruker
 * med regler». Den gjetningen er fjernet: en ukjent mottaker er en feil, ikke
 * en grunn til å legge e-posten hos noen.
 */
export function candidateUserEmails(payload: InboundEmailPayload): string[] {
	return [...new Set([...extractAddresses(payload.UserEmail), ...extractAddresses(payload.To)])];
}

/**
 * Glob-match uten regex: `*` først/sist betyr «slutter på»/«starter med»,
 * begge betyr «inneholder». Uten `*`: lik eller inneholder (bakoverkompatibelt
 * med reglene som allerede ligger i basen).
 */
export function matchesPattern(value: string, pattern: string): boolean {
	const p = pattern.trim().toLowerCase();
	if (!p) return true;
	const lower = value.toLowerCase();
	const starts = p.startsWith('*');
	const ends = p.endsWith('*') && p.length > 1;
	if (starts && ends) return lower.includes(p.slice(1, -1));
	if (starts) return lower.endsWith(p.slice(1));
	if (ends) return lower.startsWith(p.slice(0, -1));
	return lower === p || lower.includes(p);
}

/**
 * Avsendermønsteret sjekkes mot selve adressen og mot hele `From`-feltet.
 * `From` ser ut som `Oda <hei@oda.com>`, så `*@oda.com` (som skjemaet foreslår)
 * traff aldri når bare hele feltet ble sjekket — det slutter på `>`.
 */
export function matchesSender(from: string, pattern: string): boolean {
	if (matchesPattern(from, pattern)) return true;
	return extractAddresses(from).some((address) => matchesPattern(address, pattern));
}

export interface RuleLike {
	labelPattern: string | null;
	senderPattern: string | null;
	subjectPattern: string | null;
}

export interface MatchInput {
	label: string;
	from: string;
	subject: string;
}

/** En regel må ha minst ett mønster, og alle mønstrene den har må treffe. */
export function ruleMatches(rule: RuleLike, input: MatchInput): boolean {
	if (!rule.labelPattern && !rule.senderPattern && !rule.subjectPattern) return false;
	if (rule.labelPattern && !(input.label && matchesPattern(input.label, rule.labelPattern))) return false;
	if (rule.senderPattern && !matchesSender(input.from, rule.senderPattern)) return false;
	if (rule.subjectPattern && !matchesPattern(input.subject, rule.subjectPattern)) return false;
	return true;
}

export function hasWorkoutAttachments(payload: InboundEmailPayload): boolean {
	return (payload.Attachments ?? []).some((a) => /\.(gpx|tcx)$/i.test(a.Name ?? ''));
}

/** Statusene i `email_inbound_log.status`. */
export type InboundStatus = 'processed' | 'no_match' | 'failed';

/** Ferdigbehandlet: en ny levering av samme Gmail-melding skal ikke kjøres på nytt. */
export function isSettled(status: string | null | undefined): boolean {
	return status === 'processed' || status === 'no_match';
}

export interface InboundHealthInput {
	lastReceivedAt: Date | null;
	lastScriptVersion: number | null;
	now: Date;
}

export interface InboundHealth {
	tone: 'ok' | 'warn';
	text: string;
	outdatedScript: boolean;
}

const STALE_AFTER_DAYS = 30;

/**
 * Én setning om tilkoblingen, til innstillingene. Den finnes fordi feilen i
 * november 2026 var helt usynlig i appen: ingenting kom inn i uker, og ingenting
 * sa fra.
 *
 * Lenge siden siste e-post er bare en ADVARSEL etter 30 dager — filtrene
 * kan fint stå stille i ukevis. Et gammelt script er alltid en advarsel.
 */
export function describeInboundHealth({ lastReceivedAt, lastScriptVersion, now }: InboundHealthInput): InboundHealth {
	if (!lastReceivedAt) {
		return {
			tone: 'warn',
			text: 'Ingen e-post er mottatt ennå. Sjekk at Apps Script-utløseren kjører.',
			outdatedScript: false
		};
	}

	const outdatedScript = (lastScriptVersion ?? 1) < CURRENT_SCRIPT_VERSION;
	const days = Math.floor((now.getTime() - lastReceivedAt.getTime()) / 86_400_000);
	const when = days <= 0 ? 'i dag' : days === 1 ? 'i går' : `for ${days} dager siden`;

	if (outdatedScript) {
		return {
			tone: 'warn',
			text: `Siste e-post kom ${when}, fra script v${lastScriptVersion ?? 1}. Det finnes en nyere versjon (v${CURRENT_SCRIPT_VERSION}): kopier kildekoden under og kjør installTrigger().`,
			outdatedScript
		};
	}

	return {
		tone: days > STALE_AFTER_DAYS ? 'warn' : 'ok',
		text: `Siste e-post kom ${when} (script v${lastScriptVersion}).`,
		outdatedScript
	};
}
