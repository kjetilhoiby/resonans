<!--
  TrainingDashboard — hele treningsflaten: dagens økt, ukesbudsjett, balanse,
  ruter og milepæler.

  Bor som komponent fordi den rendres to steder: /trening (som blir en
  redirect) og Trening-undertemaet av Helse. Innholdet er uendret fra da det
  bodde i /trening/+page.svelte.
-->
<script lang="ts">
	import { createTrainingPlan, formFields } from '$lib/client/tracks-api';
	import TrackCard from '$lib/components/domain/training/TrackCard.svelte';
	import MilestoneList from '$lib/components/domain/training/MilestoneList.svelte';
	import TrackHistory from '$lib/components/domain/training/TrackHistory.svelte';
	import EffortBudgetCard from '$lib/components/domain/training/EffortBudgetCard.svelte';
	import TrainingMixCard from '$lib/components/domain/training/TrainingMixCard.svelte';
	import RouteLibrary from '$lib/components/domain/training/RouteLibrary.svelte';
	import TrainingLoadSection from '$lib/components/domain/training/TrainingLoadSection.svelte';
	import Vo2maxCard from '$lib/components/domain/training/Vo2maxCard.svelte';
	import HrRecoveryCard from '$lib/components/domain/training/HrRecoveryCard.svelte';
	import EffortWeightCard from '$lib/components/domain/health/EffortWeightCard.svelte';
	import HealthActivityList from '$lib/components/domain/health/HealthActivityList.svelte';
	import AerobicEfficiencyCard from '$lib/components/domain/health/AerobicEfficiencyCard.svelte';
	import DistanceRecordsCard from '$lib/components/domain/health/DistanceRecordsCard.svelte';
	import CompactRecordList from '$lib/components/ui/CompactRecordList.svelte';
	import { formatEvent } from '$lib/components/domain/health/health-data';
	import { computeTrainingLoad } from '$lib/util/training-load';
	import type { TrainingDashboardPayload } from '$lib/server/training-dashboard';

	let setupSubmitting = $state(false);
	let setupError = $state<string | null>(null);

	interface Props {
		data: TrainingDashboardPayload;
	}

	let { data }: Props = $props();

	// Flyttet fra helse-mortemaet i mortema-splitten: effort→vekt er effort→effekt,
	// og aktivitetslista er per-økt-detalj.
	const eventItems = $derived((data.recentEvents ?? []).slice(0, 24).map((item) => formatEvent(item)));

	// Form og belastningsbalanse — samme lesning, flyttet hit i andre runde.
	const trainingLoadSeries = $derived(computeTrainingLoad(data.dailyEffort ?? []));

	function fmtPace(secPerKm: number | null | undefined): string {
		if (secPerKm == null) return '–';
		const m = Math.floor(secPerKm / 60);
		const s = Math.round(secPerKm - m * 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	const strength = $derived(data.states?.strength ?? null);
	const endurance = $derived(data.states?.endurance ?? null);

	const styrkeMilestones = $derived(
		(data.milestones ?? []).filter((m) => m.trackId === data.states?.styrkeTrackId)
	);
	const utholdenhetMilestones = $derived(
		(data.milestones ?? []).filter((m) => m.trackId === data.states?.utholdenhetTrackId)
	);

	const styrkePct = $derived.by(() => {
		if (!strength) return null;
		const goal = data.states?.styrkeGoal?.armhevinger;
		if (!goal) return null;
		const current = strength.armhevinger.siste ?? goal.fra;
		return Math.max(0, Math.min(100, ((current - 0) / goal.til) * 100));
	});

	const utholdenhetPct = $derived.by(() => {
		if (!endurance) return null;
		const goal = data.states?.utholdenhetGoal?.ukesKm;
		if (!goal) return null;
		return Math.max(0, Math.min(100, (endurance.week.weekTargetKm / goal.til) * 100));
	});

	const strengthHistory = $derived(
		(data.states?.recentStrengthSessions ?? []).map((s) => {
			const arm = s.exercises
				.filter((e) => e.name.toLowerCase().includes('armheving'))
				.flatMap((e) => e.sets)
				.reduce((sum, set) => sum + (set.reps ?? 0), 0);
			const planke = Math.max(
				0,
				...s.exercises
					.filter((e) => e.name.toLowerCase().includes('planke') || e.name.toLowerCase().includes('plank'))
					.flatMap((e) => e.sets)
					.map((set) => set.durationSeconds ?? 0)
			);
			const parts = [arm > 0 ? `${arm} armhevinger` : null, planke > 0 ? `${planke}s planke` : null].filter(Boolean);
			return { date: s.date, label: 'Styrke', detail: parts.join(' · ') || `${s.exercises.length} øvelser` };
		})
	);

	const enduranceHistory = $derived(
		(data.states?.recentEnduranceWorkouts ?? [])
			.filter((w) => ['running', 'cycling', 'ebike'].includes(w.family))
			.map((w) => {
				const km = w.distanceMeters != null ? `${(w.distanceMeters / 1000).toFixed(1)} km` : '';
				const label = w.family === 'running' ? 'Løp' : w.family === 'ebike' ? 'El-sykkel' : 'Sykkel';
				const pace =
					w.family === 'running' && w.distanceMeters && w.durationSeconds
						? ` @ ${fmtPace(w.durationSeconds / (w.distanceMeters / 1000))}`
						: '';
				return { date: w.date, label, detail: `${km}${pace}` };
			})
	);

	const todayText = $derived.by(() => {
		const s = data.states;
		if (!s) return '';
		// Registrert trening vinner alltid — aldri «jeg hadde foreslått hvile»
		if (s.todayCompleted) return `Gjennomført: ${s.todayCompleted.name} ✓`;
		if (s.restReason) return s.restReason;
		const t = s.todaySuggestion;
		if (t?.plannedRun) {
			const km = t.plannedRun.targetDistanceMeters != null ? `${(t.plannedRun.targetDistanceMeters / 1000).toFixed(1)} km` : '';
			return `${t.name}: ${km} @ ${fmtPace(t.plannedRun.paceHintSecPerKm)}/km`;
		}
		if (t) return t.name;
		return 'Ingen planlagt økt i dag — styrkemålene ligger klare i Ekko når det passer.';
	});

	const strengthTargetsText = $derived.by(() => {
		const t = data.states?.strengthSuggestion;
		if (!t?.plannedExercises) return null;
		return t.plannedExercises
			.map((e) =>
				e.repsTarget != null ? `${e.exerciseName} ${e.sets}×${e.repsTarget}` : `${e.exerciseName} ${e.sets}×${e.durationSecondsTarget}s`
			)
			.join(' · ');
	});
</script>


		{#if !data.plan}
			<!-- Oppsett-modus -->
			<section class="setup-card">
				<h2>Start treningsløpene</h2>
				<p>
					To uavhengige løp over 26 uker: styrke (armhevinger mot 100 per økt, pull-up, planke) og
					utholdenhet (mot 22 km/uke i 5:30-pace, der sykkel teller med). Progresjonen følger det du
					faktisk registrerer i Ekko.
				</p>
				<form
					method="POST"
					onsubmit={async (event) => {
						event.preventDefault();
						const form = event.currentTarget as HTMLFormElement;
						const fields = formFields(form);
						setupSubmitting = true;
						setupError = await createTrainingPlan({
							armhevinger: Number(fields.armhevinger),
							planke: Number(fields.planke),
							pullupNegativ: Number(fields.pullupNegativ),
							ukesKm: Number(fields.ukesKm),
							paceSek: Number(fields.paceSek)
						});
						setupSubmitting = false;
					}}
				>
					<div class="field-grid">
						<label>
							Armhevinger per økt nå
							<input type="number" name="armhevinger" value="10" min="1" data-track="trening:oppsett-armhevinger" />
						</label>
						<label>
							Planke nå (sek)
							<input type="number" name="planke" value="30" min="5" data-track="trening:oppsett-planke" />
						</label>
						<label>
							Negativ pull-up nå (sek)
							<input type="number" name="pullupNegativ" value="10" min="1" data-track="trening:oppsett-pullup" />
						</label>
						<label>
							Løpevolum nå (km/uke)
							<input type="number" name="ukesKm" value={data.snapshot?.recentVolumeKm && data.snapshot.recentVolumeKm > 0 ? Math.round(data.snapshot.recentVolumeKm) : 14} min="1" data-track="trening:oppsett-ukeskm" />
						</label>
						<label>
							Vanlig pace nå (sek/km)
							<input type="number" name="paceSek" value="400" min="180" data-track="trening:oppsett-pace" />
						</label>
					</div>
					{#if setupError}
						<p class="form-error" role="alert">{setupError}</p>
					{/if}
					<button type="submit" class="primary" disabled={setupSubmitting}>
						{setupSubmitting ? 'Starter …' : 'Start løpene'}
					</button>
				</form>
			</section>
		{:else}
			<!-- Dagens økt -->
			<section class="today-card">
				<h2>I dag</h2>
				<p class="today-text">{todayText}</p>
				{#if data.states?.todaySuggestion?.notes}
					<p class="today-note">{data.states.todaySuggestion.notes}</p>
				{/if}
				{#if !data.states?.todayCompleted && strengthTargetsText}
					<p class="today-note">Styrkemål nå: {strengthTargetsText}</p>
				{/if}
			</section>

			{#if data.states?.budget}
				<EffortBudgetCard
					budget={data.states.budget}
					composition={data.states.effortComposition}
					sessions={data.states.weekSessions ?? []}
					planExamples={data.states.planExamples ?? []}
					weightThreshold={data.states.weightThreshold ?? null}
					projection={data.states.projection ?? null}
					boost={data.states.boost ?? null}
					weekRecipe={data.states.weekRecipe ?? null}
				/>
			{/if}

			{#if data.states?.balance}
				<TrainingMixCard balance={data.states.balance} />
			{/if}

			{#if strength}
				<TrackCard
					title="Styrke"
					subtitle="Mot 100 armhevinger, 3 pull-ups og 60 s planke"
					progressPct={styrkePct}
					badge={strength.armhevinger.stall || strength.planke.stall ? 'Justert ned' : undefined}
					rows={[
						{
							label: 'Armhevinger',
							value: `${strength.armhevinger.siste ?? '–'}`,
							hint: `neste mål ${strength.armhevinger.nesteTarget}`
						},
						{
							label: 'Planke',
							value: strength.planke.sisteSek != null ? `${strength.planke.sisteSek}s` : '–',
							hint: `neste mål ${strength.planke.nesteTargetSek}s`
						},
						{
							label: 'Pull-up',
							value:
								strength.pullup.fase === 'negativer'
									? strength.pullup.sisteNegativSek != null
										? `${strength.pullup.sisteNegativSek}s negativ`
										: 'negativer'
									: `${strength.pullup.sisteReps ?? 0} strikte`,
							hint:
								strength.pullup.fase === 'negativer'
									? `neste mål ${strength.pullup.nesteTarget.negativSek}s`
									: `neste mål ${strength.pullup.nesteTarget.reps} reps`
						}
					]}
				/>
				<MilestoneList title="Milepæler — styrke" milestones={styrkeMilestones} />
				<TrackHistory title="Siste styrkeøkter" entries={strengthHistory} />
			{/if}

			{#if endurance}
				<TrackCard
					title="Utholdenhet"
					subtitle="Mot 22 km/uke i 5:30-pace — sykkel telles i ukas effort"
					progressPct={utholdenhetPct}
					badge={endurance.week.deload ? 'Deload-uke' : endurance.week.stallRebased ? 'Justert ned' : undefined}
					rows={[
						{
							label: 'Løpt denne uken',
							value: `${endurance.week.runKm} km`,
							hint: `av ${endurance.week.weekTargetKm} km — sykkel telles i ukas effort`
						},
						{
							label: 'Pace',
							value: endurance.sistePaceSekPerKm != null ? `${fmtPace(endurance.sistePaceSekPerKm)}/km` : '–',
							hint: `forventet ${fmtPace(endurance.forventetPaceSekPerKm)}/km`
						},
						{
							label: 'Gjenstår',
							value: `${endurance.week.remainingKm} km`,
							hint: endurance.week.remainingKm <= 1 ? 'uken er i mål' : undefined
						}
					]}
				/>
				<MilestoneList title="Milepæler — utholdenhet" milestones={utholdenhetMilestones} />
				<TrackHistory title="Siste økter" entries={enduranceHistory} />
			{/if}

			<RouteLibrary routes={data.states?.routes ?? []} />
		{/if}

		<!-- Øktene først. De er det man kommer hit for å se, og de sto tidligere
		     under fire kort med avledede tall. -->
		{#if (data.activities?.length ?? 0) > 0}
			<HealthActivityList activities={data.activities} />
		{/if}

		<!-- Trening → effekt, samlet: fart per hjerteslag, oksygenopptak,
		     form/balanse og effort→vekt. Utenfor plan-grenen, fordi de er verdt
		     å se også i oppsett-modus.

		     EF står FØR VO2max med vilje: den måler pulskostnaden ved en gitt
		     fart på rolige økter, mens VDOT antar maksimal innsats og gir et
		     fantomfall i uker uten hard løping. -->
		<AerobicEfficiencyCard data={data.aerobicEfficiency ?? null} />

		<DistanceRecordsCard records={data.distanceRecords ?? []} />

		<Vo2maxCard metric={data.vo2max ?? null} />

		<HrRecoveryCard metric={data.hrRecovery ?? null} />

		<TrainingLoadSection series={trainingLoadSeries} />

		<EffortWeightCard />

		{#if eventItems.length > 0}
			<details class="tr-events-details">
				<summary class="tr-events-summary">
					<span class="tr-events-title">Hendelsesdetaljer</span>
					<span class="tr-events-count">({eventItems.length} hendelser)</span>
				</summary>
				<div class="tr-events-content">
					<CompactRecordList title="" items={eventItems} emptyText="Ingen hendelser registrert ennå." />
				</div>
			</details>
		{/if}

<style>
	.tr-events-details {
		background: #141414;
		border-radius: 18px;
		margin-top: 12px;
	}

	.tr-events-summary {
		cursor: pointer;
		padding: 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		list-style: none;
		user-select: none;
	}

	.tr-events-summary::-webkit-details-marker,
	.tr-events-summary::marker {
		display: none;
	}

	.tr-events-title {
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.tr-events-count {
		font-size: 0.74rem;
		color: #777;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 3px 10px;
	}

	.tr-events-content {
		padding: 0 16px 16px 16px;
	}

	.setup-card,
	.today-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.setup-card h2,
	.today-card h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}

	.setup-card p {
		font-size: 0.88rem;
		color: var(--text-secondary, #aaa);
		margin: 0;
		line-height: 1.5;
	}

	.field-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		font-size: 0.78rem;
		color: var(--text-secondary, #aaa);
	}

	input {
		background: var(--card-bg-inset, #0d0d0d);
		border: 1px solid var(--card-border, #242424);
		border-radius: 10px;
		color: var(--text-primary, #eee);
		padding: 0.5rem 0.65rem;
		font-size: 0.95rem;
	}

	button.primary {
		align-self: flex-start;
		background: var(--accent-primary, #4a5af0);
		color: #fff;
		border: none;
		border-radius: 12px;
		padding: 0.6rem 1.2rem;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		margin-top: 0.5rem;
	}

	button.primary:hover {
		background: var(--accent-hover, #3f4de0);
	}

	.today-text {
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary, #eee);
		margin: 0;
	}

	.today-note {
		font-size: 0.82rem;
		color: var(--text-secondary, #aaa);
		margin: 0;
	}
</style>

