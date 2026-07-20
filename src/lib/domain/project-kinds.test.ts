import { describe, it, expect } from 'vitest';
import {
	resolveProjectKind,
	projectTabsForKind,
	projectHasContacts,
	isProjectKind,
	PROJECT_KINDS,
	DEFAULT_PROJECT_KIND
} from './project-kinds';

describe('project-kinds', () => {
	it('faller tilbake til bygg når kind mangler', () => {
		expect(resolveProjectKind(null).key).toBe('bygg');
		expect(resolveProjectKind(undefined).key).toBe('bygg');
		expect(resolveProjectKind({}).key).toBe('bygg');
		expect(DEFAULT_PROJECT_KIND).toBe('bygg');
	});

	it('faller tilbake til bygg for ukjent kind', () => {
		expect(resolveProjectKind({ kind: 'noe-rart' }).key).toBe('bygg');
		expect(resolveProjectKind('tull').key).toBe('bygg');
	});

	it('slår opp riktig type fra profil eller streng', () => {
		expect(resolveProjectKind({ kind: 'kommunikasjon' }).key).toBe('kommunikasjon');
		expect(resolveProjectKind('arrangement').key).toBe('arrangement');
	});

	it('bygg-prosjekt beholder dagens faner (chat, oppgaver, kapp, filer)', () => {
		expect(projectTabsForKind({ kind: 'bygg' })).toEqual(['chat', 'oppgaver', 'kapp', 'filer']);
		// Eldre prosjekter uten kind skal oppføre seg identisk med bygg.
		expect(projectTabsForKind(null)).toEqual(['chat', 'oppgaver', 'kapp', 'filer']);
	});

	it('kommunikasjonsprosjekt dropper kappliste og får kontakter', () => {
		const tabs = projectTabsForKind({ kind: 'kommunikasjon' });
		expect(tabs).toEqual(['chat', 'oppgaver', 'kontakter', 'filer']);
		expect(tabs).not.toContain('kapp');
	});

	it('generelt prosjekt har verken kappliste eller kontakter', () => {
		expect(projectTabsForKind({ kind: 'generell' })).toEqual(['chat', 'oppgaver', 'filer']);
	});

	it('projectHasContacts er sann kun for typer med kontakter-fane', () => {
		expect(projectHasContacts('kommunikasjon')).toBe(true);
		expect(projectHasContacts('arrangement')).toBe(true);
		expect(projectHasContacts('bygg')).toBe(false);
		expect(projectHasContacts('innkjop')).toBe(false);
		expect(projectHasContacts('generell')).toBe(false);
	});

	it('alltid chat først og filer sist', () => {
		for (const k of PROJECT_KINDS) {
			const tabs = projectTabsForKind(k.key);
			expect(tabs[0]).toBe('chat');
			expect(tabs[tabs.length - 1]).toBe('filer');
		}
	});

	it('isProjectKind validerer nøkler', () => {
		expect(isProjectKind('bygg')).toBe(true);
		expect(isProjectKind('kommunikasjon')).toBe(true);
		expect(isProjectKind('xxx')).toBe(false);
		expect(isProjectKind(null)).toBe(false);
		expect(isProjectKind(42)).toBe(false);
	});
});
