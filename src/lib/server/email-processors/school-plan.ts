import { db } from '$lib/db';
import { persons, users, emailRules, sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { findOrCreateEmailSensor, type InboundEmailPayload } from './shared';
import { addDatedItems, type DatedItem } from './day-checklist';
import { createConversation, addMessage } from '$lib/server/conversations';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { sendGoogleChatMessage } from '$lib/server/google-chat';

type EmailRule = typeof emailRules.$inferSelect;

interface Finding {
	type: 'todo' | 'bring' | 'event' | 'info';
	dato: string | null; // ISO YYYY-MM-DD
	tid: string | null; // HH:MM
	person: string | null;
	tittel: string;
	detalj: string | null;
}

interface Extraction {
	kilde: string;
	sammendrag: string;
	funn: Finding[];
}

function stripHtml(html: string): string {
	return html
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/\s+/g, ' ')
		.trim();
}

function osloIsoDate(now: Date): string {
	return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

function isValidIsoDate(value: string | null): value is string {
	return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildPrompt(children: string[], todayIso: string, extraPrompt?: string | null): string {
	const childList = children.length
		? `Kjente barn i denne familien: ${children.join(', ')}.`
		: 'Ingen kjente barn er registrert.';

	return `Du leser en e-post fra en skole eller barnehage (ukeplan, månedsplan eller infoskriv).
Selve planen kan ligge i et vedlagt PDF-dokument — les hele innholdet i det, inkludert tabeller og dag-for-dag-oppsett.
Trekk ut KONKRETE, handlingsrettede ting en forelder må huske. Vær ekstra oppmerksom på
detaljer som lett glemmes — f.eks. "stenger 45 minutter før", "ha med tursko", "ta med matpakke",
turer, temadager, frister og avvik fra normal åpningstid.

I dag er ${todayIso}. ${childList}
Når e-posten nevner en ukedag, regn ut den faktiske datoen ut fra konteksten (uke/datoer i e-posten).

Returner KUN gyldig JSON med denne strukturen:
{
  "kilde": "barnehage" | "skole" | "sfo" | "annet",
  "sammendrag": "én kort setning om hva e-posten gjelder",
  "funn": [
    {
      "type": "todo" | "bring" | "event" | "info",
      "dato": "YYYY-MM-DD eller null hvis ukjent",
      "tid": "HH:MM eller null",
      "person": "navnet på barnet det gjelder, eller null hvis det gjelder alle/ukjent",
      "tittel": "kort handling, f.eks. 'Tur til Holmenkollen' eller 'Ha med tursko'",
      "detalj": "utfyllende info eller null"
    }
  ]
}

Regler:
- "bring" = noe barnet må ha med seg. "event" = en aktivitet/tur/hendelse på en dato. "todo" = noe forelderen må gjøre. "info" = viktig opplysning uten egen dato (f.eks. endret åpningstid).
- Bruk barnets navn i "person" kun når du er rimelig sikker. Ellers null.
- Ikke finn på datoer. Sett "dato": null hvis den ikke kan utledes trygt.
- Ta med avvik som "stenger tidligere" som egne funn (type "info" eller "event" med dato hvis kjent).
- Hopp over rent sosialt fyll og generelle hilsener.${
		extraPrompt?.trim()
			? `\n\nEkstra instruksjoner fra brukeren for denne kilden (følg disse i tillegg):\n${extraPrompt.trim()}`
			: ''
	}`;
}

// Ukeplaner kommer ofte som PDF-vedlegg. OpenAI kan lese PDF direkte som
// `file`-input (modellen rendrer sidene og «ser» dem) — det fanger også
// skannede/tabell-tunge planer som ren tekstuttrekking bommer på.
const MAX_PDF_BYTES = 16 * 1024 * 1024;

function pdfAttachments(payload: InboundEmailPayload) {
	return (payload.Attachments ?? []).filter((a) => {
		const isPdf =
			a.ContentType?.toLowerCase().includes('pdf') || a.Name?.toLowerCase().endsWith('.pdf');
		const fitsLimit = !a.ContentLength || a.ContentLength <= MAX_PDF_BYTES;
		return isPdf && a.Content && fitsLimit;
	});
}

async function extractFindings(
	payload: InboundEmailPayload,
	children: string[],
	todayIso: string,
	extraPrompt?: string | null
): Promise<Extraction | null> {
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const pdfs = pdfAttachments(payload);
	if (!body && !payload.Subject && pdfs.length === 0) return null;

	const emailContent = [
		`Fra: ${payload.From}`,
		`Emne: ${payload.Subject ?? '(ingen)'}`,
		pdfs.length ? `Vedlegg: ${pdfs.map((a) => a.Name).join(', ')} (se PDF under)` : '',
		'',
		body.slice(0, 8000)
	].filter(Boolean).join('\n');

	const userContent: ChatCompletionContentPart[] = [{ type: 'text', text: emailContent }];
	for (const pdf of pdfs.slice(0, 3)) {
		userContent.push({
			type: 'file',
			file: {
				filename: pdf.Name || 'ukeplan.pdf',
				file_data: `data:application/pdf;base64,${pdf.Content}`
			}
		});
	}

	// Bruk vision-modell når PDF er med (krever bilde-/fil-forståelse); ellers den raske.
	const model = pdfs.length > 0 ? 'gpt-4o' : 'gpt-4o-mini';

	const completion = await openai.chat.completions.create({
		model,
		messages: [
			{ role: 'system', content: buildPrompt(children, todayIso, extraPrompt) },
			{ role: 'user', content: userContent }
		],
		response_format: { type: 'json_object' },
		temperature: 0.1,
		max_tokens: 2000
	});

	const raw = completion.choices[0]?.message?.content ?? '{}';
	try {
		const parsed = JSON.parse(raw) as Partial<Extraction>;
		return {
			kilde: parsed.kilde ?? 'annet',
			sammendrag: parsed.sammendrag ?? '',
			funn: Array.isArray(parsed.funn) ? parsed.funn : []
		};
	} catch {
		return null;
	}
}

export async function processSchoolPlanEmail(
	userId: string,
	payload: InboundEmailPayload,
	rule: EmailRule,
	appUrl?: string
) {
	const todayIso = osloIsoDate(new Date());
	const gmailMessageId = payload.GmailMessageId;

	// Idempotens: Apps Script kan re-poste samme melding ved retry. Hopp over hvis
	// vi allerede har behandlet denne e-posten (unngår dupliserte nudges/samtaler).
	if (gmailMessageId) {
		const already = await db.query.sensorEvents.findFirst({
			where: and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'school_plan'),
				sql`metadata->>'gmailMessageId' = ${gmailMessageId}`
			),
			columns: { id: true }
		});
		if (already) {
			return { skipped: true, reason: 'already_imported' };
		}
	}

	// Hent brukerens barn (navn + aliaser) for person-ruting.
	const children = await db.query.persons.findMany({
		where: and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false)),
		columns: { id: true, name: true, aliases: true }
	});
	const childNames = children.flatMap((c) => [c.name, ...(c.aliases ?? [])]);

	const extraction = await extractFindings(payload, childNames, todayIso, rule.extractionPrompt);
	if (!extraction || extraction.funn.length === 0) {
		return { skipped: true, reason: 'no_findings' };
	}

	// Default-person fra regelen (f.eks. barnehage-etikett → ett barn).
	const defaultPersonId: string | null = rule.personId ?? null;
	const defaultPersonName: string | null =
		children.find((c) => c.id === rule.personId)?.name ?? null;

	function resolvePerson(name: string | null): { id: string | null; name: string | null } {
		if (name) {
			const match = children.find(
				(c) =>
					c.name.toLowerCase() === name.toLowerCase() ||
					(c.aliases ?? []).some((a) => a.toLowerCase() === name.toLowerCase())
			);
			if (match) return { id: match.id, name: match.name };
		}
		return { id: defaultPersonId, name: defaultPersonName };
	}

	const baseMeta = {
		source: 'email_inbound',
		label: payload.Label,
		gmailMessageId,
		from: payload.From,
		emailSubject: payload.Subject
	};

	const datedItems: DatedItem[] = [];
	const infoFindings: Finding[] = [];

	for (const finding of extraction.funn) {
		if (!finding?.tittel || typeof finding.tittel !== 'string') continue;
		const person = resolvePerson(finding.person);
		// Alt med en gyldig, ikke-passert dato havner i den dagens liste — også
		// "info"-avvik som "stenger 45 min før", som ellers glemmes.
		const isDated = isValidIsoDate(finding.dato) && finding.dato >= todayIso;

		if (!isDated) {
			infoFindings.push(finding);
			continue;
		}

		const namePrefix = person.name ? `${person.name}: ` : '';
		const core =
			finding.type === 'bring'
				? `Ha med ${finding.tittel}`
				: finding.type === 'info'
					? `ℹ️ ${finding.tittel}`
					: finding.tittel;
		const timeSuffix = finding.tid ? ` (kl ${finding.tid})` : '';
		const text = `${namePrefix}${core}${timeSuffix}`;

		datedItems.push({
			isoDate: finding.dato!,
			text,
			metadata: {
				...baseMeta,
				findingType: finding.type === 'info' ? 'event' : finding.type,
				personId: person.id ?? undefined,
				personName: person.name ?? undefined
			}
		});
	}

	const inserted = await addDatedItems(userId, datedItems);

	// Lagre full uttrekk som sensor-event for AI-kontekst (og som idempotens-markør).
	const sensor = await findOrCreateEmailSensor(userId, 'email_school_plan');
	await SensorEventService.write(
		{
			userId,
			sensorId: sensor.id,
			eventType: 'notification',
			dataType: 'school_plan',
			timestamp: new Date(),
			data: {
				kilde: extraction.kilde,
				sammendrag: extraction.sammendrag,
				funn: extraction.funn,
				emailSubject: payload.Subject,
				emailFrom: payload.From
			},
			metadata: { source: 'email_inbound', ruleId: rule.id, gmailMessageId },
			source: 'email_inbound'
		},
		{ conflictMode: 'ignore' }
	);

	await sendTriageNudge({
		userId,
		appUrl,
		kilde: extraction.kilde,
		sammendrag: extraction.sammendrag,
		findings: extraction.funn,
		datedCount: inserted
	}).catch((err) => console.error('[school-plan] triage nudge failed:', err));

	return {
		success: true,
		datedItems: inserted,
		infoFindings: infoFindings.length,
		totalFindings: extraction.funn.length
	};
}

