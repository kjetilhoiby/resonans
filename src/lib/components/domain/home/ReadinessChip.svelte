<!--
  Readiness-chip for hjemskjermen: dagens treningstilstand (dot + label).
  Ren presentasjonskomponent — trukket ut fra HomeChatZone, markup og CSS uendret.
-->
<script lang="ts">
	export interface ReadinessInfo {
		programName: string;
		state: 'klar' | 'lett' | 'easy' | 'rest';
		alternativeName: string | null;
	}

	interface Props {
		readiness: ReadinessInfo;
		onClick: () => void;
	}

	let { readiness, onClick }: Props = $props();
</script>

<button
	class="readiness-chip readiness-{readiness.state}"
	onclick={onClick}
	aria-label="Dagens treningstilstand"
>
	<span class="readiness-dot">
		{#if readiness.state === 'klar'}🟢{:else if readiness.state === 'lett'}🟡{:else if readiness.state === 'easy'}🟠{:else}🔴{/if}
	</span>
	<span class="readiness-label">
		{#if readiness.state === 'klar'}I dag: Klar for {readiness.programName}
		{:else if readiness.state === 'rest'}I dag: Hvile{readiness.alternativeName ? ` — ${readiness.alternativeName}` : ''}
		{:else}I dag: {readiness.alternativeName ?? (readiness.state === 'lett' ? 'Lett på' : 'Easy-dag')}
		{/if}
	</span>
</button>

<style>
	.readiness-chip { display: flex; align-items: center; gap: 8px; padding: 8px 14px; margin: 0 0 8px; border-radius: 999px; background: var(--bg-secondary); border: 1px solid var(--border-subtle); color: var(--text-primary); font-size: 13px; cursor: pointer; max-width: 100%; text-align: left; }
	.readiness-chip:hover { border-color: var(--accent-primary); }
	.readiness-chip.readiness-klar { border-left: 4px solid #34d399; }
	.readiness-chip.readiness-lett { border-left: 4px solid #fbbf24; }
	.readiness-chip.readiness-easy { border-left: 4px solid #fb923c; }
	.readiness-chip.readiness-rest { border-left: 4px solid #f87171; }
	.readiness-dot { font-size: 14px; flex-shrink: 0; }
	.readiness-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
