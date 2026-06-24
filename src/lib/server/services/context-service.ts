import { db } from '$lib/db';
import { memories, themeFiles, planArtifacts, cutLists } from '$lib/db/schema';
import { and, desc, eq, gte } from 'drizzle-orm';
import { getRecentReflections } from '$lib/server/reflections';
import { DreamService } from '$lib/server/services/dream-service';
import { touchMemory } from '$lib/server/memories';
import { computeCutList, formatNok } from '$lib/kappliste/calc';

interface BuildContextArgs {
	userId: string;
	themeId?: string | null;
}

/**
 * ContextService er den eneste lese-inngangen chat-promptet trenger. Plukker
 * fra alle relevante kilder (dreams, memories, refleksjoner, plan-artefakter,
 * tema-filer) og returnerer ferdig-formatert tekst klar for system-prompt.
 *
 * Gjør memories.ts ren CRUD igjen.
 */
export class ContextService {
	static async buildForChat({ userId, themeId }: BuildContextArgs): Promise<string> {
		const [fileBlock, cutListBlock, dreamBlock, visionBlock, memoriesBlock, plansBlock, reflectionsBlock] = await Promise.all([
			this.themeFiles(userId, themeId),
			this.cutLists(userId, themeId),
			this.activeDream(userId),
			this.activeVision(userId),
			this.stableMemories(userId),
			this.recentPlans(userId),
			this.recentReflections(userId)
		]);

		const sections = [fileBlock, cutListBlock, dreamBlock, visionBlock, memoriesBlock.text, plansBlock, reflectionsBlock]
			.filter(Boolean)
			.join('');

		// Touch memories etter all annen lesning for å ikke blokkere prompt-bygging.
		void Promise.all(memoriesBlock.touchedIds.map((id) => touchMemory(id)));

		return sections || '\n--- MEMORIES ---\nIngen lagrede memories ennå.\n--- SLUTT PÅ MEMORIES ---\n';
	}

	private static async themeFiles(userId: string, themeId?: string | null): Promise<string> {
		if (!themeId) return '';
		const files = await db.query.themeFiles.findMany({
			where: and(eq(themeFiles.themeId, themeId), eq(themeFiles.userId, userId)),
			orderBy: [desc(themeFiles.createdAt)]
		});
		const withContent = files.filter((f) => f.parsedContent && f.parsedContent.trim().length > 0);
		if (withContent.length === 0) return '';

		let out = '\n--- FILER I TEMAET (opplastet innhold) ---\n';
		for (const file of withContent) out += `\n${file.parsedContent}\n`;
		out += '--- SLUTT PÅ TEMA-FILER ---\n';
		return out;
	}

	private static async cutLists(userId: string, themeId?: string | null): Promise<string> {
		if (!themeId) return '';
		const lists = await db.query.cutLists.findMany({
			where: and(eq(cutLists.themeId, themeId), eq(cutLists.userId, userId)),
			orderBy: [desc(cutLists.createdAt)]
		});
		const withMaterials = lists.filter((l) => (l.materials ?? []).length > 0);
		if (withMaterials.length === 0) return '';

		let out = '\n--- KAPPLISTER I PROSJEKTET (materialberegning) ---\n';
		for (const list of withMaterials) {
			const res = computeCutList(list.materials ?? [], list.kerfMm);
			out += `\n${list.title}:\n`;
			for (const mat of res.materials) {
				if (mat.tooBig.length > 0) {
					out += `  → ${mat.name || mat.unitLabel}: kapp ${mat.tooBig.join(', ')} er for store for ${mat.stockLabel}\n`;
				} else {
					out += `  → ${mat.name || mat.unitLabel}: ${mat.stockNeeded} × ${mat.unitLabel} (${mat.stockLabel}), ${formatNok(mat.costNok)}\n`;
				}
			}
			if (!res.hasErrors) out += `  → Totalt: ${formatNok(res.totalCostNok)}\n`;
		}
		out += '--- SLUTT PÅ KAPPLISTER ---\n';
		return out;
	}