function formatTriageMessage(args: {
	kilde: string;
	sammendrag: string;
	findings: Finding[];
}): string {
	const { kilde, sammendrag, findings } = args;
	const lines: string[] = [];
	lines.push(`📋 **Fant ${findings.length} ting fra ${kilde} du bør vite om.**`);
	if (sammendrag) lines.push(`\n${sammendrag}`);
	lines.push('');

	const icon: Record<Finding['type'], string> = {
		todo: '✅',
		bring: '🎒',
		event: '📅',
		info: 'ℹ️'
	};

	for (const f of findings) {
		const who = f.person ? `**${f.person}** – ` : '';
		const when = f.dato ? ` (${f.dato}${f.tid ? ` kl ${f.tid}` : ''})` : '';
		const detail = f.detalj ? ` — ${f.detalj}` : '';
		lines.push(`${icon[f.type] ?? '•'} ${who}${f.tittel}${when}${detail}`);
	}

	lines.push('');
	lines.push('Daterte ting er lagt i dagslistene. Spør meg hvis noe bør justeres.');
	return lines.join('\n');
}

async function sendTriageNudge(args: {
	userId: string;
	appUrl?: string;
	kilde: string;
	sammendrag: string;
	findings: Finding[];
	datedCount: number;
}) {
	const { userId, appUrl, kilde, sammendrag, findings, datedCount } = args;

	const conversation = await createConversation(userId);
	const content = formatTriageMessage({ kilde, sammendrag, findings });
	await addMessage({
		conversationId: conversation.id,
		role: 'assistant',
		content,
		metadata: { source: 'school_plan_triage', kilde, findingsCount: findings.length }
	});

	const url = appUrl
		? new URL(`/samtaler?conversation=${conversation.id}`, appUrl).toString()
		: `/samtaler?conversation=${conversation.id}`;

	const title = `📋 ${findings.length} ting fra ${kilde}`;
	const body =
		datedCount > 0
			? `${datedCount} lagt i dagslistene. Trykk for triage.`
			: 'Trykk for å se hva som er verdt å vite.';

	const user = await db.query.users.findFirst({
		where: eq(users.id, userId),
		columns: { id: true, googleChatWebhook: true }
	});

	const delivery = await PushDeliveryService.deliverToUser({
		userId,
		payload: { title, body, url, tag: `school-plan-${conversation.id}` },
		onGone: 'disable'
	});

	if (delivery.sent === 0 && user?.googleChatWebhook) {
		await sendGoogleChatMessage(user.googleChatWebhook, {
			text: `${title}\n\n${content}\n\n${url}`
		});
	}

	return { conversationId: conversation.id };
}
