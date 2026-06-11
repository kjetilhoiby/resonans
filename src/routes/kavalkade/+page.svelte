<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AppPage, PageSection, PageHeader, SectionCard, SectionLabel, Button } from '$lib/components/ui';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import { INTERVIEW_SECTIONS, type InterviewAnswers } from '$lib/flows/birthday-interview';

	interface LabeledSport {
		family: string;
		label: string;
		count: number;
		distanceKm: number;
		durationHours: number;
	}

	interface YearData {
		workoutCount: number;
		sports: LabeledSport[];
		stepsTotal: number | null;
		sleepAvgHours: number | null;
		weightStartKg: number | null;
		weightEndKg: number | null;
		weightChangeKg: number | null;
		screenTimeAvgMinPerDay: number | null;
		books: Array<{ title: string; author: string | null }>;
	}

	interface Props {
		data: {
			birthday: { hasBirthDate: boolean; daysUntil: number | null; turningAge: number | null };
			windowLabels: { current: string; previous: string };
			current: YearData;
			previous: YearData;
			interview: {
				thisYearKey: string;
				thisYear: InterviewAnswers | null;
				lastYear: InterviewAnswers | null;
				lastYearText: string;
				kavalkadeText: string;
			};
		};
	}

	let { data }: Props = $props();

	let interviewOpen = $state(false);

	const nf = new Intl.NumberFormat('nb-NO');
	const nfCompact = new Intl.NumberFormat('nb-NO', { notation: 'compact', maximumFractionDigits: 1 });

	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	function sportValue(s: LabeledSport): string {
		return s.distanceKm >= 1 ? `${nf.format(s.distanceKm)} km` : `${s.count} økter`;
	}

	function weightValue(y: YearData): string {
		if (y.weightStartKg === null || y.weightEndKg === null) return '–';
		const change = y.weightChangeKg;
		const arrow = `${nf.format(y.weightStartKg)} → ${nf.format(y.weightEndKg)} kg`;
		return change !== null ? `${arrow} (${change > 0 ? '+' : ''}${nf.format(change)})` : arrow;
	}

	const stats = $derived.by(() => {
		const rows: Array<{ label: string; value: string; prev: string }> = [];
		const prevByFamily = new Map(data.previous.sports.map((s) => [s.family, s]));

		for (const sport of data.current.sports) {
			const prev = prevByFamily.get(sport.family);
			rows.push({
				label: cap(sport.label),
				value: sportValue(sport),
				prev: prev ? sportValue(prev) : '–'
			});
		}
		rows.push({
			label: 'Treningsøkter',
			value: nf.format(data.current.workoutCount),
			prev: nf.format(data.previous.workoutCount)
		});
		if (data.current.stepsTotal !== null || data.previous.stepsTotal !== null) {
			rows.push({
				label: 'Skritt',
				value: data.current.stepsTotal !== null ? nfCompact.format(data.current.stepsTotal) : '–',
				prev: data.previous.stepsTotal !== null ? nfCompact.format(data.previous.stepsTotal) : '–'
			});
		}
		rows.push({
			label: 'Bøker lest',
			value: nf.format(data.current.books.length),
			prev: nf.format(data.previous.books.length)
		});
		if (data.current.sleepAvgHours !== null || data.previous.sleepAvgHours !== null) {
			rows.push({
				label: 'Søvn per natt',
				value: data.current.sleepAvgHours !== null ? `${nf.format(data.current.sleepAvgHours)} t` : '–',
				prev: data.previous.sleepAvgHours !== null ? `${nf.format(data.previous.sleepAvgHours)} t` : '–'
			});
		}
		if (data.current.weightStartKg !== null || data.previous.weightStartKg !== null) {
			rows.push({ label: 'Vekt', value: weightValue(data.current), prev: weightValue(data.previous) });
		}
		if (data.current.screenTimeAvgMinPerDay !== null || data.previous.screenTimeAvgMinPerDay !== null) {
			rows.push({
				label: 'Skjermtid per dag',
				value:
					data.current.screenTimeAvgMinPerDay !== null
						? `${nf.format(data.current.screenTimeAvgMinPerDay)} min`
						: '–',
				prev:
					data.previous.screenTimeAvgMinPerDay !== null
						? `${nf.format(data.previous.screenTimeAvgMinPerDay)} min`
						: '–'
			});
		}
		return rows;
	});

	const introText = $derived.by(() => {
		const { hasBirthDate, daysUntil, turningAge } = data.birthday;
		if (hasBirthDate && daysUntil !== null && turningAge !== null) {
			if (daysUntil === 0) return `Gratulerer med dagen! I dag fyller du ${turningAge} år.`;
			if (daysUntil === 1) return `I morgen fyller du ${turningAge} år. Her er året som har gått.`;
			return `Om ${daysUntil} dager fyller du ${turningAge} år. Her er året som har gått.`;
		}
		return 'De siste tolv månedene i tall — og et intervju med deg selv.';
	});
