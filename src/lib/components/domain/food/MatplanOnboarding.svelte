<!--
  MatplanOnboarding — kort guidet oppsett for mat-temaet: barnas preferanser
  (lunchbox_profiles) og familiens ukerytme (food_settings.weekRhythmNote).
  Lav friksjon: hurtigvalg for appetitt, tag-input for smak, og fritekst for
  ukerytmen. Kan hoppes over; settes «onboarded» uansett så den ikke maser.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '../../ui/Button.svelte';
	import Skeleton from '../../ui/Skeleton.svelte';

	interface Props {
		onclose: () => void;
		oncompleted: () => void;
	}

	let { onclose, oncompleted }: Props = $props();

	type ChildForm = {
		personId: string;
		name: string;
		avatarEmoji: string | null;
		likes: string;
		dislikes: string;
		allergies: string;
		appetite: string;
	};

	let step = $state<1 | 2>(1);
	let loading = $state(true);
	let saving = $state(false);
	let children = $state<ChildForm[]>([]);
	let weekRhythm = $state('');

	const RHYTHM_HINTS = [
		'Vi handler Oda på onsdager.',
		'Fredag er tacodag.',
		'Mandager er vi slitne — hold det enkelt.',
		'Lørdag lager vi noe litt ekstra.',
		'Unngå fisk to dager på rad.'
	];

	onMount(async () => {
		try {
			const [lunchboxRes, settingsRes] = await Promise.all([
				fetch('/api/food/lunchbox'),
				fetch('/api/food/settings')
			]);
			if (lunchboxRes.ok) {
				const data = await lunchboxRes.json();
				children = (data.children ?? []).map(
					(c: {
						personId: string;
						name: string;
						avatarEmoji: string | null;
						profile: { likes: string[]; dislikes: string[]; allergies: string[]; appetite: string };
					}) => ({
						personId: c.personId,
						name: c.name,
						avatarEmoji: c.avatarEmoji,
						likes: c.profile.likes.join(', '),
						dislikes: c.profile.dislikes.join(', '),
						allergies: c.profile.allergies.join(', '),
						appetite: c.profile.appetite || 'middels'
					})
				);
			}
			if (settingsRes.ok) {
				const data = await settingsRes.json();
				weekRhythm = data.settings?.weekRhythmNote ?? '';
			}
		} finally {
			loading = false;
		}
	});

	function parseList(text: string): string[] {
		return text.split(',').map((s) => s.trim()).filter(Boolean);
	}

	function addHint(hint: string) {
		weekRhythm = weekRhythm.trim() ? `${weekRhythm.trim()}\n${hint}` : hint;
	}

	async function finish(markOnboarded: boolean) {
		saving = true;
		try {
			await Promise.all([
				...children.map((child) =>
					fetch('/api/food/lunchbox/profiles', {
						method: 'PATCH',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							personId: child.personId,
							likes: parseList(child.likes),
							dislikes: parseList(child.dislikes),
							allergies: parseList(child.allergies),
							appetite: child.appetite
						})
					})
				),
				fetch('/api/food/settings', {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ weekRhythmNote: weekRhythm.trim() || null, markOnboarded })
				})
			]);
			oncompleted();
		} finally {
			saving = false;
		}
	}

	async function skip() {
		saving = true;
		try {
			await fetch('/api/food/settings', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ markOnboarded: true })
			});
			onclose();
		} finally {
			saving = false;
		}
	}
</script>

