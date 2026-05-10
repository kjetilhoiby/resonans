import { db } from '$lib/db';
import { persons, personRelations } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { PersonKind, RelationType, RelationSubType } from '$lib/domains/family';

export type CreatePersonInput = {
	userId: string;
	name: string;
	fullName?: string | null;
	nickname?: string | null;
	birthDate?: string | null; // ISO date 'YYYY-MM-DD'
	kind?: PersonKind;
	avatarEmoji?: string | null;
	photoUrl?: string | null;
	notes?: string | null;
	spondGroupIds?: string[];
	emailAddresses?: string[];
	aliases?: string[];
};

export type UpdatePersonInput = Partial<Omit<CreatePersonInput, 'userId'>> & {
	archived?: boolean;
};

export type CreateRelationInput = {
	userId: string;
	fromPersonId: string | null; // null = self
	toPersonId: string;
	relationType: RelationType;
	subType?: RelationSubType | null;
	closeness?: number | null;
	notes?: string | null;
};

export class PersonService {
	static async listForUser(userId: string, options?: { includeArchived?: boolean }) {
		const where = options?.includeArchived
			? eq(persons.userId, userId)
			: and(eq(persons.userId, userId), eq(persons.archived, false));
		return db.select().from(persons).where(where).orderBy(persons.kind, persons.name);
	}

	static async getById(id: string, userId: string) {
		const rows = await db
			.select()
			.from(persons)
			.where(and(eq(persons.id, id), eq(persons.userId, userId)))
			.limit(1);
		return rows[0] ?? null;
	}

	static async findBySpondGroupId(userId: string, groupId: string) {
		const all = await this.listForUser(userId);
		return all.find((p) => p.spondGroupIds.includes(groupId)) ?? null;
	}

	static async findByEmail(userId: string, email: string) {
		const normalized = email.trim().toLowerCase();
		if (!normalized) return null;
		const all = await this.listForUser(userId);
		return (
			all.find((p) => p.emailAddresses.some((e) => e.toLowerCase() === normalized)) ?? null
		);
	}

	static async create(input: CreatePersonInput) {
		const [row] = await db
			.insert(persons)
			.values({
				userId: input.userId,
				name: input.name.trim(),
				fullName: input.fullName ?? null,
				nickname: input.nickname ?? null,
				birthDate: input.birthDate ?? null,
				kind: input.kind ?? 'other',
				avatarEmoji: input.avatarEmoji ?? null,
				photoUrl: input.photoUrl ?? null,
				notes: input.notes ?? null,
				spondGroupIds: input.spondGroupIds ?? [],
				emailAddresses: input.emailAddresses ?? [],
				aliases: input.aliases ?? []
			})
			.returning();
		return row;
	}

	static async update(id: string, userId: string, patch: UpdatePersonInput) {
		const set: Record<string, unknown> = { updatedAt: new Date() };
		if (patch.name !== undefined) set.name = patch.name.trim();
		if (patch.fullName !== undefined) set.fullName = patch.fullName;
		if (patch.nickname !== undefined) set.nickname = patch.nickname;
		if (patch.birthDate !== undefined) set.birthDate = patch.birthDate;
		if (patch.kind !== undefined) set.kind = patch.kind;
		if (patch.avatarEmoji !== undefined) set.avatarEmoji = patch.avatarEmoji;
		if (patch.photoUrl !== undefined) set.photoUrl = patch.photoUrl;
		if (patch.notes !== undefined) set.notes = patch.notes;
		if (patch.spondGroupIds !== undefined) set.spondGroupIds = patch.spondGroupIds;
		if (patch.emailAddresses !== undefined) set.emailAddresses = patch.emailAddresses;
		if (patch.aliases !== undefined) set.aliases = patch.aliases;
		if (patch.archived !== undefined) set.archived = patch.archived;
		const [row] = await db
			.update(persons)
			.set(set)
			.where(and(eq(persons.id, id), eq(persons.userId, userId)))
			.returning();
		return row ?? null;
	}

	static async archive(id: string, userId: string) {
		return this.update(id, userId, { archived: true });
	}

	static async addSpondGroup(id: string, userId: string, groupId: string) {
		const person = await this.getById(id, userId);
		if (!person) return null;
		if (person.spondGroupIds.includes(groupId)) return person;
		return this.update(id, userId, {
			spondGroupIds: [...person.spondGroupIds, groupId]
		});
	}

