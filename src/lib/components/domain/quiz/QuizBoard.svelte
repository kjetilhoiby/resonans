<!--
  QuizBoard — visuell spillskjerm for bilferie-quizen. Rendrer server-tilstanden
  (quiz_sessions) som et scoreboard + spørsmålskort, og poller `pollUrl` for live
  oppdatering mens tale-assistenten driver spillet. Brukes både i appen (/spill) og
  på den delte skjermen (/share/[token]). Ren visning — ingen skriving.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Standing {
		name: string;
		score: number;
		streak: number;
		bestStreak: number;
		streakLabel: string | null;
		current: boolean;
	}
	interface Board {
		active: boolean;
		theme?: string | null;
		round?: number;
		currentPlayer?: string | null;
		currentQuestion?: string | null;
		answered?: boolean;
		answer?: string | null;
		lastResult?: { player: string; correct: boolean } | null;
		standings?: Standing[];
	}

	interface Props {
		initial: Board;
		pollUrl: string;
		pollMs?: number;
	}

	let { initial, pollUrl, pollMs = 3000 }: Props = $props();

	let board = $state<Board>(initial);
	let timer: ReturnType<typeof setInterval> | null = null;

	const standings = $derived(board.standings ?? []);
	const leaderScore = $derived(standings.length ? Math.max(...standings.map((s) => s.score)) : 0);

	async function poll() {
		try {
			const res = await fetch(pollUrl);
			if (!res.ok) return;
			board = (await res.json()) as Board;
		} catch {
			/* neste poll prøver igjen */
		}
	}

	onMount(() => {
		poll();
		timer = setInterval(poll, pollMs);
	});
	onDestroy(() => {
		if (timer) clearInterval(timer);
	});
</script>

{#if !board.active}
	<div class="empty">
		<div class="empty-emoji">🎲</div>
		<p class="empty-title">Ingen quiz spilles akkurat nå</p>
		<p class="empty-hint">Be Ekko starte en quiz, så dukker stillingen opp her.</p>
	</div>
{:else}
	<div class="board">
		<div class="board-head">
			<span class="theme">{board.theme || 'Quiz'}</span>
			{#if board.round}<span class="round">Runde {board.round}</span>{/if}
		</div>

		{#if board.currentQuestion}
			<div class="qcard" class:answered={board.answered}>
				{#if board.answered && board.lastResult}
					<div class="verdict" class:ok={board.lastResult.correct} class:no={!board.lastResult.correct}>
						{board.lastResult.correct ? '✓ Riktig' : '✗ Bom'} — {board.lastResult.player}
					</div>
				{:else if board.currentPlayer}
					<div class="turn">{board.currentPlayer} sin tur</div>
				{/if}
				<p class="question">{board.currentQuestion}</p>
				{#if board.answered && board.answer}
					<p class="answer">Svar: <strong>{board.answer}</strong></p>
				{/if}
			</div>
		{/if}

		<div class="players" role="list">
			{#each standings as p (p.name)}
				<div class="player" class:current={p.current} class:leader={p.score === leaderScore && leaderScore > 0} role="listitem">
					<div class="name">{p.name}</div>
					<div class="score">{p.score}</div>
					<div class="meta">
						{#if p.streak > 0}
							<span class="streak">🔥 {p.streak}</span>
						{/if}
						{#if p.streakLabel}
							<span class="badge">{p.streakLabel}</span>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 3rem 1rem;
		text-align: center;
	}
	.empty-emoji {
		font-size: 2.4rem;
	}
	.empty-title {
		margin: 0;
		font-size: var(--font-size-title);
		font-weight: 600;
		color: var(--text-primary);
	}
	.empty-hint {
		margin: 0;
		font-size: var(--font-size-body);
		color: var(--text-secondary);
	}

	.board {
		display: flex;
		flex-direction: column;
		gap: var(--space-lg, 16px);
		margin-top: var(--space-lg, 16px);
	}
	.board-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.theme {
		font-size: 1.4rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: var(--text-primary);
		text-transform: capitalize;
	}
	.round {
		font-size: var(--font-size-label);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--section-label-color, #94a3b8);
		flex-shrink: 0;
	}

	.qcard {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius, 16px);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.qcard.answered {
		border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--card-border));
	}
	.turn {
		align-self: flex-start;
		font-size: var(--font-size-caption);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
		padding: 4px 10px;
		border-radius: 999px;
	}
	.verdict {
		align-self: flex-start;
		font-size: var(--font-size-caption);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 4px 10px;
		border-radius: 999px;
	}
	.verdict.ok {
		color: #34d399;
		background: color-mix(in srgb, #34d399 16%, transparent);
	}
	.verdict.no {
		color: #f87171;
		background: color-mix(in srgb, #f87171 16%, transparent);
	}
	.question {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.35;
		color: var(--text-primary);
	}
	.answer {
		margin: 0;
		font-size: var(--font-size-body);
		color: var(--text-secondary);
	}
	.answer strong {
		color: var(--text-primary);
	}

	.players {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 12px;
	}
	.player {
		background: var(--card-bg-subtle, var(--card-bg));
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius, 16px);
		padding: 14px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		transition: border-color 0.2s, box-shadow 0.2s;
	}
	.player.current {
		border-color: var(--accent-primary);
		box-shadow: 0 0 0 1px var(--accent-primary), 0 0 18px color-mix(in srgb, var(--accent-primary) 22%, transparent);
	}
	.name {
		font-size: var(--font-size-body);
		font-weight: 600;
		color: var(--text-primary);
	}
	.player.leader .name::after {
		content: ' 👑';
	}
	.score {
		font-size: var(--font-size-value, 1.9rem);
		font-weight: 700;
		line-height: 1;
		color: var(--text-primary);
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 1.2em;
	}
	.streak {
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.badge {
		font-size: var(--font-size-caption);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #f0b429;
	}
</style>
