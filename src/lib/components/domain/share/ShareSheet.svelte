<script lang="ts">
	import { onMount } from 'svelte';

	type ShareItem = {
		id: string;
		token: string;
		accessMode: 'read' | 'write';
		allowedEmail: string | null;
		label: string | null;
		expiresAt: string | Date | null;
		lastAccessedAt: string | Date | null;
		accessCount: number;
		createdAt: string | Date;
	};

	type Props = {
		resourceType: 'checklist' | 'themeList' | 'tripPosition';
		resourceId: string;
		resourceTitle: string;
		open: boolean;
		onClose: () => void;
	};

	let { resourceType, resourceId, resourceTitle, open, onClose }: Props = $props();

	let existing = $state<ShareItem[]>([]);
	let loading = $state(false);
	let creating = $state(false);
	let errorMessage = $state<string | null>(null);
	let lastCreatedUrl = $state<string | null>(null);

	let mode = $state<'open' | 'email'>('open');
	let allowEdit = $state<boolean>(resourceType !== 'tripPosition');
	let allowedEmail = $state('');
	let label = $state('');
	let expiresInDays = $state<number | ''>('');

	const canEdit = $derived(resourceType !== 'tripPosition');

	async function loadExisting() {
		loading = true;
		errorMessage = null;
		try {
			const res = await fetch(
				`/api/share?resourceType=${resourceType}&resourceId=${resourceId}`
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			existing = await res.json();
		} catch (err) {
			errorMessage = 'Kunne ikke hente eksisterende delinger.';
			console.error(err);
		} finally {
			loading = false;
		}
	}

	async function createShare() {
		errorMessage = null;
		if (mode === 'email' && !allowedEmail.trim()) {
			errorMessage = 'Skriv inn e-post for å låse delingen.';
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					resourceType,
					resourceId,
					accessMode: canEdit && allowEdit ? 'write' : 'read',
					allowedEmail: mode === 'email' ? allowedEmail.trim().toLowerCase() : null,
					label: label.trim() || null,
					expiresInDays: typeof expiresInDays === 'number' && expiresInDays > 0 ? expiresInDays : null
				})
			});
			const data = await res.json();
			if (!res.ok) {
				errorMessage = data.error ?? `Feil: HTTP ${res.status}`;
				return;
			}
			lastCreatedUrl = `${window.location.origin}/share/${data.token}`;
			label = '';
			allowedEmail = '';
			expiresInDays = '';
			await loadExisting();
		} catch (err) {
			errorMessage = 'Klarte ikke opprette deling.';
			console.error(err);
		} finally {
			creating = false;
		}
	}

	async function revoke(id: string) {
		if (!confirm('Trekk tilbake denne delingen? Lenken vil slutte å fungere.')) return;
		const res = await fetch(`/api/share/${id}`, { method: 'DELETE' });
		if (res.ok) {
			await loadExisting();
		} else {
			errorMessage = 'Klarte ikke trekke tilbake delingen.';
		}
	}

	function shareUrl(token: string): string {
		if (typeof window === 'undefined') return `/share/${token}`;
		return `${window.location.origin}/share/${token}`;
	}

	async function copyUrl(url: string) {
		try {
			await navigator.clipboard.writeText(url);
		} catch (err) {
			console.warn(err);
		}
	}

	$effect(() => {
		if (open) {
			lastCreatedUrl = null;
			loadExisting();
		}
	});
</script>

