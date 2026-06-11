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

	interface MonthEntry {
		key: string;
		label: string;
		workoutCount: number;
		topSport: { family: string; label: string; distanceKm: number; count: number } | null;
		stepsTotal: number | null;
		books: string[];
		headline: string | null;
	}

	interface Props {
		data: {
			birthday: { hasBirthDate: boolean; daysUntil: number | null; turningAge: number | null };
			windowLabels: { current: string; previous: string };
			current: YearData;
			previous: YearData;
			timeline: MonthEntry[];
			ordsky: Array<{ word: string; count: number; weight: number }>;
			interview: {
				thisYearKey: string;
				thisYear: InterviewAnswers | null;
				lastYear: InterviewAnswers | null;
				lastYearText: string;
				kavalkadeText: string;
			};
			prophecy: string | null;
			greetings: Array<{ character: string; book: string; text: string }>;
		};
	}

	let { data }: Props = $props();

	let interviewOpen = $state(false);
	let magiLoading = $state<'prophecy' | 'greetings' | null>(null);
	let magiError = $state('');

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

	function monthFacts(m: MonthEntry): string {
		const parts: string[] = [];
		if (m.topSport) {
			parts.push(
				m.topSport.distanceKm >= 1
					? `${m.topSport.label} ${nf.format(m.topSport.distanceKm)} km`
					: `${m.topSport.label} ${m.topSport.count} økter`
			);
		}
		if (m.workoutCount > 0) parts.push(`${m.workoutCount} økter`);
		if (m.stepsTotal !== null) parts.push(`${nfCompact.format(m.stepsTotal)} skritt`);
		if (m.books.length > 0) parts.push(`leste ${m.books.join(', ')}`);
		return parts.join(' · ');
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

	const hasBooksForGreetings = $derived(
		data.current.books.length > 0 || data.previous.books.length > 0
	);

	async function runMagi(kind: 'prophecy' | 'greetings') {
		magiLoading = kind;
		magiError = '';
		try {
			const res = await fetch('/api/kavalkade/magi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind })
			});
			if (!res.ok) {
				const err = await res.json().catch(() => null);
				magiError = err?.error ?? 'Noe gikk galt. Prøv igjen.';
				return;
			}
			await invalidateAll();
		} catch {
			magiError = 'Noe gikk galt. Prøv igjen.';
		} finally {
			magiLoading = null;
		}
	}
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

			{#if data.ordsky.length > 0}
				<SectionCard title="Året i ord" description="Det du faktisk skrev på oppgavelistene dine">
					<div class="kv-ordsky">
						{#each data.ordsky as word (word.word)}
							<span
								class="kv-ord"
								style={`font-size: calc(0.72rem + ${word.weight} * 1.1rem); opacity: ${0.55 + word.weight * 0.45};`}
								title={`${word.count} ganger`}>{word.word}</span
							>
						{/each}
					</div>
				</SectionCard>
			{/if}

			{#if data.timeline.some((m) => monthFacts(m) || m.headline)}
				<SectionCard title="Måned for måned">
					<ol class="kv-timeline">
						{#each data.timeline as month (month.key)}
							{@const facts = monthFacts(month)}
							<li class="kv-month" class:is-empty={!facts && !month.headline}>
								<SectionLabel tag="h4">{month.label}</SectionLabel>
								{#if month.headline}
									<p class="kv-month-headline">«{month.headline}»</p>
								{/if}
								{#if facts}
									<p class="kv-month-facts">{facts}</p>
								{:else if !month.headline}
									<p class="kv-month-facts kv-muted">stille måned</p>
								{/if}
							</li>
						{/each}
					</ol>
				</SectionCard>
			{/if}

			{#if data.current.books.length > 0}
				<SectionCard title="Lest i år" meta={`${data.current.books.length} bøker`}>
					<ul class="kv-books">
						{#each data.current.books as book (book.title)}
							<li>{book.title}{book.author ? ` — ${book.author}` : ''}</li>
						{/each}
					</ul>
				</SectionCard>
			{/if}

			<SectionCard title="Spådommen" description={data.prophecy ? undefined : 'La kavalkaden, intervjuet og trendene dine spå året frem til neste bursdag.'}>
				{#if data.prophecy}
					<div class="kv-prophecy">
						{#each data.prophecy.split(/\n{2,}/) as paragraph}
							<p>{paragraph}</p>
						{/each}
					</div>
				{/if}
				<div class="kv-cta">
					<Button
						variant={data.prophecy ? 'secondary' : 'primary'}
						disabled={magiLoading !== null}
						onClick={() => void runMagi('prophecy')}
					>
						{magiLoading === 'prophecy'
							? 'Ser i krystallkulen …'
							: data.prophecy
								? 'Spå på nytt'
								: 'Spå året som kommer'}
					</Button>
				</div>
			</SectionCard>

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

			{#if hasBooksForGreetings}
				<SectionCard
					title="Hilsner fra bokhylla"
					description={data.greetings.length > 0 ? undefined : 'Romankarakterene du har tilbrakt året med vil gjerne gratulere deg.'}
				>
					{#if data.greetings.length > 0}
						<div class="kv-greetings">
							{#each data.greetings as greeting (greeting.character + greeting.book)}
								<blockquote class="kv-greeting">
									<p>{greeting.text}</p>
									<footer>
										— {greeting.character}{greeting.book ? `, «${greeting.book}»` : ''}
									</footer>
								</blockquote>
							{/each}
						</div>
					{/if}
					<div class="kv-cta">
						<Button
							variant={data.greetings.length > 0 ? 'secondary' : 'primary'}
							disabled={magiLoading !== null}
							onClick={() => void runMagi('greetings')}
						>
							{magiLoading === 'greetings'
								? 'Vekker karakterene …'
								: data.greetings.length > 0
									? 'Hent nye hilsner'
									: 'Hent bursdagshilsner'}
						</Button>
					</div>
				</SectionCard>
			{/if}

			{#if magiError}
				<p class="kv-error">{magiError}</p>
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

	.kv-ordsky {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 6px 12px;
		padding: 6px 0;
	}

	.kv-ord {
		color: var(--accent-light);
		line-height: 1.2;
	}

	.kv-timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.kv-month {
		border-left: 2px solid var(--card-border, #222);
		padding-left: 12px;
	}

	.kv-month.is-empty {
		opacity: 0.55;
	}

	.kv-month-headline {
		margin: 4px 0 0;
		font-size: var(--font-size-body);
		font-style: italic;
		color: var(--text-primary);
	}

	.kv-month-facts {
		margin: 2px 0 0;
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
	}

	.kv-muted {
		color: var(--text-tertiary, var(--text-secondary));
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

	.kv-prophecy p {
		margin: 0 0 10px;
		font-size: var(--font-size-body);
		color: var(--text-primary);
	}

	.kv-prophecy p:last-child {
		margin-bottom: 0;
	}

	.kv-greetings {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.kv-greeting {
		margin: 0;
		padding: 10px 12px;
		background: var(--card-bg-inset);
		border-left: 2px solid var(--accent-muted);
		border-radius: var(--radius-md, 10px);
	}

	.kv-greeting p {
		margin: 0;
		font-size: var(--font-size-body);
		font-style: italic;
		color: var(--text-primary);
		white-space: pre-wrap;
	}

	.kv-greeting footer {
		margin-top: 6px;
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
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

	.kv-error {
		margin: 0;
		font-size: var(--font-size-caption);
		color: var(--error-text);
	}

	.kv-cta {
		margin-top: 12px;
	}
</style>
