import type { AssistantTool } from './tools';
import { db } from '$lib/db';
import { storySessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import {
	projectStoryBoard,
	toStorySessionState,
	mergeWorld,
	coerceWorld,
	coerceChoices,
	normalizeBlanksTotal,
	allBlanksFilled,
	type StoryKind,
	type StoryPhase,
	type HistoryEntry,
	type FilledBlank
} from './story-logic';

/**
 * Forteller-verktøy for tale-assistentens interaktive fortellinger. Additivt til `quiz_*`.
 * Speiler quiz-mønsteret: tracking-state ligger i `story_sessions` (én aktiv fortelling per
 * bruker, uavhengig av quiz), og den rene logikken (board-projeksjon, world-merge, blank-
 * bokføring) bor i `story-logic.ts` og er enhetstestet.
 *
 * Prinsippet er likt quizens: serveren eier ALL tilstand. Selve NARRASJONEN (avsnittene)
 * produseres av agenten i tale med den sterke modellen i hovedløkka — verktøyene her bokfører
 * bare tilstanden så den delte baksete-skjermen og gjenopptakelse blir korrekt. Den interne
 * fortellings-bibelen (`bible`) re-injiseres via `story_state` hver tur for å holde kanon + buen
 * stram over en halvtime, men er ALDRI en del av det offentlige board-skjemaet.
 */

async function loadActiveStory(userId: string) {
	const rows = await db
		.select()
		.from(storySessions)
		.where(and(eq(storySessions.userId, userId), eq(storySessions.active, true)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Har brukeren en pågående (aktiv OG ikke avsluttet) fortelling? Brukes av assistent-løkka til
 * å rute hele turen til den sterke forteller-modellen — en ren fortelling drifter og blir grunn
 * på den raske prat-tieren. En avsluttet (ended) fortelling teller ikke: da er turen vanlig prat.
 */
export async function hasActiveStory(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: storySessions.id })
		.from(storySessions)
		.where(
			and(
				eq(storySessions.userId, userId),
				eq(storySessions.active, true),
				eq(storySessions.ended, false)
			)
		)
		.limit(1);
	return !!rows[0];
}

/* ── story_start ──────────────────────────────────────────────────────────────────────────── */

async function startStory(
	userId: string,
	kind: StoryKind,
	opts: { theme?: string; title?: string; blanksTotal?: number; bible?: string }
) {
	// Maks én aktiv fortelling per bruker — deaktiver forrige før vi starter en ny.
	await db
		.update(storySessions)
		.set({ active: false, updatedAt: new Date() })
		.where(and(eq(storySessions.userId, userId), eq(storySessions.active, true)));

	const inserted = await db
		.insert(storySessions)
		.values({
			userId,
			kind,
			title: opts.title ?? null,
			theme: opts.theme ?? null,
			currentPlayer: null,
			active: true,
			ended: false,
			story: null,
			bible: opts.bible ?? '',
			phase: kind === 'branching' ? 'setup' : null,
			world: [],
			passage: null,
			choices: [],
			lastChoice: null,
			step: 0,
			history: [],
			request: null,
			blanksFilled: 0,
			blanksTotal: kind === 'madlib' ? normalizeBlanksTotal(opts.blanksTotal) : 0,
			filled: []
		})
		.returning();

	return { sessionId: inserted[0]?.id, board: projectStoryBoard(toStorySessionState(inserted[0])) };
}

/* ── story_scene (branching) ──────────────────────────────────────────────────────────────── */

async function advanceScene(
	userId: string,
	args: {
		passage: string;
		choices: ReturnType<typeof coerceChoices>;
		phase?: StoryPhase;
		world?: ReturnType<typeof coerceWorld>;
		currentPlayer?: string | null;
		lastChoice?: string | null;
		bible?: string;
	}
) {
	const session = await loadActiveStory(userId);
	if (!session) return { error: 'Ingen aktiv fortelling. Start en med story_start først.' };
	if (session.kind !== 'branching') {
		return { error: 'story_scene gjelder kun branching-fortellinger (velg-selv-eventyr).' };
	}
	if (session.ended) return { error: 'Fortellingen er avsluttet. Start en ny med story_start.' };

	// Skyv forrige avsnitt + valget som førte videre til historikken før vi overskriver.
	const history: HistoryEntry[] = [...(session.history ?? [])];
	if (session.passage) {
		history.push({ passage: session.passage, choiceLabel: args.lastChoice ?? null });
	}

	const world = args.world && args.world.length > 0 ? mergeWorld(session.world ?? [], args.world) : session.world ?? [];

	await db
		.update(storySessions)
		.set({
			passage: args.passage,
			choices: args.choices,
			phase: args.phase ?? session.phase,
			world,
			lastChoice: args.lastChoice ?? session.lastChoice,
			currentPlayer: args.currentPlayer !== undefined ? args.currentPlayer : session.currentPlayer,
			step: session.step + 1,
			history,
			...(args.bible !== undefined ? { bible: args.bible } : {}),
			updatedAt: new Date()
		})
		.where(eq(storySessions.id, session.id));

	const refreshed = await loadActiveStory(userId);
	return { ok: true, board: refreshed ? projectStoryBoard(toStorySessionState(refreshed)) : null };
}

/* ── story_request / story_fill (madlib) ──────────────────────────────────────────────────── */

async function requestWord(userId: string, slot: string, currentPlayer?: string | null) {
	const session = await loadActiveStory(userId);
	if (!session) return { error: 'Ingen aktiv fortelling. Start en med story_start først.' };
	if (session.kind !== 'madlib') return { error: 'story_request gjelder kun madlib-fortellinger.' };
	if (session.ended) return { error: 'Fortellingen er avsluttet. Start en ny med story_start.' };

	await db
		.update(storySessions)
		.set({
			request: slot,
			currentPlayer: currentPlayer !== undefined ? currentPlayer : session.currentPlayer,
			updatedAt: new Date()
		})
		.where(eq(storySessions.id, session.id));

	const refreshed = await loadActiveStory(userId);
	return { ok: true, board: refreshed ? projectStoryBoard(toStorySessionState(refreshed)) : null };
}

async function fillWord(userId: string, slot: string, word: string) {
	const session = await loadActiveStory(userId);
	if (!session) return { error: 'Ingen aktiv fortelling. Start en med story_start først.' };
	if (session.kind !== 'madlib') return { error: 'story_fill gjelder kun madlib-fortellinger.' };
	if (session.ended) return { error: 'Fortellingen er avsluttet. Start en ny med story_start.' };

	const filled: FilledBlank[] = [...(session.filled ?? []), { slot, word }];

	await db
		.update(storySessions)
		.set({
			filled,
			blanksFilled: filled.length, // invariant: nøyaktig +1 per fill
			request: null, // nullstilles til neste story_request
			updatedAt: new Date()
		})
		.where(eq(storySessions.id, session.id));

	const refreshed = await loadActiveStory(userId);
	return {
		ok: true,
		blanksFilled: filled.length,
		blanksTotal: session.blanksTotal,
		complete: allBlanksFilled(filled.length, session.blanksTotal),
		board: refreshed ? projectStoryBoard(toStorySessionState(refreshed)) : null
	};
}

/* ── story_end ────────────────────────────────────────────────────────────────────────────── */

async function endStory(userId: string, story: string) {
	const session = await loadActiveStory(userId);
	if (!session) return { error: 'Ingen aktiv fortelling å avslutte.' };
	if (session.ended) return { error: 'Fortellingen er allerede avsluttet.' };

	await db
		.update(storySessions)
		.set({
			ended: true,
			story, // avsløres på skjermen sammen med ended
			choices: [],
			request: null,
			updatedAt: new Date()
		})
		.where(eq(storySessions.id, session.id));

	const refreshed = await loadActiveStory(userId);
	return { ended: true, board: refreshed ? projectStoryBoard(toStorySessionState(refreshed)) : null };
}

/* ── Verktøy-definisjoner ─────────────────────────────────────────────────────────────────── */

export const STORY_ASSISTANT_TOOLS: AssistantTool[] = [
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_start',
				description:
					'Start en ny interaktiv fortelling (erstatter en ev. aktiv). kind="branching" = velg-selv-eventyr (a/b-valg som forgrener; settes i fasen "setup"). kind="madlib" = tulle-fortelling der du ber om ord og vever dem inn (sett blanksTotal = hvor mange ord). Kall trip_companions FØRST for navn og alder, så du kan alderskalibrere tonen. Sett gjerne bible med en kort intern fortellings-bibel (kanon, bue, tone) du oppdaterer underveis.',
				parameters: {
					type: 'object',
					properties: {
						kind: { type: 'string', enum: ['branching', 'madlib'] },
						theme: { type: 'string', description: 'Sjanger/stemning, f.eks. «skrekk», «verdensrommet», «Zelda»' },
						title: { type: 'string', description: 'Tittel på fortellingen (kan settes/endres senere)' },
						blanksTotal: { type: 'number', description: 'Kun madlib: hvor mange ord skal samles (default 6)' },
						bible: { type: 'string', description: 'Intern fortellings-bibel (kanon + bue + tone) — vises aldri på skjermen' }
					},
					required: ['kind']
				}
			}
		},
		run: async (userId, args) => {
			if (args.kind !== 'branching' && args.kind !== 'madlib') {
				return { error: 'Oppgi kind = "branching" eller "madlib".' };
			}
			const kind: StoryKind = args.kind;
			const theme = typeof args.theme === 'string' && args.theme.trim() ? args.theme.trim() : undefined;
			const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : undefined;
			const bible = typeof args.bible === 'string' && args.bible.trim() ? args.bible.trim() : undefined;
			return startStory(userId, kind, { theme, title, blanksTotal: args.blanksTotal as number | undefined, bible });
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_scene',
				description:
					'KUN branching. Fortell neste avsnitt i et velg-selv-eventyr og sett de to nye valgene. Kall dette SAMTIDIG som du leser avsnittet høyt — narrasjon i tale + story_scene er én udelelig operasjon, og må skje FØR du flytter turen videre (currentPlayer). Et valg som ikke endrer passage er en feil. Lås nye fakta inn i world (vokser; vises som «Verden»-kort). Bytt til phase="adventure" når kjernekonteksten sitter (univers, hvem er med, hvor/hva). lastChoice = valget spilleren nettopp tok (det skyves til historikken sammen med forrige avsnitt).',
				parameters: {
					type: 'object',
					properties: {
						passage: { type: 'string', description: 'Det nye avsnittet (kort, bil-vennlig, leses høyt)' },
						choices: {
							type: 'array',
							description: 'Nøyaktig to valg med stabile id-er «a» og «b»',
							items: {
								type: 'object',
								properties: { id: { type: 'string' }, label: { type: 'string' } },
								required: ['id', 'label']
							}
						},
						phase: { type: 'string', enum: ['setup', 'adventure'], description: 'setup = bygg verden (hyppige spm); adventure = handling' },
						world: {
							type: 'array',
							description: 'Nye/endrede fakta om den fantastiske verdenen (label+value). Slås inn i eksisterende world.',
							items: {
								type: 'object',
								properties: { label: { type: 'string' }, value: { type: 'string' } },
								required: ['label', 'value']
							}
						},
						currentPlayer: { type: 'string', description: 'Hvem agenten venter på nå (utelat for «hvem som helst»)' },
						lastChoice: { type: 'string', description: 'Valget spilleren nettopp tok (etiketten)' },
						bible: { type: 'string', description: 'Oppdatert intern fortellings-bibel (kanon + bue + tone)' }
					},
					required: ['passage', 'choices']
				}
			}
		},
		run: async (userId, args) => {
			const passage = typeof args.passage === 'string' ? args.passage.trim() : '';
			if (!passage) return { error: 'Oppgi passage (avsnittet).' };
			const choices = coerceChoices(args.choices);
			if (choices.length < 2) return { error: 'Oppgi nøyaktig to valg (choices) med id «a» og «b».' };
			const phase = args.phase === 'setup' || args.phase === 'adventure' ? (args.phase as StoryPhase) : undefined;
			const world = coerceWorld(args.world);
			const currentPlayer =
				typeof args.currentPlayer === 'string' ? args.currentPlayer.trim() || null : undefined;
			const lastChoice = typeof args.lastChoice === 'string' ? args.lastChoice.trim() || null : undefined;
			const bible = typeof args.bible === 'string' ? args.bible.trim() : undefined;
			return advanceScene(userId, { passage, choices, phase, world, currentPlayer, lastChoice, bible });
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_request',
				description:
					'KUN madlib. Be om neste ufylte ord. Sett slot = hva du ber om («et adjektiv», «et dyr», «et morsomt sted»). Kall dette FØR du spør i tale, så skjermen viser hva dere venter på. Oppgi gjerne currentPlayer for å la én bestemt passasjer svare.',
				parameters: {
					type: 'object',
					properties: {
						slot: { type: 'string', description: 'Ordet du ber om, f.eks. «et adjektiv», «et dyr»' },
						currentPlayer: { type: 'string', description: 'Hvem som skal gi ordet (utelat for hvem som helst)' }
					},
					required: ['slot']
				}
			}
		},
		run: async (userId, args) => {
			const slot = typeof args.slot === 'string' ? args.slot.trim() : '';
			if (!slot) return { error: 'Oppgi slot (hva du ber om).' };
			const currentPlayer = typeof args.currentPlayer === 'string' ? args.currentPlayer.trim() || null : undefined;
			return requestWord(userId, slot, currentPlayer);
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_fill',
				description:
					'KUN madlib. Bokfør ordet en passasjer ga (slot + word). Øker blanksFilled med nøyaktig 1 og nullstiller request til neste story_request. Når blanksFilled === blanksTotal er alle ord samlet — vev dem inn og avslør hele fortellingen med story_end.',
				parameters: {
					type: 'object',
					properties: {
						slot: { type: 'string', description: 'Hva det ble spurt om (samme som i story_request)' },
						word: { type: 'string', description: 'Ordet passasjeren ga' }
					},
					required: ['slot', 'word']
				}
			}
		},
		run: async (userId, args) => {
			const slot = typeof args.slot === 'string' ? args.slot.trim() : '';
			const word = typeof args.word === 'string' ? args.word.trim() : '';
			if (!slot || !word) return { error: 'Oppgi slot og word.' };
			return fillWord(userId, slot, word);
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_end',
				description:
					'Avslutt fortellingen og avslør hele teksten. Sett story = den fulle teksten (for branching: hele eventyret slik det forgrenet seg; for madlib: tulle-fortellingen med ordene vevd inn). Dette setter ended=true og avslører story på skjermen — terminalt. Branching: avslutt FØRST når passasjerene vil runde av eller en bue naturlig lander. Madlib: avslutt FØRST når alle ord er samlet.',
				parameters: {
					type: 'object',
					properties: {
						story: { type: 'string', description: 'Den fulle, ferdige fortellingsteksten som avsløres på skjermen' }
					},
					required: ['story']
				}
			}
		},
		run: async (userId, args) => {
			const story = typeof args.story === 'string' ? args.story.trim() : '';
			if (!story) return { error: 'Oppgi story (den fulle teksten).' };
			return endStory(userId, story);
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'story_state',
				description:
					'Les den aktive fortellingens fulle interne tilstand: kanon/bue/tone-bibelen, world, siste avsnitt, valg og historikk (branching), eller innsamlede ord og hva som mangler (madlib). Kall dette ved START av en fortelling-tur — særlig ved gjenopptakelse etter et opphold — for å friske opp kanon og buen før du fortsetter («Sist i eventyret …»). Returnerer { active: false } hvis ingen fortelling er aktiv.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => {
			const session = await loadActiveStory(userId);
			if (!session) return { active: false };
			const s = toStorySessionState(session);
			// Intern arbeidsvisning (inkl. bibel + historikk) — IKKE det offentlige board-skjemaet.
			return {
				active: true,
				kind: s.kind,
				title: s.title,
				theme: s.theme,
				currentPlayer: s.currentPlayer,
				ended: s.ended,
				bible: session.bible ?? '',
				// branching
				phase: s.phase,
				world: s.world,
				passage: s.passage,
				choices: s.choices,
				lastChoice: s.lastChoice,
				step: s.step,
				history: session.history ?? [],
				// madlib
				request: s.request,
				blanksFilled: s.blanksFilled,
				blanksTotal: s.blanksTotal,
				filled: s.filled,
				// full tekst kun når avsluttet
				story: s.ended ? s.story : null
			};
		}
	}
];
