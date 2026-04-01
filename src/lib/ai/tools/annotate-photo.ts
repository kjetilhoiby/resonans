export interface PointNorm {
	x: number;
	y: number;
}

export type CompositionOverlay =
	| {
		kind: 'line';
		start: PointNorm;
		end: PointNorm;
		label?: string;
		color?: string;
	}
	| {
		kind: 'rectangle';
		x: number;
		y: number;
		width: number;
		height: number;
		label?: string;
		color?: string;
	}
	| {
		kind: 'circle';
		cx: number;
		cy: number;
		r: number;
		label?: string;
		color?: string;
	}
	| {
		kind: 'polygon';
		points: PointNorm[];
		label?: string;
		color?: string;
	}
	| {
		kind: 'label';
		x: number;
		y: number;
		text: string;
		color?: string;
	};

export interface PhotoAnnotationResult {
	kind: 'photo_composition';
	summary: string;
	overlays: CompositionOverlay[];
}

function clamp01(value: number) {
	if (Number.isNaN(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function normalizeColor(color?: string) {
	if (!color) return '#6ee7b7';
	return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6ee7b7';
}

function normalizePoint(point: PointNorm): PointNorm {
	return {
		x: clamp01(point.x),
		y: clamp01(point.y)
	};
}

function normalizeOverlay(overlay: CompositionOverlay): CompositionOverlay {
	if (overlay.kind === 'line') {
		return {
			...overlay,
			start: normalizePoint(overlay.start),
			end: normalizePoint(overlay.end),
			label: overlay.label?.slice(0, 120),
			color: normalizeColor(overlay.color)
		};
	}

	if (overlay.kind === 'rectangle') {
		return {
			...overlay,
			x: clamp01(overlay.x),
			y: clamp01(overlay.y),
			width: clamp01(overlay.width),
			height: clamp01(overlay.height),
			label: overlay.label?.slice(0, 120),
			color: normalizeColor(overlay.color)
		};
	}

	if (overlay.kind === 'circle') {
		return {
			...overlay,
			cx: clamp01(overlay.cx),
			cy: clamp01(overlay.cy),
			r: clamp01(overlay.r),
			label: overlay.label?.slice(0, 120),
			color: normalizeColor(overlay.color)
		};
	}

	if (overlay.kind === 'polygon') {
		return {
			...overlay,
			points: overlay.points.slice(0, 8).map(normalizePoint),
			label: overlay.label?.slice(0, 120),
			color: normalizeColor(overlay.color)
		};
	}

	return {
		...overlay,
		x: clamp01(overlay.x),
		y: clamp01(overlay.y),
		text: overlay.text.slice(0, 120),
		color: normalizeColor(overlay.color)
	};
}

export const annotatePhotoCompositionTool = {
	name: 'annotate_photo_composition',
	description:
		'Annoter et bilde med komposisjons-overlays (ledende linjer, fokusområder, tredjedelslinjer). Brukes når bruker ønsker visuell fotoanalyse.',

	execute: async (args: {
		imageUrl: string;
		summary: string;
		overlays: CompositionOverlay[];
	}) => {
		const imageUrl = typeof args.imageUrl === 'string' ? args.imageUrl.trim() : '';
		if (!imageUrl) {
			return {
				success: false,
				message: 'imageUrl mangler for bildeannotering.'
			};
		}

		const rawOverlays = Array.isArray(args.overlays) ? args.overlays : [];
		const overlays = rawOverlays.slice(0, 24).map((overlay) => normalizeOverlay(overlay));

		const annotation: PhotoAnnotationResult = {
			kind: 'photo_composition',
			summary: typeof args.summary === 'string' && args.summary.trim().length > 0
				? args.summary.trim().slice(0, 400)
				: 'Komposisjonsanalyse med visuelt markerte grep.',
			overlays
		};

		return {
			success: true,
			annotation,
			message: 'Bildeannotering klar.'
		};
	}
};
