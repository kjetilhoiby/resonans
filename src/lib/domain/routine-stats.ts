/**
 * Hvor ofte rutinepunktene faktisk blir gjort — regnet av rutinens instanser.
 *
 * ## Hva som er målt, og hva som ikke er det
 *
 * En rutine blir en sjekkliste (`routine:<id>:<dato>`) først når noen ÅPNER den
 * dagen — hjemskjermen eller ukeplanen lager instansen. En dag uten instans er
 * derfor ikke «ikke gjort»; den er ikke målt. Statistikken skiller de to
 * (`scheduledDays` mot `daysOpened`), og andelene regnes bare av de målte
 * dagene. Ellers ville en uke på hytta uten appen sett ut som en uke der
 * morgenrutinen ble droppet.
 *
 * Punktene matches på tekst. Er rutinen endret i perioden, finnes gamle punkter i
 * instansene som ikke lenger står i definisjonen; de telles i
 * `retiredItemsSeen`, ikke på et nytt punkt med lik plass i lista.
 */

export interface RoutineDefinitionLike {
	daysOfWeek: number[];
	createdAt: Date;
	items: Array<{ text: string; estimateMinutes?: number; sortOrder?: number }>;
}

export interface RoutineInstanceLike {
	date: string;
	items: Array<{ text: string; checked: boolean; skipped: boolean }>;
}

export interface RoutineItemStats {
	text: string;
	sortOrder: number;
	estimateMinutes: number | null;
	done: number;
	skipped: number;
	/** Dagen var åpnet, men punktet ble verken gjort eller hoppet over. */
	notDone: number;
	/** done / dager punktet sto i en åpnet instans. `null` uten målinger. */
	doneRate: number | null;
}

export interface RoutineStats {
	periodDays: number;
	scheduledDays: number;
	daysOpened: number;
	daysCompleted: number;
	items: RoutineItemStats[];
	retiredItemsSeen: number;
	note: string;
}

function norm(text: string): string {
	return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dowOf(isoDate: string): number {
	const [y, m, d] = isoDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function computeRoutineStats(
	def: RoutineDefinitionLike,
	periodDates: string[],
	instances: RoutineInstanceLike[]
): RoutineStats {
	const createdDate = def.createdAt.toISOString().slice(0, 10);
	const scheduled = new Set(periodDates.filter((d) => d >= createdDate && def.daysOfWeek.includes(dowOf(d))));
	const opened = instances.filter((i) => scheduled.has(i.date));

	const items: RoutineItemStats[] = def.items.map((item, index) => ({
		text: item.text,
		sortOrder: item.sortOrder ?? index,
		estimateMinutes: item.estimateMinutes ?? null,
		done: 0,
		skipped: 0,
		notDone: 0,
		doneRate: null
	}));
	const byText = new Map(items.map((i) => [norm(i.text), i]));
	const seenIn = new Map<RoutineItemStats, number>();
	let retiredItemsSeen = 0;
	let daysCompleted = 0;

	for (const instance of opened) {
		if (instance.items.length > 0 && instance.items.every((i) => i.checked || i.skipped)) daysCompleted++;
		for (const entry of instance.items) {
			const stats = byText.get(norm(entry.text));
			if (!stats) {
				retiredItemsSeen++;
				continue;
			}
			seenIn.set(stats, (seenIn.get(stats) ?? 0) + 1);
			if (entry.checked) stats.done++;
			else if (entry.skipped) stats.skipped++;
			else stats.notDone++;
		}
	}
	for (const stats of items) {
		const n = seenIn.get(stats) ?? 0;
		stats.doneRate = n > 0 ? Math.round((stats.done / n) * 100) / 100 : null;
	}

	const note =
		opened.length === 0
			? 'Ingen åpnede dager i perioden: gjennomføring er ikke målt. Dager uten instans er ukjent, ikke «ikke gjort».'
			: `Målt på ${opened.length} av ${scheduled.size} planlagte dager — bare dager rutinen ble åpnet i appen. Resten er ukjent, ikke «ikke gjort».`;

	return {
		periodDays: periodDates.length,
		scheduledDays: scheduled.size,
		daysOpened: opened.length,
		daysCompleted,
		items,
		retiredItemsSeen,
		note
	};
}
