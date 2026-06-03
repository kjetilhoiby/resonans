import { describe, it, expect } from 'vitest';
import { activityTypeEmoji, groupChecklistItems } from './checklist-group';

describe('activityTypeEmoji', () => {
	it('kjente aktivitetstyper', () => {
		expect(activityTypeEmoji('yoga')).toBe('🧘');
		expect(activityTypeEmoji('cycling')).toBe('🚴');
		expect(activityTypeEmoji('ebike')).toBe('🚴');
		expect(activityTypeEmoji('strength')).toBe('🏋️');
		expect(activityTypeEmoji('running')).toBe('🏃');
	});

	it('ukjent type → fallback ✅', () => {
		expect(activityTypeEmoji('whatever')).toBe('✅');
	});
});

describe('groupChecklistItems', () => {
	it('grupperer repeat-slots og lar enkeltpunkter være single', () => {
		const items = [
			{ text: 'Yoga (1/3)' },
			{ text: 'Yoga (2/3)' },
			{ text: 'Yoga (3/3)' },
			{ text: 'Handle' }
		];
		const groups = groupChecklistItems(items);
		const group = groups.find((g) => g.type === 'group');
		expect(group?.type).toBe('group');
		if (group?.type === 'group') expect(group.items.length).toBe(3);
		expect(groups.some((g) => g.type === 'single')).toBe(true);
	});
});