	private static async activeDream(userId: string): Promise<string> {
		const dream = await DreamService.getActive(userId, 'daily_dream');
		if (!dream || !dream.summary) return '';
		const h = (dream.highlights ?? {}) as { mode?: string; rationale?: string };
		let out = '\n--- DAGENS DRØM (LLM-syntese, ferdig komprimert) ---\n';
		out += `${dream.summary}\n`;
		if (h.mode) out += `Anbefalt modus: ${h.mode}${h.rationale ? ` — ${h.rationale}` : ''}\n`;
		out += '--- SLUTT PÅ DRØM ---\n';
		return out;
	}

	private static async activeVision(userId: string): Promise<string> {
		const horizons = ['vision_5year', 'vision_yearly', 'vision_quarterly'] as const;
		const found = await Promise.all(horizons.map((k) => DreamService.getActive(userId, k)));
		const visions = found.filter((v): v is NonNullable<typeof v> => Boolean(v?.summary));
		if (visions.length === 0) return '';

		let out = '\n--- LANGSIKTIG RETNING (visjon) ---\n';
		for (const v of visions) {
			const label =
				v.kind === 'vision_5year' ? '5 år frem' :
				v.kind === 'vision_yearly' ? 'i år' :
				v.kind === 'vision_quarterly' ? 'kommende kvartal' : v.kind;
			out += `[${label}] ${v.summary}\n`;
		}
		out += '--- SLUTT PÅ VISJON ---\n';
		return out;
	}

	private static async stableMemories(userId: string) {
		const rows = await db.query.memories.findMany({
			where: eq(memories.userId, userId),
			orderBy: [desc(memories.importance), desc(memories.lastAccessedAt)],
			limit: 20
		});
		if (rows.length === 0) return { text: '', touchedIds: [] };

		const categorized = rows.reduce((acc, mem) => {
			(acc[mem.category] ??= []).push(mem);
			return acc;
		}, {} as Record<string, typeof rows>);

		let text = '\n--- MEMORIES (Stabile fakta om brukeren) ---\n';
		for (const [category, mems] of Object.entries(categorized)) {
			text += `\n${category.toUpperCase()}:\n`;
			for (const mem of mems) {
				const sym = mem.importance === 'high' ? '⭐' : mem.importance === 'medium' ? '•' : '-';
				text += `${sym} ${mem.content}\n`;
			}
		}
		text += '\n--- SLUTT PÅ MEMORIES ---\n';
		return { text, touchedIds: rows.map((r) => r.id) };
	}

	private static async recentPlans(userId: string): Promise<string> {
		const since = new Date();
		since.setDate(since.getDate() - 7);
		const rows = await db.query.planArtifacts.findMany({
			where: and(eq(planArtifacts.userId, userId), gte(planArtifacts.updatedAt, since)),
			orderBy: [desc(planArtifacts.updatedAt)],
			limit: 6
		});
		if (rows.length === 0) return '';

		let out = '\n--- AKTIVE PLANER (siste 7 dager) ---\n';
		for (const plan of rows) {
			const fields: string[] = [];
			if (plan.headline) fields.push(`overskrift: ${plan.headline}`);
			if (plan.note) fields.push(`notat: ${plan.note}`);
			if (plan.reflection) fields.push(`refleksjon: ${plan.reflection}`);
			if (plan.vision) fields.push(`visjon: ${plan.vision}`);
			if (fields.length === 0) continue;
			out += `${plan.kind} ${plan.periodKey}: ${fields.join(' | ')}\n`;
		}
		out += '--- SLUTT PÅ PLANER ---\n';
		return out;
	}

	private static async recentReflections(userId: string): Promise<string> {
		const rows = await getRecentReflections(userId, { sinceDays: 7, limit: 6 });
		if (rows.length === 0) return '';
		let out = '\n--- SISTE REFLEKSJONER ---\n';
		for (const ref of rows) {
			const dateStr = ref.createdAt.toISOString().slice(0, 10);
			out += `[${ref.kind} · ${dateStr}] ${ref.content}\n`;
		}
		out += '--- SLUTT PÅ REFLEKSJONER ---\n';
		return out;
	}
}
