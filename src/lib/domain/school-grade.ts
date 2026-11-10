/**
 * Klassetrinn ↔ barn, for skolemeldinger som ikke nevner barnet ved navn.
 *
 * Skolemeldingene kommer ikke lenger som e-post fra skolen: de deles fra
 * skoleappen og sendes fra brukeren til seg selv. Da står det verken skole eller
 * barn i avsenderen, og en ukeplan sier «Ukeplan 46 2B», ikke navnet. Trinnet er
 * derfor det som skiller barna.
 *
 * Norsk skole: barnet begynner i 1. trinn i august det året det fyller seks.
 * Skoleåret starter 1. august. Født 2019 → 1. trinn 2025/26 → 2. trinn 2026/27.
 * Tidlig/sen skolestart finnes; da må regelen få en fast person i stedet.
 */

export interface ChildWithBirthDate {
	id: string;
	name: string;
	birthDate: string | null; // YYYY-MM-DD
}

/** Trinnet (1–10) barnet går i på `todayIso`, eller null utenfor grunnskolen. */
export function schoolGradeForBirthDate(birthDate: string | null, todayIso: string): number | null {
	if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
	const birthYear = Number(birthDate.slice(0, 4));
	const year = Number(todayIso.slice(0, 4));
	const month = Number(todayIso.slice(5, 7));
	const schoolYearStart = month >= 8 ? year : year - 1;
	const grade = schoolYearStart - birthYear - 5;
	return grade >= 1 && grade <= 10 ? grade : null;
}

/**
 * Trinnet som står i teksten: «2B», «2. trinn», «trinn 2», «2.trinn».
 * Bare ett entydig trinn gir svar — to ulike trinn i samme tekst gir null.
 */
export function parseGradeHint(text: string): number | null {
	const found = new Set<number>();
	const patterns = [
		/\b(10|[1-9])\s*\.\s*trinn\b/gi,
		/\btrinn\s+(10|[1-9])\b/gi,
		// Klassenavn: siffer rett fulgt av én stor bokstav («2B», «10A»), ikke «2 B».
		/(?<![\d.,:])\b(10|[1-9])([A-ZÆØÅ])\b/g
	];
	for (const re of patterns) {
		for (const m of text.matchAll(re)) found.add(Number(m[1]));
	}
	return found.size === 1 ? [...found][0] : null;
}

/** Barnet som går i `grade`, bare når nøyaktig ett barn gjør det. */
export function childForGrade<T extends ChildWithBirthDate>(children: T[], grade: number | null, todayIso: string): T | null {
	if (!grade) return null;
	const hits = children.filter((c) => schoolGradeForBirthDate(c.birthDate, todayIso) === grade);
	return hits.length === 1 ? hits[0] : null;
}

/** «Nils (2. trinn)», til listen over barn i prompten. */
export function describeChildForPrompt(child: ChildWithBirthDate, todayIso: string): string {
	const grade = schoolGradeForBirthDate(child.birthDate, todayIso);
	return grade ? `${child.name} (${grade}. trinn)` : child.name;
}