{#if open}
	<div class="backdrop" role="presentation" onclick={onClose}></div>
	<dialog open class="sheet">
		<header>
			<h2>Del «{resourceTitle}»</h2>
			<button type="button" class="close" onclick={onClose} aria-label="Lukk">✕</button>
		</header>

		<section class="create">
			<h3>Ny delingslenke</h3>

			<fieldset>
				<legend>Hvem skal ha tilgang?</legend>
				<label>
					<input type="radio" bind:group={mode} value="open" />
					Åpen lenke — hvem som helst med lenken
				</label>
				<label>
					<input type="radio" bind:group={mode} value="email" />
					E-post-låst — kun denne brukeren (krever innlogging)
				</label>
			</fieldset>

			{#if mode === 'email'}
				<label class="field">
					<span>E-post</span>
					<input
						type="email"
						bind:value={allowedEmail}
						placeholder="navn@eksempel.no"
					/>
				</label>
			{/if}

			<label class="field">
				<span>Etikett (for deg)</span>
				<input
					type="text"
					bind:value={label}
					placeholder="F.eks. 'Tante Kari'"
					maxlength="80"
				/>
			</label>

			<label class="field">
				<span>Utløper om (dager)</span>
				<input
					type="number"
					min="1"
					max="3650"
					bind:value={expiresInDays}
					placeholder="(uten utløp)"
				/>
			</label>

			{#if canEdit}
				<label class="field-checkbox">
					<input type="checkbox" bind:checked={allowEdit} />
					Tillat at mottaker krysser av elementer
				</label>
			{/if}

			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}

			<button type="button" class="primary" onclick={createShare} disabled={creating}>
				{creating ? 'Oppretter…' : 'Opprett lenke'}
			</button>

			{#if lastCreatedUrl}
				<div class="created">
					<p>Lenke opprettet:</p>
					<input type="text" readonly value={lastCreatedUrl} onfocus={(e) => e.currentTarget.select()} />
					<button type="button" onclick={() => copyUrl(lastCreatedUrl!)}>Kopier</button>
				</div>
			{/if}
		</section>

		<section class="existing">
			<h3>Aktive delinger ({existing.length})</h3>
			{#if loading}
				<p>Laster…</p>
			{:else if existing.length === 0}
				<p class="empty">Ingen aktive delinger enda.</p>
			{:else}
				<ul>
					{#each existing as share (share.id)}
						<li>
							<div class="share-info">
								<div class="share-title">
									{share.label ?? (share.allowedEmail ?? 'Åpen lenke')}
									<span class="mode">({share.accessMode === 'write' ? 'kan endre' : 'kun lese'})</span>
								</div>
								<div class="share-meta">
									{share.accessCount} besøk
									{#if share.lastAccessedAt}
										· sist {new Date(share.lastAccessedAt).toLocaleString('nb-NO')}
									{/if}
								</div>
								<input
									type="text"
									readonly
									value={shareUrl(share.token)}
									onfocus={(e) => e.currentTarget.select()}
								/>
							</div>
							<div class="share-actions">
								<button type="button" onclick={() => copyUrl(shareUrl(share.token))}>Kopier</button>
								<button type="button" class="danger" onclick={() => revoke(share.id)}>Trekk tilbake</button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</dialog>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 999;
	}
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		max-width: 560px;
		margin: 0 auto;
		background: white;
		border: none;
		border-radius: 16px 16px 0 0;
		padding: 1.25rem;
		max-height: 85vh;
		overflow-y: auto;
		z-index: 1000;
		font-family: system-ui, -apple-system, sans-serif;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	header h2 {
		font-size: 1.1rem;
		margin: 0;
	}
	.close {
		background: none;
		border: none;
		font-size: 1.4rem;
		cursor: pointer;
	}
	h3 {
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
		margin: 1.25rem 0 0.5rem;
	}
	fieldset {
		border: none;
		padding: 0;
		margin: 0 0 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	fieldset legend {
		font-size: 0.85rem;
		color: #555;
		margin-bottom: 0.3rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin-bottom: 0.6rem;
	}
	.field span {
		font-size: 0.8rem;
		color: #555;
	}
	.field input {
		padding: 0.5rem;
		border: 1px solid #ddd;
		border-radius: 6px;
		font-size: 0.9rem;
	}
	.field-checkbox {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.9rem;
		margin-bottom: 0.75rem;
	}
	.primary {
		background: #7c8ef5;
		color: white;
		border: none;
		padding: 0.6rem 1rem;
		border-radius: 8px;
		font-size: 0.95rem;
		cursor: pointer;
		width: 100%;
	}
	.primary:disabled {
		opacity: 0.6;
	}
	.created {
		margin-top: 0.75rem;
		background: #f4f5f9;
		padding: 0.75rem;
		border-radius: 8px;
	}
	.created p {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
	}
	.created input {
		width: 100%;
		padding: 0.4rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.85rem;
		margin-bottom: 0.4rem;
	}
	.error {
		background: #fff2f2;
		border: 1px solid #f5c2c2;
		color: #b00020;
		padding: 0.5rem;
		border-radius: 6px;
		font-size: 0.85rem;
	}
	.existing ul {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.existing li {
		border: 1px solid #eee;
		border-radius: 8px;
		padding: 0.75rem;
		margin-bottom: 0.6rem;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.share-info {
		flex: 1;
		min-width: 240px;
	}
	.share-title {
		font-weight: 500;
	}
	.mode {
		color: #888;
		font-weight: normal;
		font-size: 0.8rem;
	}
	.share-meta {
		font-size: 0.75rem;
		color: #777;
		margin: 0.15rem 0 0.3rem;
	}
	.share-info input {
		width: 100%;
		padding: 0.3rem;
		border: 1px solid #ddd;
		border-radius: 4px;
		font-size: 0.75rem;
	}
	.share-actions {
		display: flex;
		gap: 0.4rem;
		flex-direction: column;
	}
	.share-actions button {
		padding: 0.35rem 0.7rem;
		border: 1px solid #ddd;
		background: white;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.8rem;
	}
	.share-actions .danger {
		color: #b00020;
		border-color: #f5c2c2;
	}
	.empty {
		color: #888;
		font-size: 0.85rem;
	}
</style>
