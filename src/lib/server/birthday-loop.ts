/**
 * «Dette ville du i fjor» — lukk sløyfen: hold fjorårets bursdagsmål og
 * spådom opp mot hva som faktisk skjedde. Ren logikk; DB-spørringen bor i
 * kavalkade-data. Ærlighetsregel: «Oppnådd» kun med ekte tall ≥ mål, eller
 * brukerstatus 'completed'. Ellers «Uvisst» (achieved = null).
 */

export interface LoopGoalInput {
	title: string;
	status: string;
	metadata: {
		target?: { value?: number; unit?: string } | null;
		currentValue?: number | null;
		tracking?: { metric?: string } | null;
		goalType?: string | null;
	} | null;
}

export interface LoopPromise {
	title: string;
	targetValue: number | null;
	unit: string | null;
	actualValue: number | null;
	/** true = oppnådd, false = ikke nådd, null = uvisst/umålbart */
	achieved: boolean | null;
	status: string;
}

export interface BirthdayLoop {
	hasData: boolean;
	promises: LoopPromise[];
	prophecyExcerpt: string | null;
}

function firstParagraph(text: string | null | undefined): string | null {
	if (!text) return null;
	const p = text.split(/\n{2,}/)[0]?.trim();
	return p || null;
}

export function buildBirthdayLoop(input: {
	goals: LoopGoalInput[];
	prophecyContent: string | null;
	runningKm: number | null;
}): BirthdayLoop {
	const promises: LoopPromise[] = input.goals.map((g) => {
		const target = g.metadata?.target;
		const targetValue = typeof target?.value === 'number' ? target.value : null;
		const unit = typeof target?.unit === 'string' && target.unit ? target.unit : null;
		const metric = g.metadata?.tracking?.metric ?? g.metadata?.goalType ?? null;

		if (targetValue === null) {
			// Umålbart mål: kun brukerstatus 'completed' er autoritativ «oppnådd»
			return {
				title: g.title,
				targetValue: null,
				unit: null,
				actualValue: null,
				achieved: g.status === 'completed' ? true : null,
				status: g.status
			};
		}

		// Målbart: bruk beste tilgjengelige faktiske tall
		let actualValue: number | null = null;
		if (metric === 'running_distance' && typeof input.runningKm === 'number') {
			actualValue = input.runningKm;
		} else if (typeof g.metadata?.currentValue === 'number' && g.metadata.currentValue > 0) {
			actualValue = g.metadata.currentValue;
		}

		return {
			title: g.title,
			targetValue,
			unit,
			actualValue,
			achieved: actualValue !== null ? actualValue >= targetValue : null,
			status: g.status
		};
	});

	const prophecyExcerpt = firstParagraph(input.prophecyContent);
	return {
		hasData: promises.length > 0 || prophecyExcerpt !== null,
		promises,
		prophecyExcerpt
	};
}
