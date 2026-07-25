/**
 * week-schedule-logic.ts — Ren logikk for å planlegge et ukeplan-element ned
 * på en valgt dag.
 *
 * «Planlegge» betyr: lag et dag-punkt på valgt dag som er koblet tilbake til
 * kilden på ukeplan. Når dag-punktet krysses av, resolves kilden automatisk:
 *   - tema/mål-oppgave (`linkedTaskId`) → fremdrift logges → slot fylles
 *   - ukeliste-punkt (`linkedChecklistItemId`) → punktet krysses av
 *
 * Denne modulen holder de rene bitene (etikett-rensing, link-bygging,
 * dedup-sjekk) utenfor komponenten for testbarhet.
 */
import type { ChecklistItem, WeekTask } from './types';

/** Payload som sendes til POST /api/checklists/[id]/items for å koble dag-punktet. */
export interface ScheduleLinkPayload {
	/** Kobler til en tema/mål-oppgave (tasks.id). */
	taskId?: string;
	/** Vises som «koblet til»-etikett på dag-punktet. */
	taskTitle?: string;
	/** Kobler til et ukeliste-punkt (checklist_items.id). */
	checklistItemId?: string;
	/** Kobler til en streak-definisjon (streak_definitions.id) — periodisk vedlikehold. */
	streakId?: string;
	activityType?: string;
	durationMinutes?: number;
	distanceKm?: number;
}

/** Periodisk vedlikehold som nærmer seg forfall, klart til å plukkes ned på en dag. */
export interface DueMaintenance {
	definitionId: string;
	title: string;
	emoji: string;
	count: number;
	daysUntilDue: number;
	nextDueDay: string | null;
	status: 'due_soon' | 'overdue';
}

export type ScheduleSource =
	| { kind: 'task'; task: WeekTask }
	| { kind: 'item'; item: ChecklistItem }
	| { kind: 'maintenance'; maintenance: DueMaintenance };

/**
 * Rensk en ukeplan-tittel til en kort dag-punkt-etikett:
 *   «Løp (1/3)» → «Løp»
 *   «Løp tre ganger» → «Løp»
 *   «Drikk vann» → «Drikk vann»
 */
export function scheduleLabel(raw: string | null | undefined): string {
	const base = (raw ?? '').trim();
	if (!base) return '';
	let s = base;
	// Fjern gjentaks-suffiks «(1/3)».
	s = s.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
	// Fjern etterstilt antall-frase «… tre ganger» / «… 5 dager».
	s = s.replace(
		/\s+(\d{1,2}|en|ett|to|tre|fire|fem|seks|syv|sju|åtte|atte|ni|ti)\s+(ganger|dager|arbeidsdager|uker|ukedager|helger)\s*$/i,
		''
	).trim();
	return s || base;
}

function pickActivityMeta(meta: Record<string, any> | null | undefined): {
	activityType?: string;
	durationMinutes?: number;
	distanceKm?: number;
} {
	const m = (meta ?? {}) as Record<string, any>;
	const parsed = (m.parsedIntent ?? {}) as Record<string, any>;
	const activityType = m.activityType ?? parsed.activityType;
	const durationMinutes = m.durationMinutes ?? parsed.durationMinutes;
	const distanceKm = m.distanceKm ?? parsed.distanceKm;
	return {
		...(typeof activityType === 'string' ? { activityType } : {}),
		...(typeof durationMinutes === 'number' ? { durationMinutes } : {}),
		...(typeof distanceKm === 'number' ? { distanceKm } : {})
	};
}

/** Bygg dag-punkt-etikett + link-payload for en planleggings-kilde. */
export function buildScheduleLink(source: ScheduleSource): { label: string; link: ScheduleLinkPayload } {
	if (source.kind === 'task') {
		const { task } = source;
		const label = scheduleLabel(task.title);
		return {
			label,
			link: {
				taskId: task.id,
				taskTitle: label,
				...pickActivityMeta(task.metadata)
			}
		};
	}
	if (source.kind === 'maintenance') {
		const { maintenance } = source;
		return {
			label: scheduleLabel(maintenance.title),
			link: { streakId: maintenance.definitionId }
		};
	}
	const { item } = source;
	const label = scheduleLabel(item.text);
	return {
		label,
		link: {
			checklistItemId: item.id,
			...pickActivityMeta(item.metadata)
		}
	};
}

/**
 * Skal et forelder-punkt være avkrysset? True når det finnes minst ett barn og
 * alle barn er «behandlet» (avkrysset eller hoppet over — skippede punkter
 * blokkerer ikke fullføring, likt sjekkliste-fullføring ellers).
 *
 * Brukes både på server (auto-hak av forelder ved barn-toggle) og klient
 * (optimistisk speiling) så et nedbrutt punkt resolves når hele lista er ferdig.
 */
export function shouldParentBeChecked(
	children: Array<{ checked: boolean; skippedAt?: string | Date | null }>
): boolean {
	if (children.length === 0) return false;
	return children.every((c) => c.checked || c.skippedAt != null);
}

/**
 * Er kilden allerede planlagt på denne dagen? True hvis dag-lista har et
 * ikke-avkrysset punkt koblet til samme oppgave/ukeliste-punkt. Brukes for å
 * unngå duplikater ved gjentatt tapp (uten «angre ved tapp»).
 */
export function isAlreadyScheduled(dayItems: ChecklistItem[], link: ScheduleLinkPayload): boolean {
	return dayItems.some((it) => {
		if (it.checked) return false;
		const meta = it.metadata ?? {};
		if (link.taskId && meta.linkedTaskId === link.taskId) return true;
		if (link.checklistItemId && meta.linkedChecklistItemId === link.checklistItemId) return true;
		if (link.streakId && meta.linkedStreakId === link.streakId) return true;
		return false;
	});
}
