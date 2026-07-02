/**
 * Ekspandering av MÅNEDSOPPGAVER til gjøremål på månedslista.
 *
 * En månedsoppgave med et antall (f.eks. «Yoga: 4 ganger») blir ett foreldre-punkt
 * med N barn-slots som hakes av én etter én (MonthChecklist rendrer barna som
 * kompakte sirkler gruppert på parentId). Antallet slots klampes til
 * {@link MAX_MONTH_TASK_SLOTS} slik at en for høy AI-foreslått frekvens («20 ganger»)
 * ikke eksploderer lista til dusinvis av duplikater — høyfrekvente ting hører uansett
 * hjemme som MÅNEDSMÅL, ikke som avkryssbare oppgaver.
 */

export const MAX_MONTH_TASK_SLOTS = 12;

export type MonthTaskInput = { title: string; value: number; unit: string };

export type MonthTaskPlan = {
	/** Tittelen som vises på foreldre-punktet (med antall når det er flere slots). */
	parentLabel: string;
	/** Antall barn-slots. 1 = enkelt punkt uten gruppering. */
	slotCount: number;
	/** Teksten hvert barn-slot får (uten antall-suffiks). */
	childLabel: string;
};

/**
 * Regn ut hvordan én månedsoppgave skal bli til gjøremål.
 * Klamper antallet til [1, MAX_MONTH_TASK_SLOTS].
 */
export function planMonthTask(task: MonthTaskInput): MonthTaskPlan {
	const title = task.title.trim();
	const unit = task.unit.trim();
	const raw = Number.isFinite(task.value) ? Math.floor(task.value) : 1;
	const slotCount = Math.min(Math.max(raw, 1), MAX_MONTH_TASK_SLOTS);

	if (slotCount <= 1) {
		return { parentLabel: title, slotCount: 1, childLabel: title };
	}

	const label = unit ? `${title} (${slotCount} ${unit})` : `${title} (${slotCount})`;
	return { parentLabel: label, slotCount, childLabel: title };
}
