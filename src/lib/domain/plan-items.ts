/**
 * Planpunkter slik MCP-verktøyene ser dem — ren logikk, ingen database.
 *
 * Et planpunkt er et `checklist_items`-punkt på en dagsliste
 * (`week:2026-W44:day:2026-10-30`) eller en ukeliste (`week:2026-W44`). Det er
 * de samme radene hjemskjermen og ukeplanen viser; ingen ny modell. Se
 * docs/mcp.md, «Planlegging».
 *
 * Klokkeslett lagres som lokal veggklokke (`metadata.timeHour/timeMinute`), ikke
 * som et tidspunkt. «11:00 fredag» er 11:00 uansett sommertid; offset regnes
 * først når et tidspunkt skal ut (`startsAt`).
 */

export const OSLO_TZ = 'Europe/Oslo';

/** Lengste periode ett oppslag får dekke. En agenda over et halvår er ikke et oppslag. */
export const MAX_RANGE_DAYS = 31;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WEEK = /^(\d{4})-W(\d{2})$/;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** En ekte kalenderdato, ikke bare riktig form — «2026-02-30» avvises. */
export function isValidIsoDate(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const m = value.match(ISO_DATE);
	if (!m) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.toISOString().slice(0, 10) === value;
}

export function isValidIsoWeek(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const m = value.match(ISO_WEEK);
	return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 53;
}

export function parseStartTime(value: unknown): { hour: number; minute: number } | null {
	if (typeof value !== 'string') return null;
	const m = value.trim().match(HHMM);
	return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export function formatHm(hour: number, minute: number): string {
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Datoene fra og med `from` til og med `to`. */
export function datesInRange(from: string, to: string): string[] {
	const out: string[] = [];
	const [fy, fm, fd] = from.split('-').map(Number);
	const cursor = new Date(Date.UTC(fy, fm - 1, fd));
	while (cursor.toISOString().slice(0, 10) <= to) {
		out.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return out;
}

export type RangeCheck = { ok: true; dates: string[] } | { ok: false; error: string };

export function checkRange(from: unknown, to: unknown): RangeCheck {
	if (!isValidIsoDate(from)) return { ok: false, error: `from må være en ISO-dato (YYYY-MM-DD), fikk ${JSON.stringify(from)}.` };
	const end = to === undefined || to === null || to === '' ? from : to;
	if (!isValidIsoDate(end)) return { ok: false, error: `to må være en ISO-dato (YYYY-MM-DD), fikk ${JSON.stringify(to)}.` };
	if (end < from) return { ok: false, error: 'to kan ikke være før from.' };
	const dates = datesInRange(from, end);
	if (dates.length > MAX_RANGE_DAYS) {
		return { ok: false, error: `Perioden kan være høyst ${MAX_RANGE_DAYS} dager; del opp oppslaget.` };
	}
	return { ok: true, dates };
}

/** Offset i minutter for Oslo i et gitt UTC-øyeblikk (+60 vinter, +120 sommer). */
function osloOffsetMinutes(utcMs: number): number {
	const name = new Intl.DateTimeFormat('en-US', { timeZone: OSLO_TZ, timeZoneName: 'longOffset' })
		.formatToParts(new Date(utcMs))
		.find((p) => p.type === 'timeZoneName')?.value;
	const m = name?.match(/GMT([+-])(\d{2}):(\d{2})/);
	if (!m) return 0;
	const sign = m[1] === '-' ? -1 : 1;
	return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * Lokal Oslo-tid → ISO-tidspunkt med offset, f.eks. `2026-10-30T11:00:00+01:00`.
 *
 * Regnes to ganger: første gjetning bruker offset ved UTC-tida, andre retter seg
 * etter offset ved den faktiske tida. Uten andre runde blir tidene rett etter et
 * sommertidsskifte én time feil.
 */
export function osloLocalToIso(dateIso: string, hour: number, minute: number): string {
	const [y, mo, d] = dateIso.split('-').map(Number);
	const wall = Date.UTC(y, mo - 1, d, hour, minute);
	let utc = wall - osloOffsetMinutes(wall) * 60_000;
	utc = wall - osloOffsetMinutes(utc) * 60_000;
	const offset = osloOffsetMinutes(utc);
	const sign = offset < 0 ? '-' : '+';
	const abs = Math.abs(offset);
	return `${dateIso}T${formatHm(hour, minute)}:00${sign}${formatHm(Math.floor(abs / 60), abs % 60)}`;
}

/** Datoen (YYYY-MM-DD) et tidspunkt faller på i Oslo — ikke UTC-datoen. */
export function osloDateOf(instant: Date | string): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: OSLO_TZ }).format(new Date(instant));
}

/** Klokkeslettet (HH:MM) et tidspunkt har i Oslo. */
export function osloTimeOf(instant: Date | string): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: OSLO_TZ, hour: '2-digit', minute: '2-digit' }).format(
		new Date(instant)
	);
}

export type PlanList = { kind: 'day'; date: string; week: string } | { kind: 'week'; week: string };

