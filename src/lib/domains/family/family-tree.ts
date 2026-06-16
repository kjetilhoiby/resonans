// Bygger en hierarkisk treestruktur fra persons + person_relations.
// Treet brukes til visualisering av familietre i FamilyTree.svelte.

import type { PersonKind, RelationType, RelationSubType } from './index';

export interface PersonNode {
	id: string;
	name: string;
	kind: PersonKind;
	avatarEmoji: string | null;
	photoUrl: string | null;
	birthDate: string | null;
	archived: boolean;
}

export interface RelationEdge {
	id: string;
	fromPersonId: string | null; // null = self
	toPersonId: string;
	relationType: RelationType;
	subType: RelationSubType | null;
	closeness: number | null;
}

export interface FamilyTree {
	self: { id: 'self'; label: string };
	nodes: PersonNode[];
	edges: RelationEdge[];
	// Pre-grupperte hjelpestrukturer for visning
	byKind: Record<PersonKind, PersonNode[]>;
	byRelationType: Record<RelationType, PersonNode[]>;
}

export function buildFamilyTree(
	persons: PersonNode[],
	relations: RelationEdge[],
	selfLabel = 'Meg'
): FamilyTree {
	const active = persons.filter((p) => !p.archived);

	const byKind = {} as Record<PersonKind, PersonNode[]>;
	for (const p of active) {
		(byKind[p.kind] ??= []).push(p);
	}

	const byRelationType: Record<RelationType, PersonNode[]> = {
		family: [],
		friend: [],
		work: []
	};
	for (const edge of relations) {
		const target = active.find((p) => p.id === edge.toPersonId);
		if (!target) continue;
		const list = byRelationType[edge.relationType];
		if (list && !list.some((p) => p.id === target.id)) list.push(target);
	}
	// Personer uten eksplisitt relasjon havner under sitt nærmeste relasjons-tilhørighet via kind
	for (const p of active) {
		const kind = p.kind;
		const inferred: RelationType =
			kind === 'colleague' ? 'work' : kind === 'friend' ? 'friend' : 'family';
		const bucket = byRelationType[inferred];
		if (!bucket.some((q) => q.id === p.id)) bucket.push(p);
	}

	return {
		self: { id: 'self', label: selfLabel },
		nodes: active,
		edges: relations,
		byKind,
		byRelationType
	};
}

// Returnerer barn (kind='child') sortert på fødselsdato (eldst først).
export function getChildren(tree: FamilyTree): PersonNode[] {
	const children = tree.byKind.child ?? [];
	return [...children].sort((a, b) => {
		if (!a.birthDate) return 1;
		if (!b.birthDate) return -1;
		return a.birthDate.localeCompare(b.birthDate);
	});
}

export function getPartners(tree: FamilyTree): PersonNode[] {
	return tree.byKind.partner ?? [];
}

export function getInLaws(tree: FamilyTree): PersonNode[] {
	return tree.byKind.in_law ?? [];
}

export function calculateAge(birthDate: string | null, today = new Date()): number | null {
	if (!birthDate) return null;
	const bd = new Date(birthDate);
	if (Number.isNaN(bd.getTime())) return null;
	let age = today.getFullYear() - bd.getFullYear();
	const m = today.getMonth() - bd.getMonth();
	if (m < 0 || (m === 0 && today.getDate() < bd.getDate())) age--;
	return age;
}

// Antall dager til neste bursdag (0 = i dag, 365 = om et år).
export function daysUntilBirthday(birthDate: string | null, today = new Date()): number | null {
	if (!birthDate) return null;
	const bd = new Date(birthDate);
	if (Number.isNaN(bd.getTime())) return null;
	// Sammenlign på kalenderdag, ikke klokkeslett — ellers ruller bursdagen i dag
	// (midnatt < «nå») et helt år frem og gir 364 i stedet for 0.
	const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const next = new Date(todayMidnight.getFullYear(), bd.getMonth(), bd.getDate());
	if (next < todayMidnight) next.setFullYear(todayMidnight.getFullYear() + 1);
	const ms = next.getTime() - todayMidnight.getTime();
	return Math.round(ms / (1000 * 60 * 60 * 24));
}
