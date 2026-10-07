/**
 * «Ligger dette i Norge?» — grovt, for å velge bakgrunnskart.
 *
 * Kartverkets topografiske kart (`topograatone`) er det beste bakgrunnskartet vi
 * har her til lands: ferskt, med stier og høydekurver, og rolig i gråtoner. Men
 * utenfor Norge er flisene BLANKE — en tur til Strömstad ville fått et hvitt kart
 * med en strek på. Derfor velges kartet per tur, og alt som ikke ligger innenfor
 * faller tilbake til et globalt kart.
 *
 * Polygonet er grovt med vilje: romslig ut mot havet, stramt innenfor
 * landegrensene. En feil i retning «utenfor» koster et dårligere kart; en feil i
 * retning «innenfor» koster et blankt kart. Svalbard er ikke med.
 */

/** [lat, lon], rundt fastlands-Norge med klokka, fra Skagerrak. */
const MAINLAND_NORWAY: ReadonlyArray<readonly [number, number]> = [
	[57.7, 7.0],
	[58.3, 5.0],
	[60.0, 4.2],
	[62.0, 4.4],
	[63.5, 7.5],
	[65.0, 10.0],
	[67.0, 11.3],
	[68.0, 11.5],
	[69.6, 15.5],
	[70.5, 19.0],
	[71.3, 25.5],
	[71.2, 28.0],
	[70.5, 31.3],
	// Russland
	[69.75, 30.7],
	[69.1, 28.95],
	// Finland
	[70.0, 28.0],
	[69.85, 27.0],
	[69.4, 25.7],
	[68.95, 25.4],
	[68.65, 24.6],
	[68.75, 23.0],
	[69.0, 22.0],
	[69.25, 21.3],
	[69.05, 20.5],
	// Sverige
	[68.45, 17.95],
	[68.0, 17.3],
	[67.0, 16.1],
	[66.0, 14.5],
	[65.0, 13.9],
	[64.0, 13.4],
	[63.3, 11.9],
	[62.9, 12.0],
	[62.0, 12.1],
	[61.0, 12.45],
	[60.0, 12.25],
	[59.4, 11.7],
	[59.12, 11.45],
	[59.02, 11.1],
	// Skagerrak
	[58.9, 10.6],
	[58.0, 9.0]
];

/** Ray casting; x = lon, y = lat. */
export function isInMainlandNorway(lat: number, lon: number): boolean {
	if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
	let inside = false;
	const poly = MAINLAND_NORWAY;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [yi, xi] = poly[i];
		const [yj, xj] = poly[j];
		const crosses = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
		if (crosses) inside = !inside;
	}
	return inside;
}

/**
 * Sant bare når det finnes minst ett punkt og ALLE ligger i Norge. Lange spor
 * tynnes ut — grovheten i polygonet gjør presisjon per punkt meningsløs.
 */
export function allInMainlandNorway(points: ReadonlyArray<readonly [number, number]>): boolean {
	if (points.length === 0) return false;
	const step = Math.max(1, Math.floor(points.length / 200));
	for (let i = 0; i < points.length; i += step) {
		if (!isInMainlandNorway(points[i][0], points[i][1])) return false;
	}
	const last = points[points.length - 1];
	return isInMainlandNorway(last[0], last[1]);
}
