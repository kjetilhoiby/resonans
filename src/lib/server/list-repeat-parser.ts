type ParsedRepeat = {
	repeatCount: number;
	label: string;
};

const NUMBER_WORDS: Record<string, number> = {
	en: 1,
	ett: 1,
	to: 2,
	tre: 3,
	fire: 4,
	fem: 5,
	seks: 6,
	syv: 7,
	sju: 7,
	atte: 8,
	ni: 9,
	ti: 10
};

function parseCountToken(token: string): number | null {
	const normalized = token.trim().toLowerCase();
	if (/^\d+$/.test(normalized)) {
		const n = Number(normalized);
		return Number.isFinite(n) ? n : null;
	}
	return NUMBER_WORDS[normalized] ?? null;
}

function clampCount(value: number, maxCount: number) {
	if (!Number.isFinite(value)) return 1;
	return Math.min(Math.max(Math.floor(value), 1), Math.max(1, maxCount));
}

export function parseListRepeatCount(raw: string, requestedCount = 1, maxCount = 12): ParsedRepeat {
	const text = raw.trim();
	if (!text) {
		return {
			repeatCount: clampCount(requestedCount, maxCount),
			label: ''
		};
	}

	const prefixMatch = text.match(/^(\d{1,2})\s+(.+)$/);
	if (prefixMatch) {
		const prefixCount = Number.parseInt(prefixMatch[1], 10);
		const fromText = clampCount(prefixCount, maxCount);
		const fromRequest = clampCount(requestedCount, maxCount);
		return {
			repeatCount: Math.max(fromText, fromRequest),
			label: prefixMatch[2].trim()
		};
	}

	const freqPattern = /(\d+|en|ett|to|tre|fire|fem|seks|syv|sju|atte|ni|ti)\s+ganger\s+(i|per|pr\.?)\s+(dag|uke|måned)/i;
	const freqMatch = text.match(freqPattern);
	if (freqMatch) {
		const parsedCount = parseCountToken(freqMatch[1]) ?? 1;
		const fromText = clampCount(parsedCount, maxCount);
		const fromRequest = clampCount(requestedCount, maxCount);
		let label = text.replace(freqPattern, ' ').replace(/\s{2,}/g, ' ').trim();
		label = label.replace(/^[-:;,\s]+|[-:;,\s]+$/g, '');
		if (!label) label = text;
		return {
			repeatCount: Math.max(fromText, fromRequest),
			label
		};
	}

	if (/\bhver\s+dag\b/i.test(text) || /\bdaglig\b/i.test(text)) {
		return {
			repeatCount: Math.max(1, clampCount(requestedCount, maxCount)),
			label: text
		};
	}

	return {
		repeatCount: clampCount(requestedCount, maxCount),
		label: text
	};
}

export function expandRepeatedListItems(inputItems: string[], maxCount = 12): string[] {
	const expanded: string[] = [];
	for (const raw of inputItems) {
		const parsed = parseListRepeatCount(raw, 1, maxCount);
		if (!parsed.label) continue;
		if (parsed.repeatCount <= 1) {
			expanded.push(parsed.label);
			continue;
		}
		for (let i = 0; i < parsed.repeatCount; i += 1) {
			expanded.push(`${parsed.label} (${i + 1}/${parsed.repeatCount})`);
		}
	}
	return expanded;
}
