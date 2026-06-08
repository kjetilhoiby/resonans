<script lang="ts">
	interface Props {
		isDayChecklist: boolean;
		calendarHref: string;
		hasNavigateDay: boolean;
		onNavigatePrev: () => void;
		onNavigateNext: () => void;
		onDelete: () => void;
	}

	let { isDayChecklist, calendarHref, hasNavigateDay, onNavigatePrev, onNavigateNext, onDelete }: Props = $props();
</script>

<div class="cs-footer">
	{#if isDayChecklist && hasNavigateDay}
		<div class="cs-day-nav">
			<button class="cs-day-nav-btn" onclick={onNavigatePrev} aria-label="Forrige dag">&lsaquo;</button>
			<a class="cs-calendar-link" href={calendarHref}>Åpne i kalender</a>
			<button class="cs-day-nav-btn" onclick={onNavigateNext} aria-label="Neste dag">&rsaquo;</button>
		</div>
	{:else}
		<a class="cs-calendar-link" href={calendarHref}>Åpne i kalender</a>
	{/if}
	<button class="cs-delete-btn" onclick={onDelete}>Slett liste</button>
</div>

<style>
	.cs-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 20px 20px;
		flex-shrink: 0;
	}

	.cs-calendar-link {
		font-size: 0.74rem;
		color: #8ea0ff;
		text-decoration: none;
		border: 1px solid #2f365f;
		background: #151821;
		padding: 6px 10px;
		border-radius: 8px;
	}

	.cs-calendar-link:hover {
		color: #c7d0ff;
		border-color: #4653a6;
	}

	.cs-day-nav {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cs-day-nav-btn {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid #2f365f;
		background: #151821;
		color: #8ea0ff;
		font-size: 1.1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s;
		padding: 0;
		line-height: 1;
	}

	.cs-day-nav-btn:hover {
		color: #c7d0ff;
		border-color: #4653a6;
	}

	.cs-delete-btn {
		background: transparent;
		border: none;
		color: #555;
		font-size: 0.72rem;
		cursor: pointer;
		padding: 4px 0;
		transition: color 0.12s;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.cs-delete-btn:hover { color: #e07070; }
</style>
