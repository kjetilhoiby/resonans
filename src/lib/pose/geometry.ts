/**
 * Rene geometri-hjelpere for pose-analyse. Skala- og posisjonsinvariante der
 * det gir mening — vinkler avhenger kun av punktenes innbyrdes geometri, ikke
 * av kameraavstand eller speiling.
 */
import type { Keypoint } from './types';

/**
 * Vinkelen ved punkt `b` mellom `a` og `c`, i grader (0–180).
 *
 * ```
 * angle(a, b, c) = acos( clamp((u·v)/(|u||v|), -1, 1) ) · 180/π
 *    der u = a − b, v = c − b
 * ```
 *
 * Returnerer `null` hvis en av vektorene har lengde 0 (degenerert). Vinkelen er
 * refleksjons-invariant: en y-flippet frame gir samme vinkel.
 */
export function angle(a: Keypoint, b: Keypoint, c: Keypoint): number | null {
	const ux = a.x - b.x;
	const uy = a.y - b.y;
	const vx = c.x - b.x;
	const vy = c.y - b.y;
	const lu = Math.hypot(ux, uy);
	const lv = Math.hypot(vx, vy);
	if (lu === 0 || lv === 0) return null;
	const cos = (ux * vx + uy * vy) / (lu * lv);
	const clamped = Math.max(-1, Math.min(1, cos));
	return (Math.acos(clamped) * 180) / Math.PI;
}
