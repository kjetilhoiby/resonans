<script lang="ts">
	import Skeleton from '$lib/components/ui/Skeleton.svelte';
	import type { ProgramSummary, TodaySession } from './health-data';

	interface Props {
		activeProgram: ProgramSummary | null;
		todaySession: TodaySession;
		loading: boolean;
	}

	let { activeProgram, todaySession, loading }: Props = $props();
</script>

{#if loading}
	<aside class="hd-program-card">
		<div class="hd-program-skeleton">
			<div class="hd-program-main">
				<Skeleton variant="line" width="80px" height="10px" />
				<Skeleton variant="line" width="160px" height="14px" />
				<Skeleton variant="line" width="120px" height="10px" />
			</div>
			<div class="hd-program-today">
				<Skeleton variant="line" width="30px" height="10px" />
				<Skeleton variant="line" width="70px" height="12px" />
			</div>
		</div>
	</aside>
{:else}
	<aside class="hd-program-card">
		{#if activeProgram}
			<a class="hd-program-link" href="/treningsprogram/{activeProgram.id}">
				<div class="hd-program-main">
					<span class="hd-program-label">Aktivt program</span>
					<h2 class="hd-program-name">{activeProgram.name}</h2>
					<p class="hd-program-meta">
						{activeProgram.completedSessions} / {activeProgram.totalSessions} fullført ·
						{activeProgram.durationWeeks} uker
					</p>
				</div>
				{#if todaySession}
					<div class="hd-program-today">
						<span class="hd-today-label">I dag</span>
						<span class="hd-today-name">
							{todaySession.name}
							{#if todaySession.isTest}<em class="hd-test-tag">TEST</em>{/if}
						</span>
					</div>
				{:else}
					<div class="hd-program-today">
						<span class="hd-today-label">I dag</span>
						<span class="hd-today-name hd-rest">Hviledag</span>
					</div>
				{/if}
			</a>
		{:else}
			<a class="hd-program-empty" href="/treningsprogram/ny">
				<div>
					<span class="hd-program-label">Treningsprogram</span>
					<p>Lag et hybridprogram bygget på dine faktiske PR-er og volum.</p>
				</div>
				<span class="hd-program-cta">Lag program →</span>
			</a>
		{/if}
	</aside>
{/if}

<style>
	.hd-program-card {
		display: block;
		background: linear-gradient(140deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		overflow: hidden;
		transition: border-color 120ms ease;
	}
	.hd-program-card:hover {
		border-color: rgba(255, 255, 255, 0.2);
	}
	.hd-program-skeleton {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 20px;
	}
	.hd-program-link,
	.hd-program-empty {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 20px;
		text-decoration: none;
		color: inherit;
	}
	.hd-program-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.hd-program-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	.hd-program-name {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: #eee;
	}
	.hd-program-meta {
		margin: 2px 0 0;
		font-size: 12px;
		color: #888;
	}
	.hd-program-today {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.hd-today-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	.hd-today-name {
		font-size: 14px;
		font-weight: 500;
		color: #eee;
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.hd-today-name.hd-rest {
		color: #777;
		font-style: italic;
	}
	.hd-test-tag {
		font-size: 9px;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(110, 168, 254, 0.2);
		color: #6ea8fe;
		font-style: normal;
		letter-spacing: 0.06em;
	}
	.hd-program-empty p {
		margin: 4px 0 0;
		font-size: 13px;
		color: #aaa;
		max-width: 320px;
	}
	.hd-program-cta {
		font-size: 13px;
		color: #6ea8fe;
		font-weight: 500;
		flex-shrink: 0;
	}
</style>
