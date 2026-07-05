/**
 * Konvertering av GPT-4o sin prosentbaserte bounding-box for et bokomslag
 * til en piksel-crop som kan brukes i en Cloudinary-transformasjon.
 */

export interface PctBox {
	x: number; // prosent fra venstre (0–100)
	y: number; // prosent fra topp (0–100)
	w: number; // bredde i prosent (0–100)
	h: number; // høyde i prosent (0–100)
}

export interface PixelCrop {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Parser ukjent JSON-verdi til en gyldig PctBox, eller null. */
export function parsePctBox(value: unknown): PctBox | null {
	if (!value || typeof value !== 'object') return null;
	const box = value as Record<string, unknown>;
	const nums = [box.x, box.y, box.w, box.h];
	if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
	const { x, y, w, h } = box as unknown as PctBox;
	if (x < 0 || x > 100 || y < 0 || y > 100) return null;
	if (w <= 0 || h <= 0 || w > 100 || h > 100) return null;
	if (x + w > 100.5 || y + h > 100.5) return null; // liten slingring for avrunding
	return { x, y, w, h };
}

/**
 * Gjør en prosent-boks om til en piksel-crop, med litt utvendig margin
 * (GPT-bokser er upresise — heller litt bakgrunn enn avkuttet omslag),
 * klemt til bildets grenser.
 *
 * Returnerer null hvis boksen er usannsynlig liten (et omslag i et
 * skjermbilde dekker alltid en vesentlig del av bildet).
 */
export function pctBoxToPixelCrop(
	box: PctBox,
	imageWidth: number,
	imageHeight: number,
	marginPct = 2
): PixelCrop | null {
	if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null;
	if (imageWidth <= 0 || imageHeight <= 0) return null;

	// Usannsynlig lite omslag → antakelig feildeteksjon
	if (box.w < 15 || box.h < 8) return null;

	const x0 = Math.max(0, ((box.x - marginPct) / 100) * imageWidth);
	const y0 = Math.max(0, ((box.y - marginPct) / 100) * imageHeight);
	const x1 = Math.min(imageWidth, ((box.x + box.w + marginPct) / 100) * imageWidth);
	const y1 = Math.min(imageHeight, ((box.y + box.h + marginPct) / 100) * imageHeight);

	const width = Math.round(x1 - x0);
	const height = Math.round(y1 - y0);
	if (width <= 0 || height <= 0) return null;

	return { x: Math.round(x0), y: Math.round(y0), width, height };
}