/** Sjekkliste-kontekst → hvilken liste. `null` for alt som ikke er en dag- eller ukeliste. */
export function parsePlanContext(context: string | null | undefined): PlanList | null {
	if (!context) return null;
	const day = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
	if (day) return { kind: 'day', week: day[1], date: day[2] };
	const week = context.match(/^week:(\d{4}-W\d{2})$/);
	if (week) return { kind: 'week', week: week[1] };
	return null;
}

export interface PlanItemRowLike {
	id: string;
	text: string;
	checked: boolean;
	checkedAt: Date | null;
	skippedAt: Date | null;
	dueDate: string | null;
	estimateMinutes: number | null;
	projectId: string | null;
	parentId: string | null;
	createdAt: Date;
	metadata: Record<string, unknown> | null;
}

export interface PlanItem {
	id: string;
	text: string;
	/** `day` = står på en bestemt dag; `week` = i ukelista, uten dag. */
	list: 'day' | 'week';
	date: string | null;
	week: string;
	/** Lokal Oslo-tid, `HH:MM`. `null` = hele dagen / uten klokkeslett. */
	startTime: string | null;
	/** Samme tidspunkt med offset, for den som skal regne. Bare når både dato og klokkeslett finnes. */
	startsAt: string | null;
	durationMinutes: number | null;
	dueDate: string | null;
	status: 'open' | 'done' | 'skipped';
	completedAt: string | null;
	personName: string | null;
	links: {
		goalTaskId?: string;
		weekItemId?: string;
		projectId?: string;
		streakId?: string;
	};
	parentId: string | null;
}

function str(value: unknown): string | null {
	return typeof value === 'string' && value ? value : null;
}

export function toPlanItem(row: PlanItemRowLike, list: PlanList): PlanItem {
	const meta = row.metadata ?? {};
	const hour = typeof meta.timeHour === 'number' ? meta.timeHour : null;
	const minute = typeof meta.timeMinute === 'number' ? meta.timeMinute : 0;
	const startTime = hour === null ? null : formatHm(hour, minute);
	const date = list.kind === 'day' ? list.date : null;

	const links: PlanItem['links'] = {};
	if (str(meta.linkedTaskId)) links.goalTaskId = str(meta.linkedTaskId)!;
	if (str(meta.linkedChecklistItemId)) links.weekItemId = str(meta.linkedChecklistItemId)!;
	if (row.projectId) links.projectId = row.projectId;
	if (str(meta.linkedStreakId)) links.streakId = str(meta.linkedStreakId)!;

	return {
		id: row.id,
		text: row.text,
		list: list.kind,
		date,
		week: list.week,
		startTime,
		startsAt: date && hour !== null ? osloLocalToIso(date, hour, minute) : null,
		durationMinutes: row.estimateMinutes,
		dueDate: row.dueDate,
		status: row.skippedAt ? 'skipped' : row.checked ? 'done' : 'open',
		completedAt: row.checked && row.checkedAt ? row.checkedAt.toISOString() : null,
		personName: str(meta.personName),
		links,
		parentId: row.parentId
	};
}

/** Tidsfestede først (etter klokkeslett), så resten i listerekkefølge. */
export function sortPlanItems<T extends { startTime: string | null }>(items: T[]): T[] {
	return items
		.map((item, index) => ({ item, index }))
		.sort((a, b) => {
			if (a.item.startTime && b.item.startTime) return a.item.startTime.localeCompare(b.item.startTime);
			if (a.item.startTime) return -1;
			if (b.item.startTime) return 1;
			return a.index - b.index;
		})
		.map(({ item }) => item);
}

/** Lik tekst for duplikatsjekk: små bokstaver, sammenfalt mellomrom. */
export function normalizeItemText(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export type SpondRsvp = 'accepted' | 'declined' | 'unanswered' | 'waitinglist' | 'not_invited' | 'unknown';

/**
 * Hva familiens medlemmer har svart på en Spond-hendelse.
 *
 * `not_invited` er skillet oppgaven ba om: en hendelse i en gruppe der ingen av
 * våre medlemmer står på lista, er noe som SKJER, ikke noe barnet skal delta i
 * («se Vålerenga–Tromsø»). `unknown` betyr at vi ikke vet hvem som er våre —
 * da skal ingen tolkning bygges på svaret.
 */
export function spondRsvp(
	responses: { acceptedIds?: string[]; declinedIds?: string[]; unansweredIds?: string[]; waitinglistIds?: string[] } | null | undefined,
	myMemberIds: readonly string[]
): SpondRsvp {
	if (myMemberIds.length === 0) return 'unknown';
	const mine = (ids: string[] | undefined) => (ids ?? []).some((id) => myMemberIds.includes(id));
	if (mine(responses?.acceptedIds)) return 'accepted';
	if (mine(responses?.declinedIds)) return 'declined';
	// «Ikke svart» før venteliste: det første krever noe av oss. Samme rekkefølge
	// som ukeplanen hadde før regelen ble delt.
	if (mine(responses?.unansweredIds)) return 'unanswered';
	if (mine(responses?.waitinglistIds)) return 'waitinglist';
	return 'not_invited';
}
