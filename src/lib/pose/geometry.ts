/**
 * Ren geometri for pose-analyse. Ingen avhengigheter, ingen tilstand —
 * lett å enhetsteste.
 */

import type { Keypoint } from './types';

export interface Point {
	x: number;
	y: number;
}

/** Euklidsk avstand mellom to punkter. */
export function distance(a: Point, b: Point): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midtpunkt mellom to punkter. */
export function midpoint(a: Point, b: Point): Point {
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Vinkel (i grader, 0..180) ved toppunktet `b` i trekanten a–b–c.
 * Brukes bl.a. som albuevinkel (skulder–albue–håndledd): ~180° = strak arm,
 * liten vinkel = bøyd arm. Returnerer null hvis et ben har lengde 0.
 */
export function angleDeg(a: Point, b: Point, c: Point): number | null {
	const v1 = { x: a.x - b.x, y: a.y - b.y };
	const v2 = { x: c.x - b.x, y: c.y - b.y };
	const mag1 = Math.hypot(v1.x, v1.y);
	const mag2 = Math.hypot(v2.x, v2.y);
	if (mag1 === 0 || mag2 === 0) return null;

	const cos = (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2);
	// Klem mot [-1, 1] for å unngå NaN fra flyttallsstøy.
	const clamped = Math.min(1, Math.max(-1, cos));
	return (Math.acos(clamped) * 180) / Math.PI;
}

/**
 * Gjennomsnitt av to vinkler der begge, én eller ingen kan mangle (null).
 * Returnerer null bare hvis begge mangler.
 */
export function averageAngle(a: number | null, b: number | null): number | null {
	if (a != null && b != null) return (a + b) / 2;
	return a ?? b ?? null;
}

/** Er punktet til stede og over konfidensgrensen? */
export function isVisible(point: Keypoint | undefined, minScore: number): point is Keypoint {
	return !!point && point.score >= minScore;
}
