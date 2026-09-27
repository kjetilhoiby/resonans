import { randomUUID } from 'node:crypto';
import {
	buildOverview,
	closingQuestionFor,
	currentTheme,
	parseIntakeExtraction,
	parseReflectionExtraction,
	parseReview,
	profileForPrompt,
	RO_STAGE_LABELS,
	structureById,
	structureForOpen,
	structureForStage,
	upsertThemeFromIntake,
	type RoOverview,
	type RoProposal,
	type RoReview,
	type RoSafety,
	type RoStage,
	type RoStructure,
	type RoTheme,
	mergeReflection,
	answerProposal,
	withCrisisHelp
} from './ro-logic';
import * as llm from './ro-llm';
import * as repo from './ro-repository';

/**
 * Orkestreringen i Ro: les profil → spør modellen (bare der det trengs) → la
 * ro-logic bestemme → lagre. Rutene under /api/apps/ro/* er tynne lag over dette.
 */

export type RoMode = 'open' | 'continue' | 'theme';

export interface RoPlanResponse {
	sessionId: string;
	mode: RoMode;
	structureId: string;
	structureTitle: string;
	practices: string;
	theme: { id: string; label: string; stage: RoStage; stageLabel: string } | null;
	/** Settes inn i øvelsens {fokus}-plass. null ⇒ appens standardtekst. */
	focus: string | null;
	/** Settes inn i øvelsens {situasjon}-plass. null ⇒ appens standardtekst. */
	situation: string | null;
	closingQuestion: string;
	safety: RoSafety;
}

function themeSummary(t: RoTheme | null) {
	return t ? { id: t.id, label: t.label, stage: t.stage, stageLabel: RO_STAGE_LABELS[t.stage] } : null;
}

/**
 * Før turen. Tre veier inn:
 *  - open: «bare løpe og observere». Ingen modell, ingen tema i øret.
 *  - continue: fortsett med temaet vi jobber med. Ingen modell; trinnet velger øvelsen.
 *  - theme: «noe jeg grubler på». Én rask modellrunde trekker ut tema, situasjon og fokus.
 */
export async function planSession(
	userId: string,
	input: { mode: RoMode; text: string | null; durationMin: number | null },
	now = new Date()
): Promise<RoPlanResponse> {
	const profile = await repo.loadProfile(userId);
	let theme: RoTheme | null = null;
	let structure: RoStructure;
	let situation: string | null = null;
	let focus: string | null = null;
	let safety: RoSafety = 'none';
	let mode = input.mode;

	if (mode === 'theme' && input.text) {
		let raw: unknown = {};
		try {
			raw = await llm.extractIntake({ text: input.text, profileText: profileForPrompt(profile, now) });
		} catch (error) {
			// Uten modell blir det en åpen økt. Turen skal ikke vente på en server.
			console.error('[ro] intake feilet, faller tilbake til åpen økt:', error);
		}
		const extraction = parseIntakeExtraction(
			raw,
			profile.themes.map((t) => t.id)
		);
		safety = extraction.safety;
		if (safety !== 'crisis') {
			theme = upsertThemeFromIntake(profile, extraction, now);
			situation = extraction.situation;
			focus = extraction.focus ?? theme?.currentPractice ?? null;
		}
	} else if (mode === 'continue') {
		theme = currentTheme(profile, now);
		focus = theme?.currentPractice ?? null;
		situation = theme?.situation ?? null;
	}

	if (theme) {
		structure = structureForStage(theme.stage, theme.sessionsAtStage);
		// En øvelse som trenger en konkret situasjon, uten at vi har en, blir en åpen variant.
		if (!situation && !structure.open) structure = structureById('kontroll')!;
	} else {
		mode = 'open';
		const completed = await repo.countCompleted(userId);
		structure = safety === 'crisis' ? structureById('omgivelser')! : structureForOpen(profile, completed);
		profile.lastOpenStructureId = structure.id;
	}

	const closingQuestion = closingQuestionFor(theme?.stage ?? null);
	const row = await repo.createSession({
		userId,
		mode,
		themeId: theme?.id ?? null,
		structureId: structure.id,
		stage: theme?.stage ?? null,
		focus,
		situation,
		closingQuestion,
		intake: input.text,
		durationSec: input.durationMin ? input.durationMin * 60 : null
	});
	await repo.saveProfile(userId, profile);

	return {
		sessionId: row.id,
		mode,
		structureId: structure.id,
		structureTitle: structure.title,
		practices: structure.practices,
		theme: themeSummary(theme),
		focus,
		situation,
		closingQuestion,
		safety
	};
}

