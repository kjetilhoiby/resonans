<script lang="ts">
	interface AvailableProvider {
		providerId: number;
		name: string;
		logoUrl?: string;
	}

	interface Props {
		themeId: string;
		onClose: () => void;
		onSaved?: (providerNames: string[]) => void;
	}

	let { themeId, onClose, onSaved }: Props = $props();

	let available = $state<AvailableProvider[]>([]);
	let selectedIds = $state<Set<number>>(new Set());
	let loading = $state(true);
	let saving = $state(false);
	let error = $state('');

	$effect(() => {
		void load();
	});

	async function load() {
		loading = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/films/providers?available=1`);
			if (!res.ok) throw new Error();
			const data = await res.json();
			available = data.available ?? [];
			selectedIds = new Set((data.providerIds ?? []) as number[]);
			if (available.length === 0) error = 'Fant ingen tjenester (TMDB-nøkkel mangler?).';
		} catch {
			error = 'Kunne ikke laste tjenester.';
		} finally {
			loading = false;
		}
	}

	function toggle(id: number) {
		const next = new Set(selectedIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedIds = next;
	}

	async function save() {
		saving = true;
		const chosen = available.filter((p) => selectedIds.has(p.providerId));
		try {
			const res = await fetch(`/api/tema/${themeId}/films/providers`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					providerIds: chosen.map((p) => p.providerId),
					providerNames: chosen.map((p) => p.name)
				})
			});
			if (!res.ok) throw new Error();
			onSaved?.(chosen.map((p) => p.name));
			onClose();
		} catch {
			error = 'Lagring feilet.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="fl-prefs">
	<div class="fl-prefs-head">
		<h2 class="fl-prefs-title">Mine strømmetjenester</h2>
		<button class="fl-prefs-close" onclick={onClose} aria-label="Lukk">✕</button>
	</div>
	<p class="fl-prefs-sub">Velg tjenestene du har abonnement på, så prioriterer «Hva ser jeg i kveld?» filmer du faktisk kan se.</p>

	{#if loading}
		<p class="fl-empty">Laster…</p>
	{:else if error && available.length === 0}
		<p class="fl-error">{error}</p>
	{:else}
		<div class="fl-prefs-grid">
			{#each available.slice(0, 40) as p}
				<button class="fl-prefs-opt" class:active={selectedIds.has(p.providerId)} onclick={() => toggle(p.providerId)}>
					{#if p.logoUrl}<img src={p.logoUrl} alt="" class="fl-prefs-logo" />{/if}
					<span class="fl-prefs-name">{p.name}</span>
				</button>
			{/each}
		</div>
		{#if error}<p class="fl-error">{error}</p>{/if}
		<button class="fl-prefs-save" disabled={saving} onclick={save}>{saving ? 'Lagrer…' : 'Lagre'}</button>
	{/if}
</div>

<style>
	.fl-prefs {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.fl-prefs-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.fl-prefs-title {
		margin: 0;
		font-size: 1rem;
		color: var(--film-text-primary, #eee);
	}
	.fl-prefs-close {
		background: none;
		border: none;
		color: var(--film-text-secondary, #999);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.fl-prefs-sub {
		margin: 0;
		font-size: 0.82rem;
		color: var(--film-text-secondary, #999);
		line-height: 1.4;
	}
	.fl-prefs-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		gap: 6px;
	}
	.fl-prefs-opt {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 8px;
		color: var(--film-text-secondary, #999);
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: left;
		transition: all 0.12s;
	}
	.fl-prefs-opt.active {
		background: var(--film-bg-active, #2a1418);
		border-color: var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-prefs-logo {
		width: 24px;
		height: 24px;
		border-radius: 5px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.fl-prefs-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fl-prefs-save {
		align-self: flex-start;
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 18px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-prefs-save:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 16px;
	}
	.fl-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
