<script lang="ts">
	import { AppPage, PageSection, PageHeader } from '$lib/components/ui';
	import QuizBoard from '$lib/components/domain/quiz/QuizBoard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let shareUrl = $state<string | null>(null);
	let sharing = $state(false);
	let copied = $state(false);

	async function share() {
		if (sharing) return;
		sharing = true;
		try {
			const res = await fetch('/api/quiz/share', { method: 'POST' });
			if (!res.ok) return;
			const d = (await res.json()) as { url: string };
			shareUrl = d.url;
			if (navigator.share) {
				try {
					await navigator.share({ title: 'Resonans-quiz', url: d.url });
				} catch {
					/* brukeren avbrøt delingen */
				}
			} else if (navigator.clipboard) {
				try {
					await navigator.clipboard.writeText(d.url);
					copied = true;
				} catch {
					/* ingen utklippstavle — lenken vises uansett under */
				}
			}
		} finally {
			sharing = false;
		}
	}
</script>

<svelte:head>
	<title>Spill</title>
</svelte:head>

<AppPage>
	<PageSection>
		<PageHeader title="Spill" titleHref="/">
			{#snippet actions()}
				<button
					class="share-btn"
					type="button"
					onclick={share}
					disabled={sharing}
					aria-label="Del spill-skjerm"
					data-track="spill:del-skjerm"
				>
					{sharing ? 'Deler …' : 'Del'}
				</button>
			{/snippet}
		</PageHeader>

		<QuizBoard initial={data.board} pollUrl="/api/quiz/status" />

		{#if shareUrl}
			<p class="share-url">
				{copied ? 'Lenke kopiert: ' : 'Delelenke: '}<a href={shareUrl}>{shareUrl}</a>
			</p>
		{/if}
	</PageSection>
</AppPage>

<style>
	.share-btn {
		font-size: var(--font-size-caption);
		font-weight: 600;
		color: var(--text-primary);
		background: var(--card-bg-subtle, var(--card-bg));
		border: 1px solid var(--card-border);
		border-radius: 999px;
		padding: 6px 14px;
		cursor: pointer;
	}
	.share-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.share-url {
		margin-top: var(--space-md, 12px);
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
		word-break: break-all;
	}
	.share-url a {
		color: var(--accent-primary);
	}
</style>
