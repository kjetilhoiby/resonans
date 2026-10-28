<script lang="ts">
	import { AppPage, Button, PageSection } from '$lib/components/ui';

	let { data } = $props();
	const name = $derived(data.fatal ? null : (data.clientName ?? 'En ukjent app'));
</script>

<svelte:head>
	<title>Koble til Resonans</title>
</svelte:head>

<AppPage uttrykk="a">
	<PageSection>
		<div class="consent">
			{#if data.fatal}
				<h1>Kan ikke koble til</h1>
				<p class="error">{data.fatal}</p>
				<p class="muted">Start tilkoblingen på nytt fra appen du kom fra.</p>
			{:else}
				<p class="eyebrow">Koble til Resonans</p>
				<h1>{name} vil få tilgang til Resonans</h1>
				<p>
					Appen får bruke Resonans-verktøyene som deg{#if data.email}&nbsp;(<strong>{data.email}</strong>){/if}:
					lese helse, trening, økonomi, familie og prosjekter, og legge inn oppgaver, mål, notater og
					logger.
				</p>
				<p class="host">
					Svaret sendes til <strong>{data.redirectHost}</strong>. Står det ikke
					<em>claude.ai</em>, <em>chatgpt.com</em> eller en app du selv har startet, skal du avslå.
				</p>
				<p class="muted">Du kan koble fra når som helst under Innstillinger → Eksterne apper.</p>

				<div class="actions">
					<form method="POST" action="?/approve">
						<input type="hidden" name="params" value={data.params} />
						<Button type="submit" fullWidth>Godta</Button>
					</form>
					<form method="POST" action="?/deny">
						<input type="hidden" name="params" value={data.params} />
						<Button type="submit" variant="secondary" fullWidth>Avslå</Button>
					</form>
				</div>
			{/if}
		</div>
	</PageSection>
</AppPage>

<style>
	.consent {
		max-width: 30rem;
		margin: 3rem auto;
		padding: 1.75rem;
		border-radius: 1.25rem;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		box-shadow: var(--shadow-md);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.eyebrow {
		margin: 0 0 0.5rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-size: 0.75rem;
		color: var(--text-tertiary);
	}

	h1 {
		margin: 0 0 1rem;
		font-size: 1.5rem;
		color: var(--text-primary);
	}

	strong {
		color: var(--text-primary);
	}

	.host {
		padding: 0.75rem 0.9rem;
		border-radius: 0.75rem;
		background: var(--warning-bg);
		border: 1px solid var(--warning-border);
	}

	.error {
		padding: 0.75rem 0.9rem;
		border-radius: 0.75rem;
		background: var(--error-bg);
		border: 1px solid var(--error-border);
		color: var(--error-text);
	}

	.muted {
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	.actions {
		display: grid;
		gap: 0.6rem;
		margin-top: 1.25rem;
	}
</style>