</script>

<svelte:head>
	<title>Årskavalkade</title>
</svelte:head>

<AppPage>
	<PageSection>
		<div class="kavalkade-page">
			<PageHeader title="Årskavalkade" titleHref="/" emoji="🎂" />
			<p class="kv-intro">{introText}</p>

			<SectionCard title="Året i tall" meta={data.windowLabels.current}>
				{#if stats.length > 0}
					<div class="kv-stats">
						{#each stats as stat (stat.label)}
							<div class="kv-stat">
								<span class="kv-stat-label">{stat.label}</span>
								<span class="kv-stat-value">{stat.value}</span>
								<span class="kv-stat-prev">i fjor: {stat.prev}</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="kv-empty">Ingen data registrert for året ennå.</p>
				{/if}
			</SectionCard>

			{#if data.current.books.length > 0}
				<SectionCard title="Lest i år" meta={`${data.current.books.length} bøker`}>
					<ul class="kv-books">
						{#each data.current.books as book (book.title)}
							<li>{book.title}{book.author ? ` — ${book.author}` : ''}</li>
						{/each}
					</ul>
				</SectionCard>
			{/if}

			{#if data.interview.thisYear}
				<SectionCard title="Hvem er du i år?" meta={data.interview.thisYearKey}>
					<div class="kv-answers">
						{#each INTERVIEW_SECTIONS as section (section.id)}
							{#if data.interview.thisYear[section.id]}
								<div class="kv-answer">
									<SectionLabel tag="h4">{section.heading}</SectionLabel>
									<p>{data.interview.thisYear[section.id]}</p>
								</div>
							{/if}
						{/each}
					</div>
					<div class="kv-cta">
						<Button variant="secondary" onClick={() => (interviewOpen = true)}>
							Gjør intervjuet på nytt
						</Button>
					</div>
				</SectionCard>
			{:else}
				<SectionCard
					title="Bursdagsintervjuet"
					description="Hvem er du i år — og hvem var du i fjor? Ti spørsmål om endringer, minner og årets beste. Svarene lagres, så neste år kan du se deg selv i speilet."
				>
					<div class="kv-cta">
						<Button onClick={() => (interviewOpen = true)}>Start bursdagsintervjuet</Button>
					</div>
				</SectionCard>
			{/if}

			{#if data.interview.lastYear}
				<SectionCard title="Hvem var du i fjor?" meta={String(Number(data.interview.thisYearKey) - 1)}>
					<div class="kv-answers">
						{#each INTERVIEW_SECTIONS as section (section.id)}
							{#if data.interview.lastYear[section.id]}
								<div class="kv-answer">
									<SectionLabel tag="h4">{section.heading}</SectionLabel>
									<p>{data.interview.lastYear[section.id]}</p>
								</div>
							{/if}
						{/each}
					</div>
				</SectionCard>
			{/if}
		</div>
	</PageSection>
</AppPage>

<FlowSheet
	flow={interviewOpen ? FLOWS.birthday_interview : null}
	context={{
		initialData: {
			_lastYearAnswers: data.interview.lastYearText,
			_kavalkadeSummary: data.interview.kavalkadeText
		}
	}}
	onclose={() => (interviewOpen = false)}
	oncomplete={async () => {
		interviewOpen = false;
		await invalidateAll();
	}}
/>

<style>
	.kavalkade-page {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding-bottom: 110px;
	}

	.kv-intro {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-body);
	}

	.kv-stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.kv-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: var(--card-bg-inset);
		border-radius: var(--radius-md, 10px);
		padding: 10px 12px;
		min-width: 0;
	}

	.kv-stat-label {
		font-size: var(--font-size-caption);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	.kv-stat-value {
		font-size: var(--font-size-title);
		font-weight: 700;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}

	.kv-stat-prev {
		font-size: var(--font-size-caption);
		color: var(--text-tertiary, var(--text-secondary));
	}

	.kv-empty {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-body);
	}

	.kv-books {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-answers {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.kv-answer p {
		margin: 4px 0 0;
		font-size: var(--font-size-body);
		color: var(--text-primary);
		white-space: pre-wrap;
	}

	.kv-cta {
		margin-top: 12px;
	}
</style>
