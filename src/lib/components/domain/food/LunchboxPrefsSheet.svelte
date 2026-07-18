<!--
  LunchboxPrefsSheet — preferanser per barn (liker/liker ikke/allergier/appetitt)
  og felles komponentbibliotek (pålegg, brød, frukt, grønt, nøtter).
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import Button from '../../ui/Button.svelte';
	import { KIND_META, type ComponentKind } from '$lib/domains/food/lunchbox';

	type Component = { id: string; name: string; kind: string; tags: string[]; active: boolean };

	interface Props {
		child: {
			personId: string;
			name: string;
			profile: { likes: string[]; dislikes: string[]; allergies: string[]; appetite: string; notes: string | null };
		};
		components: Component[];
		onclose: () => void;
		onchanged: () => void;
	}

	let { child, components, onclose, onchanged }: Props = $props();

	let tab = $state<'prefs' | 'bibliotek'>('prefs');
	let likes = $state(child.profile.likes.join(', '));
	let dislikes = $state(child.profile.dislikes.join(', '));
	let allergies = $state(child.profile.allergies.join(', '));
	let appetite = $state(child.profile.appetite);
	let notes = $state(child.profile.notes ?? '');
	let saving = $state(false);

	let localComponents = $state<Component[]>([...components]);
	let newName = $state('');
	let newKind = $state<ComponentKind>('palegg');

	const KINDS = Object.entries(KIND_META) as Array<[ComponentKind, { label: string; emoji: string }]>;

	function parseList(text: string): string[] {
		return text.split(',').map((s) => s.trim()).filter(Boolean);
	}

	async function saveProfile() {
		saving = true;
		try {
			await fetch('/api/food/lunchbox/profiles', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					personId: child.personId,
					likes: parseList(likes),
					dislikes: parseList(dislikes),
					allergies: parseList(allergies),
					appetite,
					notes: notes.trim() || null
				})
			});
			onchanged();
		} finally {
			saving = false;
		}
	}

	async function addComponent() {
		const name = newName.trim();
		if (!name) return;
		const res = await fetch('/api/food/lunchbox/components', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, kind: newKind })
		});
		if (res.ok) {
			const data = await res.json();
			localComponents = [...localComponents.filter((c) => c.id !== data.component.id), data.component];
			newName = '';
		}
	}

	async function removeComponent(component: Component) {
		await fetch(`/api/food/lunchbox/components?id=${component.id}`, { method: 'DELETE' });
		localComponents = localComponents.filter((c) => c.id !== component.id);
	}

	function grouped(): Array<[ComponentKind, Component[]]> {
		return KINDS.map(([kind]) => [
			kind,
			localComponents.filter((c) => c.kind === kind && c.active)
		]);
	}
</script>