<div class="mo-overlay">
	<header class="mo-header">
		<button class="mo-close" onclick={onclose} aria-label="Lukk oppsett" data-track="matplan-onboarding:lukk">✕</button>
		<div class="mo-title">
			<h1>Sett opp matplan</h1>
			<div class="mo-dots" aria-label={`Steg ${step} av 2`}>
				{#each [1, 2] as s}
					<span class="mo-dot" class:active={s === step} class:done={s < step}></span>
				{/each}
			</div>
		</div>
		<button class="mo-skip" onclick={skip} disabled={saving} data-track="matplan-onboarding:hopp-over">Hopp over</button>
	</header>

	<div class="mo-body">
		{#if loading}
			<Skeleton height="80px" />
			<Skeleton height="80px" />
		{:else if step === 1}
			<p class="mo-lead">Litt om barna — så treffer matpakke- og middagsforslagene bedre. Alt kan endres senere.</p>
			{#if children.length === 0}
				<p class="mo-empty">Ingen barn er registrert ennå. Legg dem til under Familie først, så dukker de opp her.</p>
			{:else}
				{#each children as child (child.personId)}
					<div class="mo-child">
						<div class="mo-child-head">
							<span class="mo-avatar">{child.avatarEmoji ?? '🧒'}</span>
							<span class="mo-name">{child.name}</span>
						</div>
						<label class="mo-field">
							<span class="mo-label">Liker</span>
							<input class="mo-input" bind:value={child.likes} placeholder="hvitost, eple, taco" data-track="matplan-onboarding:liker" />
						</label>
						<label class="mo-field">
							<span class="mo-label">Liker ikke</span>
							<input class="mo-input" bind:value={child.dislikes} placeholder="leverpostei, løk" data-track="matplan-onboarding:liker-ikke" />
						</label>
						<label class="mo-field">
							<span class="mo-label">Allergier</span>
							<input class="mo-input" bind:value={child.allergies} placeholder="(ingen)" data-track="matplan-onboarding:allergier" />
						</label>
						<div class="mo-field">
							<span class="mo-label">Appetitt</span>
							<div class="mo-segment" role="radiogroup" aria-label={`Appetitt for ${child.name}`}>
								{#each [['liten', 'Liten'], ['middels', 'Middels'], ['stor', 'Stor']] as [value, label]}
									<button
										class="mo-seg"
										class:active={child.appetite === value}
										role="radio"
										aria-checked={child.appetite === value}
										onclick={() => (child.appetite = value)}
										data-track="matplan-onboarding:appetitt"
									>{label}</button>
								{/each}
							</div>
						</div>
					</div>
				{/each}
			{/if}
		{:else}
			<p class="mo-lead">Hvordan ser en vanlig uke ut hos dere? Dette leser AI-en når den foreslår middager og oppskrifter.</p>
			<textarea
				class="mo-textarea"
				bind:value={weekRhythm}
				rows="6"
				placeholder="F.eks.: Vi handler Oda på onsdager. Fredag er tacodag. Mandager er vi slitne — hold det enkelt."
				data-track="matplan-onboarding:ukerytme"
			></textarea>
			<div class="mo-hints">
				{#each RHYTHM_HINTS as hint}
					<button class="mo-hint" onclick={() => addHint(hint)} data-track="matplan-onboarding:forslag">+ {hint}</button>
				{/each}
			</div>
		{/if}
	</div>

	<footer class="mo-footer">
		{#if step === 1}
			<Button onClick={() => (step = 2)} disabled={loading || saving} fullWidth>Neste: ukerytme</Button>
		{:else}
			<button class="mo-back" onclick={() => (step = 1)} disabled={saving}>← Tilbake</button>
			<Button onClick={() => finish(true)} disabled={saving}>{saving ? 'Lagrer…' : 'Ferdig'}</Button>
		{/if}
	</footer>
</div>

<style>
	.mo-overlay {
		position: fixed;
		inset: 0;
		z-index: 150;
		background: var(--page-bg, #0d0d10);
		display: flex;
		flex-direction: column;
	}
	.mo-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
	}
	.mo-close {
		background: rgba(255, 255, 255, 0.07);
		border: none;
		border-radius: 10px;
		color: inherit;
		width: 38px;
		height: 38px;
		font-size: 1rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.mo-title {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.mo-title h1 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}
	.mo-dots {
		display: flex;
		gap: 5px;
	}
	.mo-dot {
		width: 18px;
		height: 4px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.12);
	}
	.mo-dot.active {
		background: var(--accent-light);
	}
	.mo-dot.done {
		background: color-mix(in srgb, var(--accent-light) 45%, transparent);
	}
	.mo-skip {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		font-size: 0.82rem;
		flex-shrink: 0;
	}
	.mo-body {
		flex: 1;
		overflow-y: auto;
		padding: 8px 16px 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.mo-lead {
		color: var(--color-text-secondary, #999);
		font-size: 0.88rem;
		line-height: 1.45;
		margin: 4px 0 8px;
	}
	.mo-empty {
		color: var(--color-text-secondary, #999);
		font-size: 0.9rem;
	}
	.mo-child {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--card-bg, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.08));
		border-radius: 14px;
		padding: 14px;
	}
	.mo-child-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 2px;
	}
	.mo-avatar {
		font-size: 1.2rem;
	}
	.mo-name {
		font-weight: 700;
		font-size: 0.98rem;
	}
	.mo-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.mo-label {
		font-size: 0.74rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary, #999);
	}
	.mo-input,
	.mo-textarea {
		background: var(--input-bg, #1a1a1a);
		border: 1px solid var(--input-border, #2a2a2a);
		border-radius: 10px;
		color: inherit;
		padding: 10px 12px;
		font-size: 0.92rem;
		font-family: inherit;
		width: 100%;
		resize: vertical;
	}
	.mo-segment {
		display: flex;
		gap: 6px;
	}
	.mo-seg {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: var(--color-text-secondary, #bbb);
		padding: 9px 6px;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.mo-seg.active {
		background: color-mix(in srgb, var(--accent-light) 18%, transparent);
		border-color: color-mix(in srgb, var(--accent-light) 40%, transparent);
		color: var(--accent-light);
	}
	.mo-hints {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.mo-hint {
		background: rgba(255, 255, 255, 0.05);
		border: 1px dashed rgba(255, 255, 255, 0.15);
		border-radius: 999px;
		color: var(--color-text-secondary, #bbb);
		padding: 7px 12px;
		font-size: 0.8rem;
		cursor: pointer;
		text-align: left;
	}
	.mo-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
		border-top: 1px solid rgba(255, 255, 255, 0.07);
	}
	.mo-back {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		font-size: 0.9rem;
		padding: 8px 4px;
	}
</style>
