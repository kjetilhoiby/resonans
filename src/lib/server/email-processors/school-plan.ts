import { db } from '$lib/db';
import { persons, users, emailRules, sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { createWithAlias } from '$lib/server/ai/model-alias';
import type { ChatCompletionContentPart } from 'openai/resources/chat/completions';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { findOrCreateEmailSensor, stripHtml, type InboundEmailPayload } from './shared';
import { addDatedItems, type DatedItem } from './day-checklist';
import { createConversation, addMessage } from '$lib/server/conversations';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import { sendGoogleChatMessage } from '$lib/server/google-chat';
import { childForGrade, describeChildForPrompt, parseGradeHint } from '$lib/domain/school-grade';

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
	digest: string; // tapsfri gjengivelse av ALT innhold — sikkerhetsnett mot at funn-strukturen glipper
	trinn: number | null; // klassetrinnet meldingen gjelder («2B» → 2), når det står
	funn: Finding[];
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
  "trinn": tallet for klassetrinnet meldingen gjelder (f.eks. 2 for «2B» eller «2. trinn»), eller null,
  "digest": "en FULLSTENDIG og trofast gjengivelse av ALT relevant innhold, som markdown-punktliste. Ikke utelat noe en forelder kan trenge — ta med datoer, tider, navn, beskjeder og detaljer selv om de ikke passer som et eget 'funn'. Dette er sikkerhetsnettet.",
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
- Meldinger deles ofte fra skoleappen uten barnets navn, men med klassen (f.eks. «Ukeplan 46 2B»). Går nøyaktig ett av de kjente barna på det trinnet, gjelder meldingen det barnet: bruk navnet i "person".
- Ikke finn på datoer. Sett "dato": null hvis den ikke kan utledes trygt.
- Ta med avvik som "stenger tidligere" som egne funn (type "info" eller "event" med dato hvis kjent).
- "digest" skal være KOMPLETT (alt relevant tas med). "funn" skal være KONSERVATIV — kun ting du er trygg på er handlingsrettet. Er du i tvil, la det stå i "digest" og dropp det som "funn"; da går ingenting tapt.
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

	// En PDF er `vision` (laben måler fil-forståelse der); ren e-posttekst er et vanlig uttrekk.
	const completion = await createWithAlias(pdfs.length > 0 ? 'vision' : 'json_cheap', {
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
			digest: typeof parsed.digest === 'string' ? parsed.digest : '',
			trinn: Number.isInteger(parsed.trinn) && (parsed.trinn as number) >= 1 && (parsed.trinn as number) <= 10 ? (parsed.trinn as number) : null,
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
		columns: { id: true, name: true, aliases: true, birthDate: true }
	});
	// Navnet med trinn («Nils (2. trinn)»), så modellen kan koble «2B» til barnet.
	const childNames = children.flatMap((c) => [describeChildForPrompt(c, todayIso), ...(c.aliases ?? [])]);

	const extraction = await extractFindings(payload, childNames, todayIso, rule.extractionPrompt);
	if (!extraction || (extraction.funn.length === 0 && !extraction.digest.trim())) {
		return { skipped: true, reason: 'no_content' };
	}

	// Default-person fra regelen (f.eks. barnehage-etikett → ett barn).
	const defaultPersonId: string | null = rule.personId ?? null;
	const defaultPersonName: string | null =
		children.find((c) => c.id === rule.personId)?.name ?? null;

	// Uten fast person på regelen: barnet på trinnet meldingen gjelder. Modellens
	// «trinn» først, ellers det som står i emne/tekst. Se $lib/domain/school-grade.
	const body = payload.TextBody || (payload.HtmlBody ? stripHtml(payload.HtmlBody) : '');
	const grade = extraction.trinn ?? parseGradeHint(`${payload.Subject ?? ''}\n${body}`);
	const gradeChild = defaultPersonId ? null : childForGrade(children, grade, todayIso);
	const fallbackPerson = defaultPersonId
		? { id: defaultPersonId, name: defaultPersonName }
		: { id: gradeChild?.id ?? null, name: gradeChild?.name ?? null };

	function resolvePerson(name: string | null): { id: string | null; name: string | null } {
		if (name) {
			const match = children.find(
				(c) =>
					c.name.toLowerCase() === name.toLowerCase() ||
					(c.aliases ?? []).some((a) => a.toLowerCase() === name.toLowerCase())
			);
			if (match) return { id: match.id, name: match.name };
		}
		return fallbackPerson;
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
				digest: extraction.digest,
				funn: extraction.funn,
				trinn: grade,
				personId: fallbackPerson.id ?? undefined,
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
		digest: extraction.digest,
		sammendrag: extraction.sammendrag,
		addedItems: datedItems.map((d) => ({ text: d.text, isoDate: d.isoDate })),
		datedCount: inserted
	}).catch((err) => console.error('[school-plan] triage nudge failed:', err));

	return {
		success: true,
		datedItems: inserted,
		infoFindings: infoFindings.length,
		totalFindings: extraction.funn.length,
		grade,
		gradeChild: gradeChild?.name ?? null
	};
}

function formatTriageMessage(args: {
	kilde: string;
	digest: string;
	sammendrag: string;
	addedItems: Array<{ text: string; isoDate: string }>;
}): string {
	const { kilde, digest, sammendrag, addedItems } = args;
	const lines: string[] = [];
	lines.push(`📋 **Ny ${kilde}-info gjennomgått.**`);
	if (sammendrag) lines.push(`\n${sammendrag}`);

	// Tapsfri digest — alt innholdet, slik at ingenting glipper.
	if (digest.trim()) {
		lines.push('');
		lines.push(digest.trim());
	}

	// Hva som allerede er lagt automatisk i dagslistene.
	if (addedItems.length > 0) {
		lines.push('');
		lines.push(`**Lagt automatisk i dagslistene (${addedItems.length}):**`);
		for (const item of addedItems) {
			lines.push(`- ${item.text} — ${item.isoDate}`);
		}
	}

	lines.push('');
	lines.push(
		'Si fra hvis noe mangler eller skal endres — jeg kan legge til, datofeste eller knytte punkter til riktig barn for deg.'
	);
	return lines.join('\n');
}

async function sendTriageNudge(args: {
	userId: string;
	appUrl?: string;
	kilde: string;
	digest: string;
	sammendrag: string;
	addedItems: Array<{ text: string; isoDate: string }>;
	datedCount: number;
}) {
	const { userId, appUrl, kilde, digest, sammendrag, addedItems, datedCount } = args;

	const conversation = await createConversation(userId);
	const content = formatTriageMessage({ kilde, digest, sammendrag, addedItems });
	await addMessage({
		conversationId: conversation.id,
		role: 'assistant',
		content,
		metadata: { source: 'school_plan_triage', kilde, addedCount: datedCount }
	});

	const url = appUrl
		? new URL(`/samtaler?conversation=${conversation.id}`, appUrl).toString()
		: `/samtaler?conversation=${conversation.id}`;

	const title = `📋 Ny info fra ${kilde}`;
	const body =
		datedCount > 0
			? `${datedCount} lagt i dagslistene. Trykk for å se alt.`
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