	static async listRelations(userId: string) {
		return db
			.select()
			.from(personRelations)
			.where(eq(personRelations.userId, userId))
			.orderBy(personRelations.createdAt);
	}

	static async createRelation(input: CreateRelationInput) {
		const [row] = await db
			.insert(personRelations)
			.values({
				userId: input.userId,
				fromPersonId: input.fromPersonId ?? null,
				toPersonId: input.toPersonId,
				relationType: input.relationType,
				subType: input.subType ?? null,
				closeness: input.closeness ?? null,
				notes: input.notes ?? null
			})
			.onConflictDoNothing()
			.returning();
		return row ?? null;
	}

	static async deleteRelation(id: string, userId: string) {
		const result = await db
			.delete(personRelations)
			.where(and(eq(personRelations.id, id), eq(personRelations.userId, userId)))
			.returning();
		return result[0] ?? null;
	}

	// Returnerer alle navn/aliaser for en bruker som kan brukes til mention-matching.
	/**
	 * Returns role-based tokens for each person derived from kind + birth-date ordering.
	 * E.g. the oldest child gets ["eldste","eldstemann"], partner gets ["kona","mann","samboer"].
	 */
	static computeRoleTokens(persons: { id: string; kind: string; birthDate: string | null }[]): Map<string, string[]> {
		const map = new Map<string, string[]>();
		const add = (id: string, tokens: string[]) => map.set(id, [...(map.get(id) ?? []), ...tokens]);

		for (const p of persons) {
			if (p.kind === 'partner') {
				add(p.id, ['kona', 'mann', 'samboer', 'kjæreste', 'partner', 'mannen', 'kona mi', 'mannen min', 'partneren min']);
			}
			if (p.kind === 'parent') {
				add(p.id, ['pappa', 'far', 'mamma', 'mor', 'forelderen', 'foreldre']);
			}
			if (p.kind === 'sibling') {
				add(p.id, ['søster', 'bror', 'søsken', 'broren', 'søsteren']);
			}
		}

		const children = persons
			.filter((p) => p.kind === 'child')
			.sort((a, b) => {
				if (!a.birthDate && !b.birthDate) return 0;
				if (!a.birthDate) return 1;
				if (!b.birthDate) return -1;
				return a.birthDate.localeCompare(b.birthDate);
			});

		if (children.length >= 1) {
			add(children[0].id, ['eldste', 'eldstemann', 'eldstedatter', 'storebror', 'storesøster', 'eldstebarnet']);
		}
		if (children.length >= 2) {
			add(children[children.length - 1].id, ['minste', 'minstemann', 'yngste', 'lillebror', 'lillesøster', 'yngstebarnet']);
		}
		if (children.length === 3) {
			add(children[1].id, ['mellomste', 'midterste', 'midtbarnet']);
		}

		return map;
	}

	static async findByName(userId: string, name: string) {
		const normalized = name.trim().toLowerCase();
		if (!normalized) return null;
		const all = await this.listForUser(userId);

		// 1. Exact name / alias / nickname match
		const byName = all.find((p) => {
			if (p.name.toLowerCase() === normalized) return true;
			if (p.fullName?.toLowerCase() === normalized) return true;
			if (p.nickname?.toLowerCase() === normalized) return true;
			return p.aliases.some((a) => a.toLowerCase() === normalized);
		});
		if (byName) return byName;

		// 2. Role token fallback ("kona" → partner, "eldste" → oldest child, etc.)
		const roleMap = this.computeRoleTokens(all);
		for (const [personId, tokens] of roleMap) {
			if (tokens.some((t) => t.toLowerCase() === normalized)) {
				return all.find((p) => p.id === personId) ?? null;
			}
		}
		return null;
	}

	static async getMentionLexicon(userId: string): Promise<Array<{ personId: string; tokens: string[] }>> {
		const all = await this.listForUser(userId);
		const roleMap = this.computeRoleTokens(all);
		return all.map((p) => {
			const tokens = new Set<string>();
			if (p.name) tokens.add(p.name);
			if (p.fullName) tokens.add(p.fullName);
			if (p.nickname) tokens.add(p.nickname);
			for (const a of p.aliases) tokens.add(a);
			for (const t of roleMap.get(p.id) ?? []) tokens.add(t);
			return {
				personId: p.id,
				tokens: Array.from(tokens)
					.map((t) => t.trim())
					.filter((t) => t.length >= 2)
			};
		});
	}
}