<BottomSheet {onclose} ariaLabel={`Matpakke-innstillinger for ${child.name}`}>
	<header class="lp-header">
		<h2>🥪 {child.name}</h2>
		<button class="lp-close" onclick={onclose} aria-label="Lukk innstillinger">✕</button>
	</header>

	<div class="lp-tabs" role="tablist">
		<button class="lp-tab" class:active={tab === 'prefs'} role="tab" aria-selected={tab === 'prefs'} onclick={() => (tab = 'prefs')}>
			Preferanser
		</button>
		<button class="lp-tab" class:active={tab === 'bibliotek'} role="tab" aria-selected={tab === 'bibliotek'} onclick={() => (tab = 'bibliotek')}>
			Bibliotek
		</button>
	</div>

	<div class="lp-body">
		{#if tab === 'prefs'}
			<label class="lp-field">
				<span class="lp-label">Liker <span class="lp-hint">(kommaseparert)</span></span>
				<input class="lp-input" bind:value={likes} placeholder="hvitost, eple, salami" data-track="matpakke:liker" />
			</label>
			<label class="lp-field">
				<span class="lp-label">Liker ikke</span>
				<input class="lp-input" bind:value={dislikes} placeholder="leverpostei, agurk" data-track="matpakke:liker-ikke" />
			</label>
			<label class="lp-field">
				<span class="lp-label">Allergier</span>
				<input class="lp-input" bind:value={allergies} placeholder="peanøtter" data-track="matpakke:allergier" />
			</label>
			<div class="lp-field">
				<span class="lp-label">Appetitt</span>
				<div class="lp-segment" role="radiogroup" aria-label="Appetitt">
					{#each [['liten', 'Liten (1 skive)'], ['middels', 'Middels (2)'], ['stor', 'Stor (3)']] as [value, label]}
						<button
							class="lp-seg-btn"
							class:active={appetite === value}
							role="radio"
							aria-checked={appetite === value}
							onclick={() => (appetite = value)}
							data-track="matpakke:appetitt"
						>{label}</button>
					{/each}
				</div>
			</div>
			<label class="lp-field">
				<span class="lp-label">Notat</span>
				<textarea class="lp-input" bind:value={notes} rows="2" placeholder="F.eks. «vil ha oppkuttet frukt»" data-track="matpakke:notat"></textarea>
			</label>
		{:else}
			<p class="lp-desc">Felles bibliotek for alle matpakkene — pålegg, brød, frukt, grønt og nøtter det er aktuelt å sende med.</p>
			<div class="lp-add">
				<input
					class="lp-input"
					bind:value={newName}
					placeholder="Ny komponent…"
					onkeydown={(e) => e.key === 'Enter' && addComponent()}
					data-track="matpakke:ny-komponent"
				/>
				<select class="lp-select" bind:value={newKind} data-track="matpakke:komponent-type">
					{#each KINDS as [kind, meta]}
						<option value={kind}>{meta.emoji} {meta.label}</option>
					{/each}
				</select>
				<button class="lp-add-btn" onclick={addComponent} aria-label="Legg til komponent">+</button>
			</div>
			{#each grouped() as [kind, items]}
				{#if items.length > 0}
					<div class="lp-group">
						<span class="lp-label">{KIND_META[kind].emoji} {KIND_META[kind].label}</span>
						<div class="lp-group-chips">
							{#each items as component}
								<span class="lp-comp-chip">
									{component.name}
									<button
										class="lp-comp-remove"
										onclick={() => removeComponent(component)}
										aria-label={`Fjern ${component.name} fra biblioteket`}
										data-track="matpakke:fjern-komponent"
									>✕</button>
								</span>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		{/if}
	</div>

	{#if tab === 'prefs'}
		<footer class="lp-footer">
			<Button onClick={saveProfile} disabled={saving} fullWidth>
				{saving ? 'Lagrer…' : 'Lagre preferanser'}
			</Button>
		</footer>
	{/if}
</BottomSheet>

<style>
	.lp-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 8px;
	}
	.lp-header h2 {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 700;
	}
	.lp-close {
		background: none;
		border: none;
		color: var(--color-text-secondary, #999);
		cursor: pointer;
		padding: 6px;
	}
	.lp-tabs {
		display: flex;
		gap: 6px;
		padding: 0 20px 10px;
	}
	.lp-tab {
		background: rgba(255, 255, 255, 0.05);
		border: none;
		border-radius: 999px;
		color: var(--color-text-secondary, #aaa);
		padding: 7px 14px;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.lp-tab.active {
		background: rgba(124, 142, 245, 0.18);
		color: var(--accent-light);
	}
	.lp-body {
		overflow-y: auto;
		padding: 4px 20px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.lp-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lp-label {
		font-size: 0.76rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-text-secondary, #999);
	}
	.lp-hint {
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}
	.lp-input,
	.lp-select {
		background: var(--input-bg, #1a1a1a);
		border: 1px solid var(--input-border, #2a2a2a);
		border-radius: 10px;
		color: inherit;
		padding: 10px 12px;
		font-size: 0.92rem;
		font-family: inherit;
		width: 100%;
	}
	.lp-segment {
		display: flex;
		gap: 6px;
	}
	.lp-seg-btn {
		flex: 1;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		color: var(--color-text-secondary, #bbb);
		padding: 9px 6px;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.lp-seg-btn.active {
		background: rgba(124, 142, 245, 0.18);
		border-color: rgba(124, 142, 245, 0.4);
		color: var(--accent-light);
	}
	.lp-desc {
		margin: 0;
		font-size: 0.84rem;
		color: var(--color-text-secondary, #999);
		line-height: 1.45;
	}
	.lp-add {
		display: grid;
		grid-template-columns: 1fr 130px 42px;
		gap: 6px;
	}
	.lp-add-btn {
		background: rgba(124, 142, 245, 0.18);
		border: none;
		border-radius: 10px;
		color: var(--accent-light);
		font-size: 1.1rem;
		cursor: pointer;
	}
	.lp-group {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lp-group-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.lp-comp-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 999px;
		padding: 6px 11px;
		font-size: 0.82rem;
	}
	.lp-comp-remove {
		background: none;
		border: none;
		color: var(--color-text-secondary, #888);
		cursor: pointer;
		font-size: 0.7rem;
		padding: 0;
	}
	.lp-footer {
		padding: 12px 20px calc(16px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--sheet-border, #222);
	}
</style>
