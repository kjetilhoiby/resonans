/** Formaterer minutter menneskelig: «43 min», «1 t 43 min», «2 t». */
export function fmtMinutter(minutes: number): string {
	const total = Math.round(minutes);
	if (total < 60) return `${total} min`;
	const hours = Math.floor(total / 60);
	const rest = total % 60;
	return rest === 0 ? `${hours} t` : `${hours} t ${rest} min`;
}
