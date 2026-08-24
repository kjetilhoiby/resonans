/**
 * OKLCH → sRGB-hex, med gamut-klipp.
 *
 * ## Hvorfor vi regner det selv
 *
 * `oklch()` i CSS finnes, men ikke i alle nettlesere appen kjører i — og en ugyldig
 * fargeverdi gir en gjennomsiktig celle, altså en kalender som ser ødelagt ut
 * framfor en farge som ser litt annerledes ut. Regner vi den til hex i domenelaget,
 * virker den overalt, og fargene kan valideres av samme verktøy som resten av
 * paletten.
 *
 * ## Hvorfor OKLCH og ikke HSL
 *
 * OKLCH er perseptuelt jevn: like store steg i `L` ser like store ut. I HSL er
 * `lightness` en regnestørrelse — gul på 50 % ser mye lysere ut enn blå på 50 % —
 * så en «lys → mørk»-skala i HSL blir ujevn på en måte leseren tolker som data.
 */

/** Lysheten i OKLCH der et tall skal bytte fra lys til mørk skrift. */
export const INK_FLIP_L = 0.62;

function gammaEncode(channel: number): number {
	return channel <= 0.0031308
		? 12.92 * channel
		: 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

/** OKLab → lineær sRGB. Matrisene er fra Björn Ottossons oklab-artikkel. */
function oklabToLinearSrgb(L: number, a: number, b: number): [number, number, number] {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
	];
}

function inGamut([r, g, b]: [number, number, number]): boolean {
	// Litt slark: avrundingen til to hex-siffer tar igjen de siste promillene.
	const lo = -0.0005;
	const hi = 1.0005;
	return r >= lo && r <= hi && g >= lo && g <= hi && b >= lo && b <= hi;
}

function toHex([r, g, b]: [number, number, number]): string {
	const channel = (value: number) =>
		Math.round(Math.min(1, Math.max(0, gammaEncode(value))) * 255)
			.toString(16)
			.padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * OKLCH → hex.
 *
 * Utenfor sRGB reduseres KROMA til fargen er innenfor, aldri lysheten eller
 * kuløren: et lysere gult ville brutt en lys→mørk-skala, og en dreid kulør ville
 * flyttet «lang tur» mot en annen betydning. Metning er den ene av de tre som kan
 * gi seg uten at skalaen lyver.
 */
export function oklchToHex(L: number, C: number, hueDeg: number): string {
	const lightness = Math.min(1, Math.max(0, L));
	const hue = (hueDeg * Math.PI) / 180;

	let chroma = Math.max(0, C);
	for (let i = 0; i < 24; i++) {
		const rgb = oklabToLinearSrgb(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue));
		if (inGamut(rgb)) return toHex(rgb);
		chroma -= 0.006;
		if (chroma <= 0) break;
	}

	return toHex(oklabToLinearSrgb(lightness, 0, 0));
}

/** Skriftfarge som holder kontrasten på en farget flate. */
export function inkForLightness(L: number, opts: { dark?: string; light?: string } = {}): string {
	return L >= INK_FLIP_L ? (opts.dark ?? '#14130f') : (opts.light ?? '#f2eee4');
}
