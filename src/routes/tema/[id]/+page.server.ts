import { db } from '$lib/db';
import { themes, goals, messages as messagesTable, conversations, themeFiles, themeLists, checklistItems, cutLists, projectContacts } from '$lib/db/schema';
import { mapTaskItem } from '$lib/server/project-tasks';
import { mapContact } from '$lib/server/project-contacts';
import { projectHasContacts } from '$lib/domain/project-kinds';
import { getThemeInstruction } from '$lib/server/theme-instructions';
import { ensureConversationThemeIdColumn } from '$lib/server/conversation-schema';
import { getConversationsByTheme } from '$lib/server/conversations';
import { getWorkoutContextForUser } from '$lib/server/workout-context';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { getThemeFindsByName } from '$lib/server/services/finds-service';
import { listThemeResearch } from '$lib/server/services/theme-research-service';
import { findThemeByName } from '$lib/server/themes';
import { resolveParentThemeId } from '$lib/domain/theme-hierarchy';
import { eq, and, asc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const t0 = performance.now();
	await ensureConversationThemeIdColumn();
	const selectedWorkoutId = url.searchParams.get('workout');

	// Sjekk om params.id er en UUID (inneholder bindestreker og er 36 tegn)
	const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id);
	
	let theme;
	if (isUUID) {
		// Finn tema basert på UUID
		theme = await db.query.themes.findFirst({
			where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
		});
	} else {
		// Finn tema basert på navn (for URL-er som /tema/helse)
		const themeName = params.id.charAt(0).toUpperCase() + params.id.slice(1);
		theme = await db.query.themes.findFirst({
			where: and(eq(themes.name, themeName), eq(themes.userId, locals.userId))
		});
	}

	if (!theme) {
		error(404, 'Tema ikke funnet');
	}

	// Opprett samtale for temaet om det mangler
	let conversationId = theme.conversationId;
	if (!conversationId) {
		const [conv] = await db
			.insert(conversations)
			.values({ userId: locals.userId, themeId: theme.id, title: theme.name })
			.returning({ id: conversations.id });
		await db
			.update(themes)
			.set({ conversationId: conv.id })
			.where(eq(themes.id, theme.id));
		conversationId = conv.id;
	} else {
		// Retroaktivt: koble eksisterende canonical samtale til temaet om den mangler themeId
		const existingConv = await db.query.conversations.findFirst({
			where: eq(conversations.id, conversationId)
		});
		if (existingConv && !existingConv.themeId) {
			await db.update(conversations)
				.set({ themeId: theme.id })
				.where(eq(conversations.id, conversationId));
		}
	}

	// Prosjekt-undertema av Hjem → har oppgave-fane (checklist_items knyttet til temaet).
	const isHomeProject = theme.parentTheme === 'Hjem';
	// Forelderens id, slik at et undertema kan navigere tilbake til mortemaet.
	// parentTheme er fritekst mot forelderens navn, så forelderen finnes ikke
	// nødvendigvis som rad (f.eks. 'Hjem' uten et Hjem-tema).
	//
	// NB: et tema kan peke på seg selv. Prod hadde Helse med parentTheme='Helse',
	// og da ble tittelen — som ER tilbakeknappen — en lenke til samme side: trykket
	// gjorde tilsynelatende ingenting. `resolveParentThemeId` avviser selvløkka, så
	// flaten oppfører seg riktig uansett hva som står i kolonnen.
	const parentThemeId = resolveParentThemeId(
		theme,
		theme.parentTheme ? (await findThemeByName(locals.userId, theme.parentTheme)) ?? null : null
	);
	// Kontakter lastes kun for prosjekttyper som har kontakter-fane (kommunikasjon/arrangement).
	const wantsContacts = isHomeProject && projectHasContacts(theme.projectProfile ?? null);

	// Last alle uavhengige data parallelt
	const [themeConversations, msgs, themeGoals, instruction, uploadedFiles, tripListsRaw, selectedWorkout, themeProjects, themeTasksRaw, cutListsRaw, contactsRaw, research, themeFindsRaw] =
		await Promise.all([
			getConversationsByTheme(locals.userId, theme.id),
			db
				.select({
					id: messagesTable.id,
					role: messagesTable.role,
					content: messagesTable.content,
					timestamp: messagesTable.createdAt
				})
				.from(messagesTable)
				.where(eq(messagesTable.conversationId, conversationId))
				.orderBy(asc(messagesTable.createdAt))
				.limit(50),
			db
				.select({
					id: goals.id,
					title: goals.title,
					status: goals.status,
					description: goals.description
				})
				.from(goals)
				.where(and(eq(goals.themeId, theme.id), eq(goals.userId, locals.userId))),
			getThemeInstruction(locals.userId, theme.id),
			db
				.select()
				.from(themeFiles)
				.where(and(eq(themeFiles.themeId, theme.id), eq(themeFiles.userId, locals.userId)))
				.orderBy(asc(themeFiles.createdAt)),
			db.query.themeLists.findMany({
				where: and(eq(themeLists.themeId, theme.id), eq(themeLists.userId, locals.userId)),
				with: { items: { orderBy: (i, { asc: a }) => [a(i.sortOrder), a(i.createdAt)] } },
				orderBy: [asc(themeLists.sortOrder), asc(themeLists.createdAt)]
			}),
			selectedWorkoutId
				? getWorkoutContextForUser(locals.userId, selectedWorkoutId)
				: Promise.resolve(null),
			ProjectMetricsService.listProjectsWithProgress(locals.userId, { themeId: theme.id }),
			isHomeProject
				? db
						.select()
						.from(checklistItems)
						.where(eq(checklistItems.themeId, theme.id))
						.orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt))
				: Promise.resolve([]),
			isHomeProject
				? db
						.select()
						.from(cutLists)
						.where(and(eq(cutLists.themeId, theme.id), eq(cutLists.userId, locals.userId)))
						.orderBy(asc(cutLists.sortOrder), asc(cutLists.createdAt))
				: Promise.resolve([]),
			wantsContacts
				? db
						.select()
						.from(projectContacts)
						.where(and(eq(projectContacts.themeId, theme.id), eq(projectContacts.userId, locals.userId)))
						.orderBy(asc(projectContacts.sortOrder), asc(projectContacts.createdAt))
				: Promise.resolve([]),
			listThemeResearch(theme.id, locals.userId),
			getThemeFindsByName(locals.userId, theme.name)
		]);

	console.log(`[perf][tema/:id] user=${locals.userId} theme=${theme.name} step=total ms=${(performance.now() - t0).toFixed(0)} msgs=${msgs.length} goals=${themeGoals.length} projects=${themeProjects.length}`);

	return {
		theme: {
			id: theme.id,
			name: theme.name,
			emoji: theme.emoji,
			description: theme.description,
			// ThemePage bruker parentTheme til flyt-oppslag (getFlowsByTheme).
			// Manglet i payloaden, så parent-baserte flyter matchet aldri.
			parentTheme: theme.parentTheme
		},
		parentThemeId,
		metricSettings: theme.metricSettings ?? {},
		themeConversations: themeConversations.map((c) => ({
			...c,
			updatedAt: c.updatedAt.toISOString(),
			createdAt: c.createdAt.toISOString()
		})),
		messages: msgs.map((m) => ({
			id: m.id,
			role: m.role as 'user' | 'assistant' | 'system',
			content: m.content,
			timestamp: m.timestamp.toISOString()
		})),
		goals: themeGoals,
		conversationId,
		themeInstruction: instruction,
		themeFiles: uploadedFiles.map((f) => ({
			id: f.id,
			name: f.name,
			url: f.url,
			fileType: f.fileType,
			mimeType: f.mimeType,
			sizeBytes: f.sizeBytes,
			createdAt: f.createdAt.toISOString()
		})),
		finds: themeFindsRaw.map((f) => ({
			id: f.id,
			title: f.title,
			summary: f.summary,
			domain: f.domain,
			kind: f.kind,
			sourceUrl: f.sourceUrl,
			thumbnailUrl: f.thumbnailUrl,
			status: f.status,
			mealId: f.mealId,
			createdAt: f.createdAt.toISOString()
		})),
		themeResearch: research,
		themeResearchDomains: theme.researchDomains ?? { include: [], exclude: [] },
		projects: themeProjects.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			domain: p.domain,
			type: p.type,
			status: p.status,
			budgetNok: p.budgetNok,
			emoji: (p.metadata as Record<string, unknown>)?.emoji as string | null ?? null,
			progress: p.progress
		})),
		tripProfile: theme.tripProfile ?? null,
		ferieProfile: theme.ferieProfile ?? null,
		isHomeProject,
		projectProfile: theme.projectProfile ?? null,
		contacts: contactsRaw.map(mapContact),
		tasks: themeTasksRaw.map(mapTaskItem),
		cutLists: cutListsRaw.map((c) => ({
			id: c.id,
			title: c.title,
			kerfMm: c.kerfMm,
			transportEnabled: c.transportEnabled,
			transportMaxLengthMm: c.transportMaxLengthMm,
			transportMaxWidthMm: c.transportMaxWidthMm,
			guillotine: c.guillotine,
			materials: c.materials ?? [],
			sortOrder: c.sortOrder,
			updatedAt: c.updatedAt.toISOString()
		})),
		tripLists: tripListsRaw.map((l) => ({
			id: l.id,
			title: l.title,
			emoji: l.emoji,
			listType: l.listType,
			sortOrder: l.sortOrder,
			items: l.items.map((i) => ({
				id: i.id,
				text: i.text,
				checked: i.checked ?? false,
				notes: i.notes ?? null,
				itemDate: i.itemDate ?? null,
				sortOrder: i.sortOrder
			}))
		})),
		selectedWorkout
	};
};
