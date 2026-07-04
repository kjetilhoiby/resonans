import { describe, it, expect } from 'vitest';
import { escapeLike } from './like-escape';

describe('escapeLike', () => {
	it('escaper prosent, understrek og backslash', () => {
		expect(escapeLike('100%')).toBe('100\\%');
		expect(escapeLike('a_b')).toBe('a\\_b');
		expect(escapeLike('c:\\sti')).toBe('c:\\\\sti');
	});

	it('lar vanlig tekst være urørt', () => {
		expect(escapeLike('trening på hytta')).toBe('trening på hytta');
	});
});