export interface RoReflectionResponse {
	reply: string;
	safety: RoSafety;
	proposal: RoProposal | null;
	theme: ReturnType<typeof themeSummary>;
	/** Hva neste økt blir, som en observasjon – ikke en avtale. */
	next: { structureId: string; structureTitle: string; themeLabel: string | null } | null;
	advanced: boolean;
}

/** Etter turen. `text` kan være tom: da er økta bare registrert, uten modell. */
export async function reflectOnSession(
	userId: string,
	sessionId: string,
	input: { text: string; durationSec: number | null },
	now = new Date()
): Promise<RoReflectionResponse | null> {
	const session = await repo.getOwnedSession(userId, sessionId);
	if (!session) return null;
	const profile = await repo.loadProfile(userId);
	const sessionTheme = profile.themes.find((t) => t.id === session.themeId) ?? null;

	if (!input.text.trim()) {
		await repo.completeSession(session.id, {
			durationSec: input.durationSec,
			reflection: null,
			reply: null,
			proposal: null,
			themeId: session.themeId
		});
		return { reply: '', safety: 'none', proposal: null, theme: themeSummary(sessionTheme), next: null, advanced: false };
	}

	let raw: unknown = {};
	try {
		raw = await llm.reflect({
			profileText: profileForPrompt(profile, now),
			structureId: session.structureId,
			stage: (session.stage as RoStage | null) ?? null,
			themeLabel: sessionTheme?.label ?? null,
			focus: session.focus,
			intake: session.intake,
			closingQuestion: session.closingQuestion,
			reflection: input.text,
			durationMin: input.durationSec ? Math.round(input.durationSec / 60) : null
		});
	} catch (error) {
		console.error('[ro] refleksjon feilet, bruker fallback:', error);
	}
	const extraction = parseReflectionExtraction(
		raw,
		profile.themes.map((t) => t.id)
	);
	const merged = mergeReflection(profile, extraction, {
		sessionThemeId: session.themeId,
		sessionId: session.id,
		now,
		newId: randomUUID
	});

	let reply = extraction.reply;
	if (extraction.safety === 'crisis') reply = withCrisisHelp(reply);

	await repo.completeSession(session.id, {
		durationSec: input.durationSec,
		reflection: input.text,
		reply,
		proposal: merged.proposal as unknown as Record<string, unknown> | null,
		themeId: merged.theme?.id ?? session.themeId
	});
	await repo.saveProfile(userId, profile);
	await repo.forgetOldText(userId);

	const nextStructure = merged.theme ? structureForStage(merged.theme.stage, merged.theme.sessionsAtStage) : null;
	return {
		reply,
		safety: extraction.safety,
		proposal: merged.proposal,
		theme: themeSummary(merged.theme),
		next: nextStructure
			? { structureId: nextStructure.id, structureTitle: nextStructure.title, themeLabel: merged.theme?.label ?? null }
			: null,
		advanced: merged.advanced
	};
}

export async function answerSessionProposal(userId: string, noteId: string, accept: boolean): Promise<boolean> {
	const profile = await repo.loadProfile(userId);
	if (!answerProposal(profile, noteId, accept)) return false;
	await repo.saveProfile(userId, profile);
	return true;
}

export interface RoProfileResponse {
	overview: RoOverview;
	/** Temaet «Fortsett med …» på førskjermen peker på. */
	continueTheme: ReturnType<typeof themeSummary> & { currentPractice: string | null } | null;
}

export async function getProfile(userId: string, now = new Date()): Promise<RoProfileResponse> {
	const profile = await repo.loadProfile(userId);
	const since = new Date(now.getTime() - 30 * 86_400_000);
	const n = await repo.countCompleted(userId, since);
	const cont = currentTheme(profile, now);
	return {
		overview: buildOverview(profile, n, now),
		continueTheme: cont ? { ...themeSummary(cont)!, currentPractice: cont.currentPractice } : null
	};
}

/** Den lengre gjennomgangen. Lagres på temaet og nullstiller telleren. */
export async function reviewTheme(userId: string, themeId: string, now = new Date()): Promise<RoReview | null> {
	const profile = await repo.loadProfile(userId);
	const theme = profile.themes.find((t) => t.id === themeId);
	if (!theme) return null;
	const reflections = await repo.recentReflections(userId, themeId);
	let raw: unknown = {};
	try {
		raw = await llm.review({ profileText: profileForPrompt(profile, now), themeLabel: theme.label, reflections });
	} catch (error) {
		console.error('[ro] gjennomgang feilet:', error);
		return null;
	}
	const review = parseReview(raw, now);
	if (!review) return null;
	theme.lastReview = review;
	theme.sessionsSinceReview = 0;
	await repo.saveProfile(userId, profile);
	return review;
}
