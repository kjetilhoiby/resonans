import { describe, it, expect } from 'vitest';
import { markdownToPlain, cleanPlanField } from './plan-text';

describe('markdownToPlain', () => {
	it('fjerner fet og kursiv, beholder teksten', () => {
		expect(markdownToPlain('Her er **5 konkrete juli-mål** og *litt* til')).toBe(
			'Her er 5 konkrete juli-mål og litt til'
		);
	});

	it('fjerner overskrifter og gjør punktlister til «- »', () => {
		expect(markdownToPlain('# Tittel\n* Punkt A\n+ Punkt B\n- Punkt C')).toBe(
			'Tittel\n- Punkt A\n- Punkt B\n- Punkt C'
		);
	});

	it('beholder nummererte lister', () => {
		expect(markdownToPlain('1. **Ta en runde hver dag**\n   Se etter rot')).toBe(
			'1. Ta en runde hver dag\n   Se etter rot'
		);
	});

	it('rører ikke snake_case inne i ord', () => {
		expect(markdownToPlain('bruk running_distance her')).toBe('bruk running_distance her');
	});

	it('fjerner inline-kode og lenker', () => {
		expect(markdownToPlain('se `koden` og [dokene](https://x.no)')).toBe('se koden og dokene');
	});
});

describe('cleanPlanField', () => {
	it('fjerner innledningen «Her er et utkast:»', () => {
		expect(cleanPlanField('Her er et utkast:\n\nI juli vil jeg ha mer jevnhet.')).toBe(
			'I juli vil jeg ha mer jevnhet.'
		);
	});

	it('fjerner innledning med markdown og kolon', () => {
		const raw = 'Supert. Her er et stramt forslag til **5 konkrete juli-mål**:\n\n1. Løpe 30 km\n2. Yoga';
		expect(cleanPlanField(raw)).toBe('1. Løpe 30 km\n2. Yoga');
	});

	it('fjerner avsluttende meta-spørsmål til brukeren', () => {
		const raw =
			'I juli vil jeg ha mer jevnhet.\n\nVil du at jeg også skal koke dette ned til en **kortere versjon**, hvis du vil ha noe i din egen stil?';
		expect(cleanPlanField(raw)).toBe('I juli vil jeg ha mer jevnhet.');
	});

	it('beholder en tittel-linje som ikke er en samtale-innledning', () => {
		const raw = '**Månedsnotat for juni:**\nI juni vil jeg ha mer jevnhet.';
		expect(cleanPlanField(raw)).toBe('Månedsnotat for juni:\nI juni vil jeg ha mer jevnhet.');
	});

	it('nuller ikke ut et innhold som i sin helhet er ett spørsmål', () => {
		expect(cleanPlanField('Hva vil du oppnå?')).toBe('Hva vil du oppnå?');
	});

	it('tåler tom input', () => {
		expect(cleanPlanField('')).toBe('');
		expect(cleanPlanField('   ')).toBe('');
	});
});
