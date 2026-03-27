<script lang="ts">
	import { fade, fly, slide, scale } from 'svelte/transition';
	import { cubicOut, elasticOut } from 'svelte/easing';

	// ── Theme toggle ─────────────────────────────────────────────────────────
	let forcedTheme = $state<'light' | 'dark' | 'auto'>('auto');

	// ── Section nav ──────────────────────────────────────────────────────────
	const sections = [
		'Farger',
		'Typografi',
		'Spacing & Layout',
		'Knapper',
		'Kort & Flater',
		'Input',
		'Stat-kort',
		'Fremgangsmåler',
		'Diagrammer (mock)',
		'Navigasjon',
		'Animasjoner',
		'Chat',
		'Toast & Feedback',
		'Modus: Fokus & Komposisjon',
		'Modus: Oversikt & Organisering',
		'Modus: Kontinuitet & Utvikling',
		'Modus: Refleksjon & Sinnstemning',
		'Modus: Vitalitet & Helse',
		'Modus: Ninthlife',
		'Interaksjonsflyter',
		'Hjemskjerm: Tre soner',
		'Widgets — galleri',
	] as const;
	let activeSection = $state<string>('Farger');

	// ── Animation demo ────────────────────────────────────────────────────────
	let showFly = $state(true);
	let showScale = $state(true);
	let pulseActive = $state(false);

	function toggleFly() { showFly = false; setTimeout(() => (showFly = true), 50); }
	function toggleScale() { showScale = false; setTimeout(() => (showScale = true), 50); }

	// ── Progress demo ─────────────────────────────────────────────────────────
	let progressValue = $state(67);

	// ── Toast demo ────────────────────────────────────────────────────────────
	type Toast = { id: number; type: 'success' | 'error' | 'info'; message: string };
	let toasts = $state<Toast[]>([]);
	let toastCounter = 0;
	function showToast(type: Toast['type'], message: string) {
		const id = ++toastCounter;
		toasts = [...toasts, { id, type, message }];
		setTimeout(() => { toasts = toasts.filter(t => t.id !== id); }, 3000);
	}

	// ── Chart mock data ───────────────────────────────────────────────────────
	const sparkData = [40, 55, 45, 60, 52, 70, 65, 80, 75, 90, 85, 95];
	const barData = [
		{ label: 'Man', value: 8200 },
		{ label: 'Tir', value: 6300 },
		{ label: 'Ons', value: 9100 },
		{ label: 'Tor', value: 7800 },
		{ label: 'Fre', value: 11200 },
		{ label: 'Lør', value: 4500 },
		{ label: 'Søn', value: 3200 },
	];
	const maxBar = Math.max(...barData.map(d => d.value));

	// ── Ring chart ────────────────────────────────────────────────────────────
	const ringGoal = 10000;
	const ringActual = 7340;
	const ringPct = Math.min(ringActual / ringGoal, 1);
	const circumference = 2 * Math.PI * 40;
	const ringDash = ringPct * circumference;

	// ── Oversikt & Organisering (ChatGPT-inspirert) ─────────────────────────
	const cgProjects = [
		{ icon: '📁', name: 'Helse & trening' },
		{ icon: '📁', name: 'Økonomi' },
		{ icon: '📁', name: 'Relasjoner' },
	];
	const cgRecent = [
		'Ukentlig treningsplan',
		'Søvnvaner og restitusjon',
		'Budsjett mars 2026',
		'Påske med familien',
		'Karrieremål 2026',
	];
	let cgShowMore = $state(false);

	const cgConversations = [
		{ title: 'Stressmestring og planlegging', preview: 'Bøy, gåtur på 8–9 km og bolle i sola.' },
		{ title: 'Personlig treningsplan', preview: 'Jeg skal først og fremst svare på de sju sp…' },
		{ title: 'Søvn og restitusjon', preview: 'Anbefaler 7–9 timer for optimal restitusjon.' },
		{ title: 'Løpeplan for vår 2026', preview: 'Klarer du å lage filer jeg kan importere?' },
		{ title: 'Ukeplan strategi', preview: 'Jeg tror vel at jeg er mer opptatt av å inv…' },
		{ title: 'Mikroøkt og yoga', preview: 'Nå har det gått 30 måneder siden inngrepet' },
	];
	let cgProjectTab = $state<'samtaler' | 'filer'>('samtaler');

	// ── Tempo modus ─────────────────────────────────────────────────────────
	const tempoStats = [
		{ label: 'LAST 365', value: '255 km' },
		{ label: 'LAST 30',  value: '34 km'  },
		{ label: 'LAST 7',   value: '24 km'  },
		{ label: 'THIS YEAR',  value: '74 km'  },
		{ label: 'THIS MONTH', value: '34 km'  },
		{ label: 'THIS WEEK',  value: '16 km'  },
	];

	// Calendar: days in March with activities
	const tempoCalDays = Array.from({ length: 29 }, (_, i) => {
		const day = i + 1;
		const activities: Record<number, { km: string; intensity: 'high' | 'mid' | 'low' }> = {
			6:  { km: '5,3', intensity: 'high' },
			18: { km: '5,0', intensity: 'mid'  },
			20: { km: '8,4', intensity: 'mid'  },
			24: { km: '8,3', intensity: 'low'  },
		};
		return { day, activity: activities[day] ?? null };
	});

	// Cumulative chart
	const tempoCumData = [0,3,3,3,3,9,9,17,25,33,42,52,62,67];
	const tempoGoalLine = 50;
	const tempoCumMax = Math.max(...tempoCumData, tempoGoalLine) * 1.05;
	function tempoCumPath() {
		const w = 300, h = 140;
		return tempoCumData.map((v, i) => {
			const x = (i / (tempoCumData.length - 1)) * w;
			const y = h - (v / tempoCumMax) * h;
			return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		}).join(' ');
	}
	function tempoCumArea() {
		const w = 300, h = 140;
		const pts = tempoCumData.map((v, i) => {
			const x = (i / (tempoCumData.length - 1)) * w;
			const y = h - (v / tempoCumMax) * h;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		});
		return `${pts.join(' ')} 300,${h} 0,${h}`;
	}
	const tempoGoalY = (1 - tempoGoalLine / tempoCumMax) * 140;

	// YTD comparison
	const tempoYtdRows = [
		{ icon: '⇔', label: 'DISTANCE',         prev: '3,11 km',  curr: '3,95 km',  delta: '+0,83 km',  up: true  },
		{ icon: '⏱', label: 'PACE',              prev: "9'34\"/km", curr: "8'05\"/km", delta: "→1'30\"",    up: true  },
		{ icon: '⏳', label: 'DURATION',           prev: '29m 48s',  curr: '31m 55s',  delta: '+2m 7s',   up: true  },
		{ icon: '🔥', label: 'ACTIVE CALORIES', prev: '450 cal',  curr: '294 cal',  delta: '↓156 cal', up: false },
	];

	// Stoic modus ────────────────────────────────────────────────────────
	let stoicMood = $state(55);
	const stoicMoodLabels = ['Forferdelig', 'Dårlig', 'OK', 'Bra', 'Flott'];
	const stoicMoodLabel = $derived(stoicMoodLabels[Math.min(4, Math.floor(stoicMood / 20))]);

	const stoicEmotions = ['Modig','Tilfreds','Stolt','Elsket','Spent','Rolig','Glad','Takknemlig','Motivert','Avslappet','Engstelig','Sliten'];
	let stoicSelectedEmotions = $state<string[]>([]);
	let stoicShowMoreEmotions = $state(false);

	const stoicContexts = [
		{ icon: '💼', label: 'Jobb'       },
		{ icon: '👨‍👩‍👧', label: 'Familie'    },
		{ icon: '💛', label: 'Partner'    },
		{ icon: '🏋️', label: 'Trening'    },
		{ icon: '🩺', label: 'Helse'      },
		{ icon: '🌿', label: 'Natur'      },
		{ icon: '🛀', label: 'Egenomsorg' },
		{ icon: '📚', label: 'Læring'     },
		{ icon: '🎮', label: 'Fritid'     },
	];
	let stoicSelectedContexts = $state<string[]>([]);

	let stoicJournalText = $state('');
	let stoicStep = $state<'mood' | 'emotions' | 'context' | 'journal'>('mood');

	function toggleEmotion(e: string) {
		stoicSelectedEmotions = stoicSelectedEmotions.includes(e)
			? stoicSelectedEmotions.filter(x => x !== e)
			: [...stoicSelectedEmotions, e];
	}
	function toggleContext(l: string) {
		stoicSelectedContexts = stoicSelectedContexts.includes(l)
			? stoicSelectedContexts.filter(x => x !== l)
			: [...stoicSelectedContexts, l];
	}

	// ── Withings Health Mate: Vitalitet & Helse ───────────────────────────────
	// Score pill row
	const hmScores = [
		{ icon: '🛏', color: '#6070d0', label: 'Søvn', pts: 83 },
		{ icon: '🏃', color: '#c9a227', label: 'Aktivitet', pts: 62 },
		{ icon: '✗',  color: '#9070c0', label: 'Form',  pts: 71 },
	];

	// Score timeline (Previous → Current → Prediction)
	let hmActiveScore = $state<'søvn'|'aktivitet'|'form'>('aktivitet');
	const hmScoreTimeline = {
		søvn:      { prev: 80, curr: 83, delta: '+3', label: 'Stabil' },
		aktivitet: { prev: 60, curr: 62, delta: '+2', label: 'Stabil' },
		form:      { prev: 68, curr: 71, delta: '+3', label: 'Forbedring' },
	};

	// Metric cards
	const hmMetrics = [
		{
			icon: '🛏', label: 'Søvnkvalitet', date: '25. mar',
			value: '8t 02', unit: '', tag: '92', tagColor: '#22c55e',
			sparkType: 'bar' as const,
			spark: [40,55,30,60,70,50,80,75,90,85,95,100,88,92],
		},
		{
			icon: '✗', label: 'Vekt', date: '24. mar',
			value: '102,8', unit: 'kg', tag: 'Stabil', tagColor: '#6090e0',
			sparkType: 'line' as const,
			spark: [103.2,103.0,102.8,103.1,102.9,102.7,102.8,102.6,102.8],
		},
		{
			icon: '🏃', label: 'Skritt per dag', date: '20:56',
			value: '12 344', unit: '', tag: '102% mål', tagColor: '#22c55e',
			sparkType: 'bar' as const,
			spark: [5000,4200,8000,9500,6000,11000,12344],
		},
		{
			icon: '❤️', label: 'Gj.sn. hjertefrekvens', date: '20:55',
			value: '78', unit: 'bpm', tag: 'Normal', tagColor: '#aaa',
			sparkType: 'line' as const,
			spark: [76,78,80,77,75,79,82,78,76,78,80,79,77,78],
		},
	];

	// Bar→dot animation toggle
	let hmViewMode = $state<'bar'|'dot'>('bar');
	let hmAnimating = $state(false);
	const hmTl = $derived(hmScoreTimeline[hmActiveScore]);
	function hmToggleView() {
		hmAnimating = true;
		setTimeout(() => {
			hmViewMode = hmViewMode === 'bar' ? 'dot' : 'bar';
			hmAnimating = false;
		}, 350);
	}

	// Steps sparkline with goal dotted line
	const hmStepsData = [4200, 5800, 6100, 8900, 7200, 11000, 12344];
	const hmStepsGoal = 8000;
	const hmStepsMax = Math.max(...hmStepsData);
	const hmGoalY = 100 - (hmStepsGoal / hmStepsMax) * 85;
	function hmBarPath(data: number[], maxVal: number, w: number, h: number) {
		const bw = w / data.length;
		return data.map((v, i) => {
			const bh = (v / maxVal) * h;
			return `M${i*bw + bw*0.15},${h} L${i*bw + bw*0.15},${h - bh} L${i*bw + bw*0.85},${h - bh} L${i*bw + bw*0.85},${h} Z`;
		}).join(' ');
	}
	function hmLinePath(data: number[], maxVal: number, w: number, h: number) {
		return data.map((v, i) => {
			const x = (i / (data.length - 1)) * w;
			const y = h - (v / maxVal) * h;
			return `${i === 0 ? 'M' : 'L'}${x},${y}`;
		}).join(' ');
	}
	// ── Interaksjonsflyter ──────────────────────────────────────────────────────

	// Flow 1: Auto-insight push
	const ifInsights = [
		{ icon: '⬇', color: '#22c55e', label: 'Vekten din har gått ned', sub: '102,8 kg → 101,4 kg denne uken', cta: 'Se graf' },
		{ icon: '🏃', color: '#6090e0', label: 'I forrige uke løp du 24 km', sub: '3 økter · snitt 8:05 min/km · 🔥 nytt pers', cta: 'Detaljer' },
		{ icon: '😴', color: '#9070c0', label: 'Søvnen din er forbedret', sub: 'Gj.sn. 7t 48m siste 7 dager (+34 min)', cta: 'Utforsk' },
	];

	// Flow 2: System-1 sliders
	let ifEnergyLevel = $state(65);
	let ifMoodLevel   = $state(72);
	let ifFocusLevel  = $state(50);
	const ifEnergyLabel = $derived(
		ifEnergyLevel < 30 ? 'Utslitt' :
		ifEnergyLevel < 55 ? 'Sliten' :
		ifEnergyLevel < 75 ? 'Grei' :
		ifEnergyLevel < 90 ? 'Energisk' : 'På topp'
	);
	const ifMoodLabel = $derived(
		ifMoodLevel < 30 ? 'Nedfor' :
		ifMoodLevel < 55 ? 'Flat' :
		ifMoodLevel < 75 ? 'OK' :
		ifMoodLevel < 90 ? 'Bra' : 'Strålende'
	);
	const ifFocusLabel = $derived(
		ifFocusLevel < 40 ? 'Distrahert' :
		ifFocusLevel < 70 ? 'Middels' : 'Skjerpet'
	);
	let ifQuickMoodPick = $state<string | null>(null);
	const ifMoodPills = ['😔','😐','🙂','😄','🤩'];

	// Flow 3: Strength form
	const ifStrengthExercises = [
		{ name: 'Knebøy',         sets: 3, reps: 5, kg: 100 },
		{ name: 'Benkpress',      sets: 3, reps: 5, kg: 80  },
		{ name: 'Markløft',       sets: 1, reps: 5, kg: 140 },
		{ name: 'Overhead press', sets: 3, reps: 5, kg: 55  },
	];
	let ifStrengthRows = $state(ifStrengthExercises.map(e => ({ ...e })));
	function ifAddRow() {
		ifStrengthRows = [...ifStrengthRows, { name: '', sets: 3, reps: 8, kg: 0 }];
	}

	// Flow 4: Image upload
	let ifImageUploaded = $state(false);
	let ifImageCaption  = $state('');
	const ifSampleCaption = 'Skjermtid: 4t 12m. Instagram 1t 20m, Safari 52m, YouTube 41m. Over snittet ditt på 3t 30m.';

	// Flow 5: Free write + prompt
	let ifFreeText = $state('');
	let ifFreeAnalyzed = $state(false);
	const ifFreePrompt = 'Hva tok energi fra deg i dag, og hva gav deg energi?';
	const ifFreeAnalysis = [
		{ label: 'Tema', value: 'Arbeidspress, sosiale relasjoner' },
		{ label: 'Tone', value: 'Ambivalent → oppløftende' },
		{ label: 'Viktigst å følge opp', value: 'Grensesetting på jobb' },
	];

	// Flow 6: Project context files
	const ifProjectFiles = [
		{ icon: '📄', name: 'Treningsprogram vår 2026.pdf',     size: '312 KB', type: 'pdf'   },
		{ icon: '🖼', name: 'Blodprøvesvar 14. mars.jpg',       size: '1,2 MB', type: 'image' },
		{ icon: '📊', name: 'Kostdagbok.xlsx',                  size: '88 KB',  type: 'sheet' },
		{ icon: '📝', name: 'Mål og motivasjon 2026.txt',       size: '4 KB',   type: 'text'  },
	];
	let ifProjectChatText = $state('');

	// Flow 7: Spontan chat → stille minne
	const ifSpontThread: {s:'u'|'a', t:string, mem?:boolean}[] = [
		{ s:'u', t:'Jeg hater jobben' },
		{ s:'a', t:'Det høres tungt ut. Hva er det som gnager mest akkurat nå?' },
		{ s:'u', t:'Bare føler meg usynlig i møter' },
		{ s:'a', t:'Det er et viktig signal. Jeg husker dette.', mem: true },
	];

	// Flow 8: Bot forbeslår tema + engasjementsnivå
	const ifRunThread: {s:'u'|'a', t:string}[] = [
		{ s:'u', t:'Jeg begynte å løpe igjen i forrige uke' },
		{ s:'a', t:'Bra! Hvor langt kom du?' },
		{ s:'u', t:'4 km, men føltes tungt' },
		{ s:'a', t:'Helt normalt etter pause. Vil du at jeg husker dette som del av noe større?' },
	];
	let ifEngLvl = $state<number|null>(null);
	let ifEngStep = $state(0);
	const ifEngItems = [
		{ lbl: 'Glem', desc: 'Ingen sporingstillatelse. Slutt her.', col: '#555' },
		{ lbl: 'Husk', desc: 'Lager et minne, ingen tema.', col: '#7a8a9a' },
		{ lbl: 'Tema', desc: 'Lagrer samtalen under et tema du kan finne igjen.', col: '#5fa0a0' },
		{ lbl: 'Spor', desc: 'Kobler temaet til målbare registreringer.', col: '#7c8ef5' },
		{ lbl: 'Pakka', desc: 'Intervju, 5-årshorisont, metrikker og daglig sjekk.', col: '#e07070' },
	];
	const ifPakkaMetrics = ['km/uke', 'snitt-tempo', 'hvilepuls', 'vekt', 'kalorier'];
	let ifPakkaMetricSel = $state<string[]>(['km/uke', 'snitt-tempo']);
	function ifToggleMetric(m: string) {
		ifPakkaMetricSel = ifPakkaMetricSel.includes(m)
			? ifPakkaMetricSel.filter(x => x !== m)
			: [...ifPakkaMetricSel, m];
	}

	// Flow 9: Bot ber om input — variantgalleri
	let ifBotAskMood = $state(62);
	const ifBotAskMoodLabel = $derived(
		ifBotAskMood < 22 ? 'Tung' :
		ifBotAskMood < 42 ? 'Flat' :
		ifBotAskMood < 62 ? 'OK' :
		ifBotAskMood < 82 ? 'Bra' : 'Strålende'
	);
	const ifBotAskMoodEmoji = $derived(
		ifBotAskMood < 22 ? '😔' :
		ifBotAskMood < 42 ? '😐' :
		ifBotAskMood < 62 ? '🙂' :
		ifBotAskMood < 82 ? '😊' : '🤩'
	);
	let ifBotAskMoodSaved = $state(false);
	let ifBotAskEmoji = $state<string | null>(null);
	const ifBotAskEmojiSet = ['😔', '😐', '🙂', '😊', '🤩'];
	let ifBotAskEnergy = $state<number | null>(null);

	// Flow 10: Meldingstriage
	let ifTriageScenario = $state(0);
	// Scenario 0: "Jeg hater jobben"
	let ifTriage0Decision = $state<'glem' | 'prosjekt' | null>(null);
	let ifTriage0ProjType = $state<'forbedre' | 'ny' | null>(null);
	// Scenario 1: "Jeg løp 8,2 km"
	let ifTriage1Decision = $state<'maal' | 'tema' | 'husk' | null>(null);
	// Scenario 2: "Jeg må fikse syklene"
	let ifTriage2Step = $state(0);
	let ifTriage2TaskOpen = $state<number[]>([]);
	function ifTriage2Toggle(i: number) {
		ifTriage2TaskOpen = ifTriage2TaskOpen.includes(i)
			? ifTriage2TaskOpen.filter(x => x !== i)
			: [...ifTriage2TaskOpen, i];
	}
	// Scenario 3: "Jeg vil lære å løpe"
	let ifTriage3EngLvl = $state<number | null>(null);
	let ifTriage3Step = $state(0);
	const ifTriage3EngItems = [
		{ lbl: 'Glem', col: '#555' },
		{ lbl: 'Husk', col: '#7a8a9a' },
		{ lbl: 'Tema', col: '#5fa0a0' },
		{ lbl: 'Spor', col: '#7c8ef5' },
		{ lbl: 'Pakka', col: '#e07070' },
	];
	const ifTriageScenarios = [
		{ msg: 'Jeg hater jobben 😤', tag: 'Emosjon', col: '#e07070' },
		{ msg: 'Jeg løp 8,2 km i dag', tag: 'Aktivitet', col: '#5fa0a0' },
		{ msg: 'Jeg må fikse syklene', tag: 'Oppgave', col: '#f0b429' },
		{ msg: 'Jeg vil lære å løpe', tag: 'Aspirasjon', col: '#7c8ef5' },
	];
	function ifTriageReset() {
		ifTriage0Decision = null; ifTriage0ProjType = null;
		ifTriage1Decision = null;
		ifTriage2Step = 0; ifTriage2TaskOpen = [];
		ifTriage3EngLvl = null; ifTriage3Step = 0;
	}

	// ── Widget galleri — interaktiv state ───────────────────────────────────
	let wgRunPeriod = $state<'uke' | 'måned' | 'kvartal'>('kvartal');
	const wgRunData: Record<string, { delta: string; pct: number; ctx: string }> = {
		uke:     { delta: '+3',  pct: 79, ctx: 'km foran plan' },
		måned:   { delta: '+8',  pct: 62, ctx: 'km foran plan' },
		kvartal: { delta: '+12', pct: 71, ctx: 'km foran plan' },
	};
	let wgWeightPeriod = $state<'7d' | '30d' | '90d'>('30d');
	const wgWeightData: Record<string, { delta: string; pct: number; col: string }> = {
		'7d':  { delta: '−0.4', pct: 40, col: '#5fa0a0' },
		'30d': { delta: '−1.1', pct: 55, col: '#5fa0a0' },
		'90d': { delta: '+2.7', pct: 22, col: '#e07070' },
	};

	// ── Ninthlife ─────────────────────────────────────────────────────────────

	// Metric selector tabs
	const nlMetrics = [
		{ key: 'vekt',     label: 'Vekt',     unit: 'kg' },
		{ key: 'søvn',     label: 'Søvn',     unit: 'h' },
		{ key: 'søvnslep', label: 'Søvnslep', unit: 'min' },
		{ key: 'skritt',   label: 'Skritt',   unit: 'k' },
		{ key: 'løp',      label: 'Løp',      unit: 'km' },
		{ key: 'fart',     label: 'Fart',     unit: 's/km' },
		{ key: 'min',      label: 'Min',      unit: 'min' },
	];
	let nlActiveMetric = $state('vekt');

	// Summary circles: [period-label, value, color]
	const nlCircleData: Record<string, [string, string, string][]> = {
		vekt:   [['2026','+1.6 kg','#e07070'],['MAR','-0.9 kg','#5fa0a0'],['UKE 13','+0.3 kg','#9090a0'],
		         ['365','+2.7 kg','#e07070'],['30','-0.9 kg','#5fa0a0'],['7','-0.4 kg','#5fa0a0']],
		skritt: [['2026','6.3k','#e07070'],['MAR','6.1k','#5fa0a0'],['UKE 13','7.2k','#5fa0a0'],
		         ['365','6.2k','#5fa0a0'],['30','6.0k','#9090a0'],['7','8.1k','#5fa0a0']],
		løp:    [['2026','74 km','#e07070'],['MAR','34 km','#5fa0a0'],['UKE 13','16 km','#5fa0a0'],
		         ['365','255 km','#5fa0a0'],['30','34 km','#5fa0a0'],['7','24 km','#5fa0a0']],
		søvn:   [['2026','7.6h','#5fa0a0'],['MAR','7.8h','#5fa0a0'],['UKE 13','8.0h','#5fa0a0'],
		         ['365','7.5h','#5fa0a0'],['30','7.7h','#5fa0a0'],['7','8.1h','#5fa0a0']],
		meta:   [['2026','–','#9090a0'],['MAR','–','#9090a0'],['UKE 13','–','#9090a0'],
		         ['365','–','#9090a0'],['30','–','#9090a0'],['7','–','#9090a0']],
	};
	function nlCircles(metric: string) {
		return nlCircleData[metric] ?? nlCircleData['meta'];
	}

	// Active circle → show chart overlay
	let nlActiveCircle = $state<number | null>(null);

	// Accumulated comparison chart (orange = nå, grey = da)
	// Synthetic 52-point weight data for the year
	const nlNå  = Array.from({length:40}, (_,i) => 102.0 + Math.sin(i*0.4)*1.2 + i*-0.015 + (Math.random()*0.6-0.3));
	const nlDa  = Array.from({length:40}, (_,i) => 104.0 + Math.sin(i*0.35)*1.5 + i*-0.02  + (Math.random()*0.7-0.35));
	function nlSvgLine(data: number[], maxY: number, minY: number, w: number, h: number) {
		return data.map((v,i) => {
			const x = (i/(data.length-1))*w;
			const y = h - ((v-minY)/(maxY-minY))*h;
			return `${i===0?'M':'L'}${x.toFixed(1)},${y.toFixed(1)}`;
		}).join(' ');
	}
	const nlAllVals = [...nlNå, ...nlDa];
	const nlMinY = Math.floor(Math.min(...nlAllVals)) - 1;
	const nlMaxY = Math.ceil(Math.max(...nlAllVals)) + 1;

	// Period breakdown table
	const nlPeriods = ['Årlig','Månedlig','Ukentlig'] as const;
	let nlActivePeriod = $state<'Årlig'|'Månedlig'|'Ukentlig'>('Årlig');
	const nlTableCols = [
		{ icon: '📅', key: 'cal' },
		{ icon: '🛏', key: 'søvn' },
		{ icon: '🚶', key: 'skritt' },
		{ icon: '🏃', key: 'løp' },
		{ icon: '🫁', key: 'vo2' },
		{ icon: '⚖️', key: 'vekt' },
	];
	const nlTableRows: Record<string, {row: string, vals: {v: string, c: string}[]}[]> = {
		'Årlig': [
			{ row: '2026', vals: [{v:'–',c:'n'},{v:'–',c:'n'},{v:'3.7',c:'p'},{v:'–',c:'n'},{v:'2',c:'p'},{v:'1.9',c:'p'}] },
			{ row: '2025', vals: [{v:'–',c:'n'},{v:'–',c:'n'},{v:'6.2',c:'p'},{v:'313.1',c:'t'},{v:'10',c:'p'},{v:'-0.5',c:'t'}] },
			{ row: '2024', vals: [{v:'–',c:'n'},{v:'–',c:'n'},{v:'6.2',c:'p'},{v:'406.8',c:'t'},{v:'15.1',c:'p'},{v:'1.5',c:'p'}] },
			{ row: '2023', vals: [{v:'–',c:'n'},{v:'–',c:'n'},{v:'5.8',c:'p'},{v:'132.6',c:'g'},{v:'4.8',c:'p'},{v:'5.8',c:'p'}] },
			{ row: '2022', vals: [{v:'–',c:'n'},{v:'–',c:'n'},{v:'5.9',c:'p'},{v:'598.1',c:'t'},{v:'12.2',c:'p'},{v:'-0.7',c:'t'}] },
		],
		'Månedlig': [
			{ row: 'Mar 26', vals: [{v:'–',c:'n'},{v:'7.8h',c:'t'},{v:'6.6',c:'p'},{v:'34',c:'t'},{v:'2',c:'p'},{v:'-0.9',c:'t'}] },
			{ row: 'Feb 26', vals: [{v:'–',c:'n'},{v:'7.5h',c:'p'},{v:'6.1',c:'p'},{v:'22',c:'p'},{v:'1.8',c:'p'},{v:'0.4',c:'p'}] },
			{ row: 'Jan 26', vals: [{v:'–',c:'n'},{v:'7.3h',c:'p'},{v:'5.9',c:'p'},{v:'18',c:'p'},{v:'1.5',c:'p'},{v:'2.1',c:'p'}] },
			{ row: 'Des 25', vals: [{v:'–',c:'n'},{v:'7.1h',c:'p'},{v:'5.2',c:'g'},{v:'12',c:'g'},{v:'1.1',c:'g'},{v:'-0.3',c:'t'}] },
		],
		'Ukentlig': [
			{ row: 'Uke 13', vals: [{v:'–',c:'n'},{v:'8.0h',c:'t'},{v:'7.2',c:'p'},{v:'24',c:'t'},{v:'2.1',c:'p'},{v:'0.3',c:'p'}] },
			{ row: 'Uke 12', vals: [{v:'–',c:'n'},{v:'7.9h',c:'t'},{v:'6.8',c:'p'},{v:'10',c:'p'},{v:'2.0',c:'p'},{v:'-0.6',c:'t'}] },
			{ row: 'Uke 11', vals: [{v:'–',c:'n'},{v:'7.6h',c:'p'},{v:'6.3',c:'p'},{v:'0',c:'g'},{v:'1.9',c:'p'},{v:'-0.3',c:'t'}] },
			{ row: 'Uke 10', vals: [{v:'–',c:'n'},{v:'7.4h',c:'p'},{v:'6.0',c:'p'},{v:'14',c:'p'},{v:'1.8',c:'p'},{v:'0.2',c:'p'}] },
		],
	};
	// c values: p=pink, t=teal, g=grey, n=none
	const nlCellColor: Record<string,string> = {
		p: '#e07070', t: '#5fa0a0', g: '#9090a0', n: 'transparent',
	};

	// ── Hjemskjerm: Tre soner ────────────────────────────────────────────────────
	type HsPane = null | 'widget' | 'tema' | 'chat' | 'fil';
	let hsPane = $state<HsPane>(null);
	let hsActiveTema = $state(0);
	let hsActiveWidget = $state(0);
	let hsTemaSubtab = $state<'chat'|'widget'|'fil'>('chat');
	let hsChatText = $state('');
	let hsFileSuggested = $state(false);
	let hsFileAdded = $state(false);
	const hsTemaNavn = ['Trening & helse', 'Søvn & hvile', 'Økonomi', 'Jobb', 'Relasjoner'];
	const hsWidgets = [
		{ label: 'Vekt',     val: '92.1', unit: 'kg',  col: '#e07070' },
		{ label: 'Søvn',     val: '7.8',  unit: 'h',   col: '#5fa0a0' },
		{ label: 'Relasjon', val: '4.2',  unit: '/ 5', col: '#d4829a' },
	];
	const hsWidgetGrid = [
		{ label: 'Uke',       val: '−0.4', unit: 'kg', col: '#5fa0a0' },
		{ label: 'Måned',     val: '−1.1', unit: 'kg', col: '#5fa0a0' },
		{ label: 'År',        val: '+2.7', unit: 'kg', col: '#e07070' },
		{ label: 'Søvn',      val: '7.8',  unit: 'h',  col: '#5fa0a0' },
		{ label: 'Aktivitet', val: '34',   unit: 'km', col: '#7c8ef5' },
		{ label: 'Skritt',    val: '6.2',  unit: 'k',  col: '#7c8ef5' },
	];
	const hsChatThread: {s:'u'|'a', t:string, branch?:string}[] = [
		{ s:'u', t:'Jeg veide 92 kg i dag' },
		{ s:'a', t:'✦ Registrert — ned 0.4 siden sist' },
		{ s:'u', t:'Og jeg løp 6 km' },
		{ s:'a', t:'✦ Loggfører under Trening & helse', branch:'Trening & helse' },
		{ s:'u', t:'Hva er månedsgjennomsnittet?' },
		{ s:'a', t:'✦ 92.3 kg — 1.1 kg ned siste 30 dager' },
	];
	const hsFileSugg = [
		{ icon: '📊', text: 'Registrer som skjermtids-data' },
		{ icon: '📁', text: 'Legg til i Jobb & produktivitet' },
		{ icon: '✨', text: 'Start nytt prosjekt' },
	];
	let hsWidgetCtxIdx = $state<number|null>(null);
	let hsLongpressWidget = $state<number|null>(null);
	let hsLongpressTimer: ReturnType<typeof setTimeout> | undefined;
	let hsRipples = $state<{id:number, x:number, y:number, col:string}[]>([]);
	let hsRippleSeq = 0;
	let hsLpPos = { x: 0, y: 0 };
	function spawnRipple(x: number, y: number, col: string) {
		const id = ++hsRippleSeq;
		hsRipples = [...hsRipples, { id, x, y, col }];
		setTimeout(() => { hsRipples = hsRipples.filter(r => r.id !== id); }, 650);
	}
	function triggerRipple(e: PointerEvent, col = '#ffffff') {
		const phone = (e.currentTarget as HTMLElement).closest('.hs2-phone') as HTMLElement | null;
		if (!phone) return;
		const rect = phone.getBoundingClientRect();
		spawnRipple(e.clientX - rect.left, e.clientY - rect.top, col);
	}

	const bubbleItems = [
		{ emoji: '🧘', label: 'Yoga',      color: '#5eead4' },
		{ emoji: '🏃', label: 'Løping',    color: '#93c5fd' },
		{ emoji: '💪', label: 'Styrke',    color: '#c4b5fd' },
		{ emoji: '🚴', label: 'Sykkel',    color: '#86efac' },
		{ emoji: '🤸', label: 'Tøying',    color: '#fda4af' },
		{ emoji: '🏊', label: 'Svømming',  color: '#fcd34d' },
		{ emoji: '🧗', label: 'Klatring',  color: '#fb923c' },
	];

	// ── Bend modus: AI fokus entry ────────────────────────────────────────────
	let bendPrompt = $state('');
	let bendProcessing = $state(false);
	let bendProcessed = $state(false);
	let bendStatusText = $state('');
	const bendStatusSteps = ['Forstår målene dine…', 'Finner passende aktiviteter…', 'Setter sammen forslag…'];

	function simulateBendProcess() {
		if (!bendPrompt.trim()) return;
		bendProcessing = true;
		bendProcessed = false;
		let step = 0;
		bendStatusText = bendStatusSteps[0];
		const iv = setInterval(() => {
			step++;
			if (step < bendStatusSteps.length) {
				bendStatusText = bendStatusSteps[step];
			} else {
				clearInterval(iv);
				bendProcessing = false;
				bendProcessed = true;
			}
		}, 900);
	}

	// ── Bend modus: sirkel-velger ─────────────────────────────────────────────
	const circleItems = [
		{ emoji: '🧘', label: 'Bjørneklem',    bg: '#1e4a3e' },
		{ emoji: '🤸', label: 'Bredbent bøy',  bg: '#1e3a5f' },
		{ emoji: '💃', label: 'Sidebøy',        bg: '#3d2e1a' },
		{ emoji: '🏋️', label: 'Skulderpress',   bg: '#1a5c6b' },
		{ emoji: '🦵', label: 'Utfall',          bg: '#4a2a10' },
		{ emoji: '🧗', label: 'Katt-ku',         bg: '#2a4a27' },
	];
	let selectedCircles = $state<number[]>([]);
	function toggleCircle(i: number) {
		selectedCircles = selectedCircles.includes(i)
			? selectedCircles.filter(x => x !== i)
			: [...selectedCircles, i];
	}

	// ── Chat demo ─────────────────────────────────────────────────────────────
	const chatMessages = [
		{ role: 'assistant', content: 'Hei! Du nærmer deg uke-skritt-målet ditt – 7 340 av 10 000 skritt i dag 🎉' },
		{ role: 'user', content: 'Bra! Hva bør jeg fokusere på nå?' },
		{ role: 'assistant', content: 'Du sover i snitt 6,3 timer. Et delmål på 7 timer vil gi merkbar effekt på restitusjon og humør.' },
	];
	let chatInput = $state('');
</script>

<svelte:head>
	<title>Resonans – Design System</title>
</svelte:head>

<!-- Force theme on html element -->
<svelte:element this={'div'}
	class="design-root"
	data-theme={forcedTheme === 'auto' ? undefined : forcedTheme}
>

<!-- ── TOPBAR ──────────────────────────────────────────────────────────────── -->
<header class="ds-topbar">
	<span class="ds-logo">Resonans <em>Design System</em></span>
	<div class="ds-theme-toggle">
		{#each (['auto', 'light', 'dark'] as const) as t}
			<button
				class="ds-theme-btn"
				class:active={forcedTheme === t}
				onclick={() => forcedTheme = t}
			>{t === 'auto' ? '⟳ Auto' : t === 'light' ? '☀ Lys' : '☾ Mørk'}</button>
		{/each}
	</div>
</header>

<div class="ds-layout">

	<!-- ── SIDEBAR NAV ──────────────────────────────────────────────────────── -->
	<nav class="ds-sidebar">
		{#each sections as s}
			<a
				href="#{s}"
				class="ds-nav-item"
				class:active={activeSection === s}
				onclick={() => activeSection = s}
			>{s}</a>
		{/each}
	</nav>

	<!-- ── MAIN CONTENT ─────────────────────────────────────────────────────── -->
	<main class="ds-main">

		<!-- ════════════════════════════════════════════════════════════════════
		     FARGER
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Farger" class="ds-section">
			<h2 class="ds-section-heading">Farger</h2>

			<h3 class="ds-subsection">CSS-variabler (light / dark)</h3>
			<div class="ds-color-grid">
				{#each [
					['--bg-primary',   'BG primary'],
					['--bg-secondary', 'BG secondary'],
					['--bg-card',      'BG card'],
					['--bg-header',    'BG header'],
					['--bg-hover',     'BG hover'],
					['--text-primary', 'Text primary'],
					['--text-secondary','Text secondary'],
					['--text-tertiary','Text tertiary'],
					['--border-color', 'Border'],
					['--accent-primary','Accent primary'],
					['--accent-hover', 'Accent hover'],
				] as [name, label]}
					<div class="ds-color-swatch">
						<div class="ds-color-blob" style="background: var({name})"></div>
						<code class="ds-color-name">{name}</code>
						<span class="ds-color-label">{label}</span>
					</div>
				{/each}
			</div>

			<h3 class="ds-subsection">Semantiske farger</h3>
			<div class="ds-color-grid">
				{#each [
					['success', 'var(--success-bg)', 'var(--success-text)', 'var(--success-border)'],
					['error',   'var(--error-bg)',   'var(--error-text)',   'var(--error-border)'],
					['info',    'var(--info-bg)',     'var(--accent-primary)', 'var(--info-border)'],
				] as [name, bg, text, border]}
					<div class="ds-semantic-chip" style="background:{bg}; color:{text}; border:1px solid {border};">
						{name}
					</div>
				{/each}
			</div>

			<h3 class="ds-subsection">Forslag: utvidet palett</h3>
			<div class="ds-color-grid">
				{#each [
					['#667eea', 'Accent (nå)'],
					['#764ba2', 'Accent 2 (gradient)'],
					['#06b6d4', 'Cyan – helse'],
					['#10b981', 'Grønn – mål oppnådd'],
					['#f59e0b', 'Amber – advarsel'],
					['#ef4444', 'Rød – kritisk'],
					['#8b5cf6', 'Lilla – økonomi'],
				] as [hex, label]}
					<div class="ds-color-swatch">
						<div class="ds-color-blob" style="background:{hex}"></div>
						<code class="ds-color-name">{hex}</code>
						<span class="ds-color-label">{label}</span>
					</div>
				{/each}
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     TYPOGRAFI
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Typografi" class="ds-section">
			<h2 class="ds-section-heading">Typografi</h2>

			<div class="ds-type-stack">
				<div class="ds-type-row">
					<span class="ds-type-meta">Display / 2rem / 700</span>
					<span class="ds-type-display">Resonans</span>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">H1 / 1.5rem / 700</span>
					<h1 class="ds-h1">Helse & velvære</h1>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">H2 / 1.25rem / 600</span>
					<h2 class="ds-h2">Ukentlig oversikt</h2>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">H3 / 1rem / 600</span>
					<h3 class="ds-h3">Søvnkvalitet</h3>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">Body / 1rem / 400</span>
					<p class="ds-body">Du sover i snitt 6,3 timer per natt denne uken. Det er under anbefalingen på 7–9 timer.</p>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">Small / 0.875rem / 400</span>
					<p class="ds-small">Siste synkronisering: 26. mars 09:41</p>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">Label / 0.75rem / 600 / uppercase</span>
					<span class="ds-label">Aktive mål</span>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">Stat / 3rem / 700 tabular</span>
					<span class="ds-stat-num">7 340</span>
				</div>
				<div class="ds-type-row">
					<span class="ds-type-meta">Mono / code</span>
					<code class="ds-mono">--accent-primary: #667eea</code>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     SPACING & LAYOUT
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Spacing & Layout" class="ds-section">
			<h2 class="ds-section-heading">Spacing & Layout</h2>

			<h3 class="ds-subsection">Spacing-skala (4px base)</h3>
			<div class="ds-spacing-grid">
				{#each [2,4,8,12,16,20,24,32,40,48,64] as px}
					<div class="ds-spacing-row">
						<span class="ds-spacing-label">{px}px</span>
						<div class="ds-spacing-bar" style="width:{px}px; height:{px}px;"></div>
					</div>
				{/each}
			</div>

			<h3 class="ds-subsection">Mobile grid (375px referanse)</h3>
			<div class="ds-mobile-frame">
				<div class="ds-mobile-grid">
					<div class="ds-grid-col">1</div>
					<div class="ds-grid-col">2</div>
					<div class="ds-grid-col">3</div>
					<div class="ds-grid-col">4</div>
				</div>
				<p class="ds-mobile-note">16px margin · 16px gap · 4 kolonner</p>
			</div>

			<h3 class="ds-subsection">Border radius</h3>
			<div class="ds-radius-grid">
				{#each [
					['4px', 'xs – input'],
					['8px', 'sm – chips'],
					['12px', 'md – kort'],
					['16px', 'lg – modaler'],
					['24px', 'xl – sheets'],
					['999px', 'full – knapper'],
				] as [r, label]}
					<div class="ds-radius-box" style="border-radius:{r}">
						<span>{r}</span>
						<small>{label}</small>
					</div>
				{/each}
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     KNAPPER
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Knapper" class="ds-section">
			<h2 class="ds-section-heading">Knapper</h2>

			<div class="ds-row ds-wrap">
				<button class="btn btn-primary">Primær</button>
				<button class="btn btn-secondary">Sekundær</button>
				<button class="btn btn-ghost">Ghost</button>
				<button class="btn btn-danger">Farlig</button>
				<button class="btn btn-primary" disabled>Deaktivert</button>
			</div>

			<h3 class="ds-subsection">Størrelser</h3>
			<div class="ds-row ds-wrap ds-align-center">
				<button class="btn btn-primary btn-sm">Liten</button>
				<button class="btn btn-primary">Standard</button>
				<button class="btn btn-primary btn-lg">Stor</button>
			</div>

			<h3 class="ds-subsection">Ikon + tekst</h3>
			<div class="ds-row ds-wrap">
				<button class="btn btn-primary"><span>＋</span> Legg til mål</button>
				<button class="btn btn-secondary"><span>↩</span> Tilbake</button>
				<button class="btn btn-ghost"><span>⚙</span> Innstillinger</button>
			</div>

			<h3 class="ds-subsection">Full-bredde (mobil)</h3>
			<div class="ds-mobile-frame">
				<button class="btn btn-primary btn-full">Start i dag</button>
				<button class="btn btn-secondary btn-full" style="margin-top: 8px">Hopp over</button>
			</div>

			<h3 class="ds-subsection">Tab-gruppe</h3>
			<div class="ds-tab-group">
				{#each ['Uke', 'Måned', 'År'] as tab, i}
					<button class="ds-tab" class:active={i === 0}>{tab}</button>
				{/each}
			</div>

			<h3 class="ds-subsection">FAB (floating action)</h3>
			<div class="ds-fab-demo">
				<button class="btn-fab">＋</button>
				<button class="btn-fab btn-fab-chat">💬</button>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     KORT & FLATER
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Kort & Flater" class="ds-section">
			<h2 class="ds-section-heading">Kort & Flater</h2>

			<h3 class="ds-subsection">Base cards</h3>
			<div class="ds-card-row">
				<div class="card">
					<p class="ds-label">Flat card</p>
					<p class="ds-body">Standard hvit/mørk overflate med border.</p>
				</div>
				<div class="card card-elevated">
					<p class="ds-label">Elevated</p>
					<p class="ds-body">Skygge for primær handling.</p>
				</div>
				<div class="card card-accent">
					<p class="ds-label">Accent fill</p>
					<p class="ds-body">Brukt på featured content.</p>
				</div>
			</div>

			<h3 class="ds-subsection">Mål-kort (widget)</h3>
			<div class="ds-mobile-frame">
				<div class="goal-card">
					<div class="goal-card-top">
						<span class="goal-icon">🏃</span>
						<div>
							<p class="goal-title">Skritt per dag</p>
							<p class="goal-sub">Favorittmål · Helse</p>
						</div>
						<span class="goal-badge goal-badge-on-track">På sporet</span>
					</div>
					<div class="goal-progress-row">
						<span class="goal-stat">7 340</span>
						<span class="goal-of">/ 10 000</span>
					</div>
					<div class="progress-bar-wrap">
						<div class="progress-bar-fill" style="width: 73.4%"></div>
					</div>
					<p class="goal-hint">2 660 skritt igjen i dag</p>
				</div>

				<div class="goal-card goal-card-inactive">
					<div class="goal-card-top">
						<span class="goal-icon">😴</span>
						<div>
							<p class="goal-title">Søvn per natt</p>
							<p class="goal-sub">Helse</p>
						</div>
						<span class="goal-badge goal-badge-behind">Bak</span>
					</div>
					<div class="goal-progress-row">
						<span class="goal-stat">6,3t</span>
						<span class="goal-of">/ 7,5t</span>
					</div>
					<div class="progress-bar-wrap">
						<div class="progress-bar-fill progress-bar-warn" style="width: 84%"></div>
					</div>
				</div>
			</div>

			<h3 class="ds-subsection">Sensor-kort</h3>
			<div class="ds-card-row">
				<div class="sensor-card">
					<div class="sensor-icon">⚖️</div>
					<div class="sensor-info">
						<p class="sensor-label">Vekt</p>
						<p class="sensor-value">82,4 kg</p>
						<p class="sensor-delta sensor-delta-down">−0,3 kg sist uke</p>
					</div>
				</div>
				<div class="sensor-card">
					<div class="sensor-icon">💤</div>
					<div class="sensor-info">
						<p class="sensor-label">Søvn</p>
						<p class="sensor-value">6t 18m</p>
						<p class="sensor-delta sensor-delta-up">+22m vs snitt</p>
					</div>
				</div>
				<div class="sensor-card">
					<div class="sensor-icon">🔥</div>
					<div class="sensor-info">
						<p class="sensor-label">Aktive min.</p>
						<p class="sensor-value">34 min</p>
						<p class="sensor-delta">Mål: 30 min ✓</p>
					</div>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     INPUT
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Input" class="ds-section">
			<h2 class="ds-section-heading">Input</h2>

			<div class="ds-mobile-frame">
				<div class="form-field">
					<label class="form-label" for="ex-text">Navn på mål</label>
					<input id="ex-text" class="form-input" type="text" placeholder="F.eks. «10 000 skritt per dag»" />
				</div>
				<div class="form-field">
					<label class="form-label" for="ex-num">Målverdi</label>
					<input id="ex-num" class="form-input" type="number" placeholder="10000" />
				</div>
				<div class="form-field">
					<label class="form-label" for="ex-select">Kategori</label>
					<select id="ex-select" class="form-input form-select">
						<option>Helse</option>
						<option>Økonomi</option>
						<option>Relasjoner</option>
					</select>
				</div>
				<div class="form-field">
					<span class="form-label">Favorittmål?</span>
					<div class="form-toggle-row">
						<span class="form-toggle-label">Vis på forsiden</span>
						<button class="form-toggle active" aria-label="toggle"></button>
					</div>
				</div>
				<div class="form-field">
					<label class="form-label" for="ex-chat">Chat-input (mobil)</label>
					<div class="chat-input-wrap">
						<input id="ex-chat" class="chat-input-field" type="text"
							placeholder="Hva tenker du på?" bind:value={chatInput} />
						<button class="chat-send-btn" disabled={!chatInput.trim()}>↑</button>
					</div>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     STAT-KORT
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Stat-kort" class="ds-section">
			<h2 class="ds-section-heading">Stat-kort</h2>
			<p class="ds-body">Oversikts-widgets for forsiden og domenesider.</p>

			<div class="stat-grid">
				<div class="stat-card stat-accent">
					<p class="stat-label">Skritt i dag</p>
					<p class="stat-value">7 340</p>
					<p class="stat-context">73% av mål</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Søvn</p>
					<p class="stat-value">6t 18m</p>
					<p class="stat-context">↓ 12m vs i går</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Vekt</p>
					<p class="stat-value">82,4 kg</p>
					<p class="stat-context stat-positive">↓ 0,3 kg sist uke</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Buffer</p>
					<p class="stat-value">12 400 kr</p>
					<p class="stat-context">3,1 mnd. utgifter</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Månedssparing</p>
					<p class="stat-value">4 200 kr</p>
					<p class="stat-context stat-positive">+800 kr vs plan</p>
				</div>
				<div class="stat-card">
					<p class="stat-label">Aktiv streak</p>
					<p class="stat-value">12 dager</p>
					<p class="stat-context">🔥 Ny rekord!</p>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     FREMGANGSMÅLER
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Fremgangsmåler" class="ds-section">
			<h2 class="ds-section-heading">Fremgangsmåler</h2>

			<h3 class="ds-subsection">Horisontal bar</h3>
			<div class="ds-progress-stack">
				<div class="ds-progress-item">
					<div class="ds-progress-header"><span>Skritt</span><span>73%</span></div>
					<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:73%"></div></div>
				</div>
				<div class="ds-progress-item">
					<div class="ds-progress-header"><span>Søvn</span><span>84%</span></div>
					<div class="progress-bar-wrap"><div class="progress-bar-fill progress-bar-warn" style="width:84%"></div></div>
				</div>
				<div class="ds-progress-item">
					<div class="ds-progress-header"><span>Aktive min.</span><span>113%</span></div>
					<div class="progress-bar-wrap"><div class="progress-bar-fill progress-bar-success" style="width:100%"></div></div>
				</div>
			</div>

			<h3 class="ds-subsection">Interaktiv (slider)</h3>
			<div class="ds-progress-item">
				<div class="ds-progress-header"><span>Fremgang: {progressValue}%</span><span>{progressValue}/100</span></div>
				<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:{progressValue}%"></div></div>
				<input class="ds-range" type="range" min="0" max="100" bind:value={progressValue} />
			</div>

			<h3 class="ds-subsection">Ring / donut</h3>
			<div class="ds-ring-wrap">
				<svg width="100" height="100" viewBox="0 0 100 100">
					<circle cx="50" cy="50" r="40" fill="none" stroke="var(--border-color)" stroke-width="10"/>
					<circle cx="50" cy="50" r="40" fill="none"
						stroke="var(--accent-primary)" stroke-width="10"
						stroke-dasharray="{ringDash} {circumference}"
						stroke-dashoffset="{circumference * 0.25}"
						stroke-linecap="round"
						transform="rotate(-90 50 50)"
					/>
				</svg>
				<div class="ds-ring-label">
					<span class="ds-ring-value">{Math.round(ringPct * 100)}%</span>
					<span class="ds-ring-sub">Skritt</span>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     DIAGRAMMER (MOCK)
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Diagrammer (mock)" class="ds-section">
			<h2 class="ds-section-heading">Diagrammer (mock)</h2>

			<h3 class="ds-subsection">Sparkline – trendlinje</h3>
			<div class="sparkline-wrap">
				<svg viewBox="0 0 110 50" class="sparkline" preserveAspectRatio="none">
					<polyline
						fill="none"
						stroke="var(--accent-primary)"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						points={sparkData.map((v, i) => `${i * 10},${50 - v * 0.45}`).join(' ')}
					/>
					<!-- Gradient fill -->
					<defs>
						<linearGradient id="spark-grad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="var(--accent-primary)" stop-opacity="0.25"/>
							<stop offset="100%" stop-color="var(--accent-primary)" stop-opacity="0"/>
						</linearGradient>
					</defs>
					<polygon
						fill="url(#spark-grad)"
						points={[
							...sparkData.map((v, i) => `${i * 10},${50 - v * 0.45}`),
							`${(sparkData.length - 1) * 10},50`,
							`0,50`
						].join(' ')}
					/>
				</svg>
				<p class="ds-small">Vektutvikling siste 12 uker</p>
			</div>

			<h3 class="ds-subsection">Bar chart – skritt per dag</h3>
			<div class="bar-chart-wrap">
				{#each barData as bar}
					<div class="bar-col">
						<div class="bar-bar" style="height: {(bar.value / maxBar) * 100}%;"></div>
						<span class="bar-label">{bar.label}</span>
					</div>
				{/each}
			</div>

			<h3 class="ds-subsection">Heatmap (7×4, aktivitets-grid)</h3>
			<div class="heatmap-grid">
				{#each Array(28) as _, i}
					{@const val = Math.random()}
					<div class="heatmap-cell"
						style="background: oklch({Math.round(val * 100) > 20 ? `55% 0.18 ${260 + val * 30}` : `85% 0 0`})"
						title="{Math.round(val * 12000)} skritt"
					></div>
				{/each}
			</div>
			<p class="ds-small">Aktivitetsheatmap – siste 4 uker (mockdata)</p>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     NAVIGASJON
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Navigasjon" class="ds-section">
			<h2 class="ds-section-heading">Navigasjon</h2>

			<h3 class="ds-subsection">Bunn-tab-bar (mobil)</h3>
			<div class="ds-mobile-frame" style="padding-bottom: 0;">
				<div class="ds-page-preview">
					<p class="ds-small" style="text-align:center; padding: 2rem 0; color: var(--text-tertiary);">Sideinnhold</p>
				</div>
				<nav class="bottom-nav">
					{#each [
						['🏠', 'Hjem'],
						['💪', 'Helse'],
						['💰', 'Økonomi'],
						['🎯', 'Mål'],
						['⚙', 'Mer'],
					] as [icon, label], i}
						<button class="bottom-nav-item" class:active={i === 0}>
							<span class="bottom-nav-icon">{icon}</span>
							<span class="bottom-nav-label">{label}</span>
						</button>
					{/each}
				</nav>
			</div>

			<h3 class="ds-subsection">Top app bar</h3>
			<div class="ds-mobile-frame">
				<div class="top-app-bar">
					<button class="icon-btn">←</button>
					<span class="top-app-bar-title">Helse</span>
					<button class="icon-btn">⋯</button>
				</div>
			</div>

			<h3 class="ds-subsection">Chip-navigasjon (horisontale tabs)</h3>
			<div class="chip-nav">
				{#each ['Oversikt', 'Skritt', 'Søvn', 'Vekt', 'Aktivitet'] as chip, i}
					<button class="chip" class:active={i === 0}>{chip}</button>
				{/each}
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     ANIMASJONER
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Animasjoner" class="ds-section">
			<h2 class="ds-section-heading">Animasjoner</h2>

			<h3 class="ds-subsection">Svelte transitions</h3>
			<div class="ds-row ds-wrap" style="gap: 12px; margin-bottom: 16px;">
				<button class="btn btn-secondary" onclick={toggleFly}>fly() ↗</button>
				<button class="btn btn-secondary" onclick={toggleScale}>scale() ⊕</button>
			</div>
			<div class="ds-anim-stage">
				{#if showFly}
					<div class="ds-anim-box" transition:fly={{ y: 24, duration: 350, easing: cubicOut }}>
						fly – y:24 / 350ms
					</div>
				{/if}
				{#if showScale}
					<div class="ds-anim-box" transition:scale={{ duration: 300, easing: elasticOut, start: 0.85 }}>
						scale – elastic / 300ms
					</div>
				{/if}
			</div>

			<h3 class="ds-subsection">CSS-animasjoner</h3>
			<div class="ds-row ds-wrap" style="gap: 16px; align-items: center;">
				<div class="anim-pulse-dot"></div>
				<span class="ds-small">Pulse – live-indikator</span>
				<div class="anim-spinner"></div>
				<span class="ds-small">Spinner – laster</span>
				<div class="anim-shimmer-bar"></div>
				<span class="ds-small">Shimmer – skeleton</span>
			</div>

			<h3 class="ds-subsection">Laste-tilstand (skeleton cards)</h3>
			<div class="ds-card-row">
				{#each [1,2,3] as _}
					<div class="card skeleton-card">
						<div class="skeleton-line skeleton-line-short"></div>
						<div class="skeleton-line"></div>
						<div class="skeleton-line skeleton-line-medium"></div>
					</div>
				{/each}
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     CHAT
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Chat" class="ds-section">
			<h2 class="ds-section-heading">Chat</h2>

			<h3 class="ds-subsection">Meldingsbobler</h3>
			<div class="ds-mobile-frame">
				<div class="chat-messages-wrap">
					{#each chatMessages as msg}
						<div class="chat-bubble-row" class:user-row={msg.role === 'user'}>
							{#if msg.role === 'assistant'}
								<div class="chat-avatar">R</div>
							{/if}
							<div class="chat-bubble" class:chat-bubble-user={msg.role === 'user'}>
								{msg.content}
							</div>
						</div>
					{/each}

					<!-- Typing indicator -->
					<div class="chat-bubble-row">
						<div class="chat-avatar">R</div>
						<div class="chat-bubble chat-typing">
							<span class="typing-dot"></span>
							<span class="typing-dot"></span>
							<span class="typing-dot"></span>
						</div>
					</div>
				</div>

				<div class="chat-input-wrap" style="margin-top: 8px;">
					<input class="chat-input-field" type="text" placeholder="Skriv noe…" bind:value={chatInput} />
					<button class="chat-send-btn" disabled={!chatInput.trim()}>↑</button>
				</div>
			</div>

			<h3 class="ds-subsection">Chat som bottom sheet / drawer</h3>
			<div class="ds-mobile-frame" style="padding: 0; overflow: hidden;">
				<div class="ds-page-preview-tall">
					<p class="ds-small" style="text-align:center; padding: 2rem; color: var(--text-tertiary);">Forsideinnhold</p>
				</div>
				<div class="bottom-sheet-preview">
					<div class="bottom-sheet-handle"></div>
					<p class="ds-small" style="font-weight:600; margin-bottom: 8px;">Chat med Resonans</p>
					<div class="chat-input-wrap">
						<input class="chat-input-field" type="text" placeholder="Hva tenker du på?" />
						<button class="chat-send-btn" disabled>↑</button>
					</div>
				</div>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     TOAST & FEEDBACK
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Toast & Feedback" class="ds-section">
			<h2 class="ds-section-heading">Toast & Feedback</h2>

			<div class="ds-row ds-wrap">
				<button class="btn btn-primary" onclick={() => showToast('success', 'Mål lagret! 🎉')}>
					Vis success
				</button>
				<button class="btn btn-danger" onclick={() => showToast('error', 'Noe gikk galt. Prøv igjen.')}>
					Vis feil
				</button>
				<button class="btn btn-secondary" onclick={() => showToast('info', 'Tips: Logg aktivitet daglig for bedre innsikt.')}>
					Vis info
				</button>
			</div>

			<h3 class="ds-subsection">Badge / chip</h3>
			<div class="ds-row ds-wrap">
				<span class="badge badge-success">På sporet</span>
				<span class="badge badge-warn">Bak plan</span>
				<span class="badge badge-error">Ikke startet</span>
				<span class="badge badge-neutral">Pauset</span>
				<span class="badge badge-info">Favoritt ⭐</span>
			</div>

			<h3 class="ds-subsection">Empty state</h3>
			<div class="empty-state">
				<div class="empty-icon">🎯</div>
				<p class="empty-title">Ingen mål ennå</p>
				<p class="empty-sub">Start med å legge til et mål for helse, økonomi eller relasjoner.</p>
				<button class="btn btn-primary">＋ Legg til mål</button>
			</div>
		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     MODUS: FOKUS & KOMPOSISJON  (inspirert av Bend)
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Modus: Fokus & Komposisjon" class="ds-section">
			<h2 class="ds-section-heading">Modus: Fokus & Komposisjon</h2>
			<p class="ds-body" style="margin-bottom:1.5rem; color: var(--text-secondary)">
				Inspirert av Bend: mørkt, rolig og fokusert uttrykk. Naturlig språk → predefinerte byggeklosser.
				Organiske boble-klynger, store sirkelvalg og animert CTA under prosessering.
			</p>

			<!-- 1. DATO + STREAK HEADER -->
			<h3 class="ds-subsection">1 · Dato + streak-header</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="bend-header">
					<div class="bend-date-block">
						<p class="bend-date-label">26. MARS</p>
						<p class="bend-date-day">torsdag</p>
					</div>
					<div class="bend-header-actions">
						<div class="bend-streak-pill">
							<span class="bend-streak-flame">🔥</span>
							<span class="bend-streak-num">4</span>
						</div>
						<div class="bend-avatar-btn">👤</div>
					</div>
				</div>
			</div>

			<!-- 2. BOBLE-KLYNGE WIDGET -->
			<h3 class="ds-subsection">2 · Boble-klynge (orbital widget)</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="bend-featured-card">
					<p class="bend-card-meta">FORESLÅTT I DAG</p>
					<p class="bend-card-title">Kom i gang</p>
					<div class="bend-bubble-cluster">
						{#each bubbleItems as item, i}
							<div
								class="bend-bubble"
								style="
									background: {item.color}22;
									border-color: {item.color}55;
									--delay: {i * 0.07}s;
									--size: {i === 3 ? 68 : i % 2 === 0 ? 56 : 62}px
								"
								title={item.label}
							>
								<span class="bend-bubble-emoji">{item.emoji}</span>
							</div>
						{/each}
					</div>
				</div>
			</div>

			<!-- 3. FOKUS-MODUS AI ENTRY -->
			<h3 class="ds-subsection">3 · Fokus-modus AI-entry</h3>
			<div class="ds-mobile-frame bend-dark-frame bend-focus-frame">
				<div class="bend-focus-content">
					<div class="bend-orb">
						{#each Array(28) as _, i}
							<div class="bend-orb-dot" style="
								--angle: {(i / 28) * 360}deg;
								--r: {28 + (i % 4) * 7}px;
								--hue: {(i / 28) * 260 + 20};
								--s: {4 + (i % 3) * 2}px
							"></div>
						{/each}
					</div>
					<p class="bend-brand">resonans <em>AI</em></p>
					<div class="bend-focus-input-wrap">
						<input
							class="bend-focus-input"
							type="text"
							placeholder="Beskriv hva du vil jobbe med…"
							bind:value={bendPrompt}
							onkeydown={(e) => e.key === 'Enter' && simulateBendProcess()}
						/>
					</div>
				</div>
			</div>

			<!-- 4. NL → FILTRE + ANIMERT CTA -->
			<h3 class="ds-subsection">4 · Naturlig språk → filtre + animert CTA</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				{#if !bendProcessed}
					<div class="bend-nl-screen">
						<div class="bend-nl-header">
							<button class="bend-close-btn">✕</button>
							<p class="bend-nl-title">Hva vil du oppnå?</p>
						</div>
						<div class="bend-prompt-card">
							{bendPrompt || 'Jeg vil ha mer energi om morgenen og bedre søvn'}
						</div>
						<div class="bend-filter-chips">
							{#each ['Varighet', 'Vanskelighetsgrad', 'Filtre'] as chip}
								<button class="bend-filter-chip">{chip}</button>
							{/each}
						</div>
						<div class="bend-cta-area">
							{#if bendProcessing}
								<p class="bend-status-text" transition:fade={{ duration: 200 }}>{bendStatusText}</p>
							{/if}
							<button
								class="bend-cta-btn"
								class:bend-cta-loading={bendProcessing}
								onclick={simulateBendProcess}
								disabled={bendProcessing}
							>
								{#if bendProcessing}
									<span class="bend-cta-spinner"></span>
								{:else}
									Lag forslag
								{/if}
							</button>
						</div>
					</div>
				{:else}
					<div class="bend-result" transition:fly={{ y: 16, duration: 300 }}>
						<p class="bend-result-label">Ferdig! Forslag klart 🎉</p>
						<button class="btn btn-ghost btn-sm" onclick={() => { bendProcessed = false; bendPrompt = ''; }}>Prøv igjen</button>
					</div>
				{/if}
			</div>

			<!-- 5. SIRKEL-VELGER GRID -->
			<h3 class="ds-subsection">5 · Sirkel-velger grid</h3>
			<div class="ds-mobile-frame bend-dark-frame" style="padding-bottom: 0; overflow: hidden;">
				<div class="bend-picker-header">
					<button class="bend-close-btn">✕</button>
					<p class="bend-nl-title">Velg aktiviteter</p>
					<button class="bend-close-btn" style="opacity:0.6">🔍</button>
				</div>
				<div class="bend-circle-grid">
					{#each circleItems as item, i}
						<button
							class="bend-circle-item"
							class:selected={selectedCircles.includes(i)}
							style="--item-bg: {item.bg}"
							onclick={() => toggleCircle(i)}
						>
							<div class="bend-circle-img">{item.emoji}</div>
							{#if selectedCircles.includes(i)}
								<div class="bend-circle-check" transition:scale={{ duration: 200, easing: elasticOut }}>✓</div>
							{/if}
							<p class="bend-circle-label">{item.label}</p>
						</button>
					{/each}
				</div>
				<div class="bend-sticky-cta">
					<button
						class="bend-cta-btn"
						disabled={selectedCircles.length === 0}
						style="{selectedCircles.length === 0 ? 'opacity:0.4' : ''}"
					>
						{selectedCircles.length === 0 ? 'Velg minst én' : `NESTE  (${selectedCircles.length})`}
					</button>
				</div>
			</div>

		</section>

		<!-- ════════════════════════════════════════════════════════════════════
		     MODUS: OVERSIKT & ORGANISERING  (inspirert av ChatGPT)
		     ════════════════════════════════════════════════════════════════ -->
		<section id="Modus: Oversikt & Organisering" class="ds-section">
			<h2 class="ds-section-heading">Modus: Oversikt & Organisering</h2>
			<p class="ds-body" style="margin-bottom:1.5rem; color: var(--text-secondary)">
				Inspirert av ChatGPT: oversiktlig hjem med hurtighandlinger, mappeprosjekter og nylige samtaler.
				Minimalt og vedlikeholdsfritt — innholdet organiserer seg selv.
			</p>

			<!-- 1. HOME-SKJERM -->
			<h3 class="ds-subsection">1 · Hjemskjerm med prosjekter og nylige</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<!-- App title row -->
				<div class="cg-title-row">
					<span class="cg-app-title">Resonans</span>
					<div class="cg-title-actions">
						<button class="cg-icon-btn">🔍</button>
						<div class="cg-avatar">KH</div>
					</div>
				</div>

				<!-- Quick actions -->
				<div class="cg-quick-actions">
					{#each [
						['💪', 'Helse'],
						['💰', 'Økonomi'],
						['🎯', 'Mål'],
					] as [icon, label]}
						<button class="cg-quick-btn">
							<span class="cg-quick-icon">{icon}</span>
							<span class="cg-quick-label">{label}</span>
						</button>
					{/each}
				</div>

				<div class="cg-divider"></div>

				<!-- Projects section -->
				<p class="cg-section-label">Prosjekter</p>
				<div class="cg-list">
					<button class="cg-list-item cg-new-item">
						<span class="cg-list-icon">📂</span>
						<span class="cg-list-name">Nytt prosjekt</span>
					</button>
					{#each (cgShowMore ? cgProjects : cgProjects.slice(0, 2)) as p}
						<button class="cg-list-item">
							<span class="cg-list-icon">{p.icon}</span>
							<span class="cg-list-name">{p.name}</span>
						</button>
					{/each}
					<button class="cg-list-item cg-more-item" onclick={() => cgShowMore = !cgShowMore}>
						<span class="cg-list-icon" style="font-size:0.8rem">⋯</span>
						<span class="cg-list-name">{cgShowMore ? 'Vis mindre' : 'Vis mer'}</span>
					</button>
				</div>

				<!-- Recents section -->
				<p class="cg-section-label" style="margin-top:1.25rem">Nylige</p>
				<div class="cg-list">
					{#each cgRecent as title}
						<button class="cg-list-item cg-recent-item">
							<span class="cg-recent-title">{title}</span>
						</button>
					{/each}
				</div>

				<!-- Floating Chat FAB -->
				<div class="cg-fab-row">
					<button class="cg-chat-fab">✏ Chat</button>
				</div>
			</div>

			<!-- 2. PROSJEKTVISNING -->
			<h3 class="ds-subsection">2 · Prosjektvisning (samtaler + filer)</h3>
			<div class="ds-mobile-frame bend-dark-frame" style="padding: 0; overflow: hidden;">
				<!-- Breadcrumb header -->
				<div class="cg-proj-header">
					<button class="cg-icon-btn" style="opacity:0.7">☰</button>
					<button class="cg-breadcrumb">Helse & trening <span style="opacity:0.4">›</span></button>
					<div style="display:flex; gap:6px">
						<button class="cg-icon-btn">↑</button>
						<button class="cg-icon-btn">⋯</button>
					</div>
				</div>

				<!-- Project title -->
				<div class="cg-proj-title-block">
					<span class="cg-proj-icon">📁</span>
					<h2 class="cg-proj-title">Helse & trening</h2>
				</div>

				<!-- Tab pill -->
				<div style="padding: 0 16px 12px;">
					<div class="cg-tab-pill">
						<button class="cg-tab-pill-btn" class:active={cgProjectTab === 'samtaler'} onclick={() => cgProjectTab = 'samtaler'}>Samtaler</button>
						<button class="cg-tab-pill-btn" class:active={cgProjectTab === 'filer'} onclick={() => cgProjectTab = 'filer'}>Filer</button>
					</div>
				</div>

				<!-- Conversation list -->
				{#if cgProjectTab === 'samtaler'}
					<div class="cg-conv-list">
						{#each cgConversations as conv}
							<button class="cg-conv-item">
								<p class="cg-conv-title">{conv.title}</p>
								<p class="cg-conv-preview">{conv.preview}</p>
							</button>
						{/each}
					</div>
				{:else}
					<div class="cg-files-empty">
						<p class="cg-files-icon">📄</p>
						<p class="cg-files-label">Ingen filer ennå</p>
						<p class="cg-files-sub">Last opp dokumenter, bilder og andre filer til prosjektet.</p>
					</div>
				{/if}

				<!-- Sticky chat input -->
				<div class="cg-sticky-input">
					<button class="cg-attach-btn">＋</button>
					<input class="cg-sticky-field" type="text" placeholder="Melding Helse & trening" />
					<button class="cg-icon-btn" style="opacity:0.6">🎤</button>
					<button class="cg-voice-btn">🎵</button>
				</div>
			</div>

			<!-- 3. KOMPAKT SAMTALE-LISTE (lys modus) -->
			<h3 class="ds-subsection">3 · Kompakt liste – lys modus</h3>
			<div class="cg-light-list">
				<p class="cg-light-header">Nylige samtaler</p>
				{#each cgConversations as conv}
					<button class="cg-light-item">
						<div class="cg-light-dot"></div>
						<div>
							<p class="cg-light-title">{conv.title}</p>
							<p class="cg-light-preview">{conv.preview}</p>
						</div>
					</button>
				{/each}
			</div>

		</section>

		<!-- ══ TEMPO ══════════════════════════════════════════════════════════════ -->
		<section id="Modus: Kontinuitet & Utvikling" class="ds-section">
			<h2 class="ds-section-heading">Modus: Kontinuitet &amp; Utvikling</h2>
			<p class="ds-body" style="margin-bottom:1.5rem;color:var(--text-secondary)">
				Inspirert av Tempo: periode-grids, aktivitetskalender, kumulativ trappetrinn-graf,
				YTD-sammenligninger og mål-ringer.
			</p>

			<!-- 1: STAT-GRID -->
			<h3 class="ds-subsection">1 · Periode-statistikkgrid</h3>
			<div class="tempo-stat-grid-wrap bend-dark-frame" style="padding:0;overflow:hidden">
				<div class="tempo-stat-grid">
					{#each tempoStats as s}
						<div class="tempo-stat-cell">
							<p class="tempo-stat-label">{s.label}</p>
							<p class="tempo-stat-value">{s.value}</p>
						</div>
					{/each}
				</div>
				<div class="tempo-dot-row">
					{#each [0,1,2] as d}
						<div class="tempo-dot" class:active={d===1}></div>
					{/each}
				</div>
			</div>

			<!-- 2: KALENDER -->
			<h3 class="ds-subsection">2 · Aktivitetskalender</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="tempo-cal-header">
					{#each ['M','T','O','T','F','L','S'] as d}
						<span class="tempo-cal-dow">{d}</span>
					{/each}
				</div>
				<div class="tempo-cal-grid">
					{#each Array(5) as _}<div class="tempo-cal-cell"></div>{/each}
					{#each tempoCalDays as d}
						<div class="tempo-cal-cell">
							{#if d.activity}
								<div class="tempo-cal-dot tempo-dot-{d.activity.intensity}"></div>
								<span class="tempo-cal-num tempo-cal-active">{d.day}</span>
							{:else}
								<span class="tempo-cal-num">{d.day}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- 3: KUMULATIV GRAF -->
			<h3 class="ds-subsection">3 · Kumulativ trappetrinn-graf</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="tempo-chart-header">
					<div class="tempo-chart-icon">🏃</div>
					<p class="tempo-chart-sub">LØPING</p>
				</div>
				<div class="tempo-chart-wrap">
					<svg viewBox="0 0 300 140" class="tempo-svg" preserveAspectRatio="none">
						<defs>
							<linearGradient id="tempo-grad" x1="0" y1="0" x2="1" y2="0">
								<stop offset="0%" stop-color="#ff8c00"/>
								<stop offset="100%" stop-color="#ff2200"/>
							</linearGradient>
						</defs>
						<polygon points={tempoCumArea()} fill="url(#tempo-grad)" opacity="0.9"/>
						<line x1="0" y1={tempoGoalY} x2="300" y2={tempoGoalY}
							stroke="white" stroke-width="1" stroke-dasharray="4 4" opacity="0.5"/>
						<text x="295" y="12" text-anchor="end" fill="white" font-size="14" font-weight="700">94,41</text>
						<text x="295" y={tempoGoalY - 4} text-anchor="end" fill="white" font-size="12" opacity="0.7">50</text>
					</svg>
				</div>
				<div class="tempo-goal-details">
					{#each [
						['🎯','Mål', '50 km'],
						['📅','Start', '1. jan 2026'],
						['🏁','Slutt', '31. mar 2026'],
						['✅','Fullført', '67,24 km'],
						['⬆️','Foran med', '20,01 km'],
					] as [ic, label, val]}
						<div class="tempo-detail-row">
							<span class="tempo-detail-icon">{ic}</span>
							<span class="tempo-detail-label">{label}</span>
							<span class="tempo-detail-val">{val}</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- 4: YTD -->
			<h3 class="ds-subsection">4 · YTD-trendsammenligning</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<p class="tempo-ytd-link">YTD i fjor vs. YTD i år</p>
				<div class="tempo-ytd-card">
					<p class="tempo-ytd-title">Snitt per økt</p>
					<div class="tempo-ytd-cols">
						<div class="tempo-ytd-col tempo-ytd-prev">01.01.2025–<br>26.03.2025</div>
						<div class="tempo-ytd-col tempo-ytd-curr">01.01.2026–<br>26.03.2026</div>
					</div>
					{#each tempoYtdRows as row}
						<div class="tempo-ytd-divider"></div>
						<div class="tempo-ytd-row">
							<div class="tempo-ytd-metric">
								<span class="tempo-ytd-icon">{row.icon}</span>
								<span class="tempo-ytd-mlabel">{row.label}</span>
							</div>
							<div class="tempo-ytd-prev-val">{row.prev}</div>
							<div class="tempo-ytd-curr-val">
								<span>{row.curr}</span>
								<span class="tempo-delta" class:up={row.up} class:down={!row.up}>{row.delta}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- 5: GOAL RINGS -->
			<h3 class="ds-subsection">5 · Mål-ringer (side by side)</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="tempo-rings-row">
					{#each [
						{ pct: 1.0,  fill: '#ff6600', track: '#3a1a00', label: '🎉 74/50 km', deadline: '31. mar 2026', done: true },
						{ pct: 0.44, fill: '#f0c000', track: '#2a2500', label: '66/150 km',  deadline: '30. apr 2026', done: false },
					] as ring}
						{@const c = 2 * Math.PI * 38}
						<div class="tempo-ring-card">
							<svg width="96" height="96" viewBox="0 0 96 96">
								<circle cx="48" cy="48" r="38" fill="#1a1a1a" stroke={ring.track} stroke-width="10"/>
								<circle cx="48" cy="48" r="38" fill="none"
									stroke={ring.fill} stroke-width="10"
									stroke-dasharray="{Math.min(ring.pct,1)*c} {c}"
									stroke-dashoffset={c * 0.25}
									stroke-linecap="round"
									transform="rotate(-90 48 48)"
								/>
								{#if ring.done}
									<text x="48" y="54" text-anchor="middle" fill={ring.fill} font-size="18">★</text>
								{:else}
									<text x="48" y="54" text-anchor="middle" fill={ring.fill} font-size="13" font-weight="700">{Math.round(ring.pct*100)}%</text>
								{/if}
							</svg>
							<p class="tempo-ring-label" style="color:{ring.fill}">{ring.label}</p>
							<p class="tempo-ring-deadline">→ {ring.deadline}</p>
						</div>
					{/each}
				</div>
			</div>

		</section>

		<!-- ══ STOIC ════════════════════════════════════════════════════════════════ -->
		<section id="Modus: Refleksjon & Sinnstemning" class="ds-section">
			<h2 class="ds-section-heading">Modus: Refleksjon &amp; Sinnstemning</h2>
			<p class="ds-body" style="margin-bottom:1.5rem;color:var(--text-secondary)">
				Inspirert av Stoic: nesten ingen chrome, stort spørsmål, romslig pusterom.
				Slider → f&oslash;lelsesvalg → kontekstvalg → journalprompt.
			</p>

			<!-- 0: HOME -->
			<h3 class="ds-subsection">0 · Dagshjemskjerm</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="stoic-home-header">
					<div class="stoic-streak-pill">🔥 0</div>
					<p class="stoic-greeting">god kveld.</p>
					<div class="stoic-avatar">👤</div>
				</div>
				<div class="stoic-week-strip">
					{#each [['Ma','23'],['Ti','24'],['On','25'],['To','26'],['Fr','27'],['Lø','28'],['Sø','29']] as [dow, d], i}
						<div class="stoic-day-cell" class:today={i===3}>
							<span class="stoic-dow">{dow}</span>
							<span class="stoic-day-num">{d}</span>
						</div>
					{/each}
				</div>
				<div class="stoic-cards-row">
					<div class="stoic-ctx-card stoic-ctx-dim">
						<p class="stoic-ctx-type">Morgen</p>
						<p class="stoic-ctx-q">Klar for dagen?</p>
						<button class="stoic-begin-btn stoic-begin-dim">Start</button>
					</div>
					<div class="stoic-ctx-card stoic-ctx-active">
						<p class="stoic-ctx-type">Kveld</p>
						<p class="stoic-ctx-q">Pust ut før du sover.</p>
						<button class="stoic-begin-btn stoic-begin-light">▶ Start</button>
					</div>
				</div>
				<p class="stoic-social-proof">4 812 personer sjekket inn i dag</p>
				<div class="stoic-practices-header">
					<p class="stoic-practices-title">Dine praksiser</p>
				</div>
				<div class="stoic-practices-row">
					{#each ['🧘 Daglig refleksjon', '✨ Journalføring', '🌐 Stressforståelse'] as p}
						<div class="stoic-practice-card">{p}</div>
					{/each}
				</div>
			</div>

			<!-- 1: MOOD SLIDER -->
			<h3 class="ds-subsection">1 · Sinnstemningsslider</h3>
			<div class="ds-mobile-frame bend-dark-frame stoic-focus-frame">
				<div class="stoic-question-block">
					<p class="stoic-big-q">Hvordan har du det?</p>
				</div>
				<div class="stoic-slider-block">
					<p class="stoic-feeling-label">Jeg har det</p>
					<p class="stoic-feeling-word">{stoicMoodLabel}</p>
					<input class="stoic-slider" type="range" min="0" max="100" bind:value={stoicMood}/>
					<div class="stoic-slider-labels">
						<span>Forferdelig</span><span>Flott</span>
					</div>
				</div>
				<div class="stoic-bottom-bar">
					<button class="stoic-skip">Hopp over</button>
					<button class="bend-cta-btn" style="width:auto;padding:12px 28px">→</button>
				</div>
			</div>

			<!-- 2: EMOTION GRID -->
			<h3 class="ds-subsection">2 · Følelsestekstgrid</h3>
			<div class="ds-mobile-frame bend-dark-frame stoic-picker-frame">
				<p class="stoic-big-q" style="text-align:center;margin-top:1.5rem">
					Hvordan vil du beskrive<br>hvordan du har det i dag?
				</p>
				<div class="stoic-emotion-grid">
					{#each (stoicShowMoreEmotions ? stoicEmotions : stoicEmotions.slice(0,10)) as e}
						<button
							class="stoic-emotion-btn"
							class:selected={stoicSelectedEmotions.includes(e)}
							onclick={() => toggleEmotion(e)}
						>{e}</button>
					{/each}
				</div>
				<button class="stoic-show-more" onclick={() => stoicShowMoreEmotions = !stoicShowMoreEmotions}>
					{stoicShowMoreEmotions ? 'Vis færre ∧' : 'Vis flere følelser ∨'}
				</button>
				<div class="stoic-bottom-bar" style="margin-top:1rem">
					<button class="stoic-personalize">✏ Tilpass</button>
					<button class="bend-cta-btn" style="width:auto;padding:12px 28px">→</button>
				</div>
			</div>

			<!-- 3: CONTEXT ICON GRID -->
			<h3 class="ds-subsection">3 · Kontekstikonvelger</h3>
			<div class="ds-mobile-frame bend-dark-frame stoic-picker-frame">
				<p class="stoic-big-q" style="text-align:center;margin-top:1.5rem">
					Hva påvirker<br>følelsene dine i dag?
				</p>
				<div class="stoic-ctx-grid">
					{#each stoicContexts as ctx}
						<button
							class="stoic-ctx-tile"
							class:selected={stoicSelectedContexts.includes(ctx.label)}
							onclick={() => toggleContext(ctx.label)}
						>
							<span class="stoic-ctx-icon">{ctx.icon}</span>
							<span class="stoic-ctx-tlabel">{ctx.label}</span>
						</button>
					{/each}
				</div>
				<div class="stoic-bottom-bar" style="margin-top:1rem">
					<button class="stoic-personalize">✏ Tilpass</button>
					<button class="bend-cta-btn" style="width:auto;padding:12px 28px">→</button>
				</div>
			</div>

			<!-- 4: JOURNAL PROMPT -->
			<h3 class="ds-subsection">4 · Journalprompt med fritekst</h3>
			<div class="ds-mobile-frame bend-dark-frame stoic-journal-frame">
				<div class="stoic-journal-topbar">
					<div style="display:flex;gap:8px">
						<button class="cg-icon-btn" style="color:#888">⋯</button>
						<button class="cg-icon-btn" style="color:#888">🏷</button>
					</div>
					<div class="stoic-ai-pill">✨ Resonans</div>
				</div>
				<p class="stoic-journal-q">Nevn tre ting som gikk bra i dag.</p>
				<blockquote class="stoic-journal-sub">
					Hva bidro til at det gikk bra?<br>
					Hvilken rolle spilte du selv?
				</blockquote>
				<textarea
					class="stoic-journal-area"
					placeholder="Begynn å skrive…"
					bind:value={stoicJournalText}
					rows="5"
				></textarea>
				<div class="stoic-journal-bar">
					<button class="stoic-bar-btn">＋</button>
					<button class="stoic-bar-btn">Aa</button>
					<button class="stoic-deeper-btn">Gå dypere</button>
					<button class="stoic-next-fab">→</button>
				</div>
			</div>

		</section>

		<!-- ══ WITHINGS ═════════════════════════════════════════════════════════ -->
		<section id="Modus: Vitalitet & Helse" class="ds-section">
			<h2 class="ds-section-heading">Modus: Vitalitet &amp; Helse</h2>
			<p class="ds-body" style="margin-bottom:1.5rem;color:var(--text-secondary)">
				Inspirert av Withings Health Mate: helse-indekser med animert skillelinje-graf,
				metrikk-kort med mini-sparklines, og flytende bar→dot-overgang.
			</p>

			<!-- 1: SCORE PILLS -->
			<h3 class="ds-subsection">1 · Score-piller (scrollbar rad)</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="hm-score-row">
					{#each hmScores as s}
						<button
							class="hm-score-pill"
							class:hm-score-active={hmActiveScore === s.label.toLowerCase()}
							onclick={() => hmActiveScore = s.label.toLowerCase() as typeof hmActiveScore}
							style="--hm-c:{s.color}"
						>
							<div class="hm-score-icon" style="background:{s.color}20;border:2px solid {s.color}">
								{s.icon}
							</div>
							<div class="hm-score-pts">
								<span class="hm-score-num">{s.pts}</span>
								<span class="hm-score-lbl">pts</span>
							</div>
						</button>
					{/each}
				</div>
			</div>

			<!-- 2: SCORE DETAIL CARD -->
			<h3 class="ds-subsection">2 · Score-detalj med tidslinje-graf</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="hm-score-card">
					<div class="hm-score-card-header">
						<div>
							<p class="hm-score-card-eyebrow">Forbedre neste score</p>
							<p class="hm-score-card-sub">Oppdateres hver mandag – fanger helsedata fra de siste 90 dagene.</p>
						</div>
						<button class="hm-chart-btn">⬛</button>
					</div>
					<!-- Three-column: Previous / Current / Prediction -->
					<div class="hm-score-cols">
						<div class="hm-score-col hm-col-prev">
							<p class="hm-col-label">Forrige</p>
							<p class="hm-col-value">{hmTl.prev}</p>
							<span class="hm-col-badge hm-badge-stable">{hmTl.label}</span>
						</div>
						<div class="hm-score-col hm-col-curr">
							<p class="hm-col-label">Nåværende</p>
							<p class="hm-col-value">{hmTl.curr}</p>
							<span class="hm-col-badge hm-badge-up">{hmTl.delta} pts</span>
						</div>
						<div class="hm-score-col hm-col-pred">
							<p class="hm-col-label">Prediksjon</p>
							<div class="hm-pred-star">✦</div>
						</div>
					</div>
					<!-- SVG timeline chart: solid past line → current dot → dotted prediction -->
					<svg class="hm-timeline-svg" viewBox="0 0 300 80">
						<!-- Background column for "current" -->
						<rect x="100" y="0" width="100" height="80" fill="rgba(255,255,255,0.04)" rx="4"/>
						<!-- Vertical cursor line -->
						<line x1="200" y1="10" x2="200" y2="70" stroke="#555" stroke-width="1"/>
						<!-- Past line (solid amber) -->
						<line x1="20" y1="55" x2="200" y2="40" stroke="#c9a227" stroke-width="2.5" stroke-linecap="round"/>
						<!-- Prediction dotted line -->
						<line x1="200" y1="40" x2="280" y2="28" stroke="#c9a227" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round"/>
						<!-- Dots -->
						<circle cx="20"  cy="55" r="5" fill="#1c1c1c" stroke="#c9a227" stroke-width="2.5"/>
						<circle cx="200" cy="40" r="7" fill="#c9a227"/>
						<circle cx="280" cy="28" r="5" fill="#1c1c1c" stroke="#c9a227" stroke-width="2"/>
					</svg>
				</div>
			</div>

			<!-- 3: METRIC CARDS -->
			<h3 class="ds-subsection">3 · Metrikk-kort med sparklines</h3>
			<div class="ds-mobile-frame bend-dark-frame" style="gap:10px;display:flex;flex-direction:column">
				{#each hmMetrics as m}
					<div class="hm-metric-card">
						<div class="hm-metric-header">
							<div class="hm-metric-title-row">
								<span class="hm-metric-icon">{m.icon}</span>
								<span class="hm-metric-label">{m.label}</span>
							</div>
							<span class="hm-metric-date">{m.date} ›</span>
						</div>
						<div class="hm-metric-body">
							<div>
								<p class="hm-metric-value">{m.value} <span class="hm-metric-unit">{m.unit}</span></p>
								<div class="hm-metric-tag" style="color:{m.tagColor}">
									<span class="hm-tag-check">✓</span> {m.tag}
								</div>
							</div>
							<!-- Mini sparkline -->
							<svg class="hm-spark-svg" viewBox="0 0 120 40" preserveAspectRatio="none">
								{#if m.sparkType === 'bar'}
									{@const maxV = Math.max(...m.spark)}
									{@const bw = 120 / m.spark.length}
									{#each m.spark as v, i}
										{@const bh = (v / maxV) * 36}
										<rect
											x={i*bw + bw*0.1} y={40 - bh}
											width={bw*0.8} height={bh}
											rx="2"
											fill={i === m.spark.length - 1 ? '#c9a227' : '#3d4060'}
											class:hm-bar-anim={true}
											style="transform-origin: {i*bw + bw*0.5}px 40px"
										/>
									{/each}
									<!-- Goal dotted line -->
									{#if m.label === 'Skritt per dag'}
										{@const gy = 40 - (hmStepsGoal / Math.max(...m.spark)) * 36}
										<line x1="0" y1={gy} x2="120" y2={gy} stroke="#888" stroke-width="1" stroke-dasharray="3 3"/>
									{/if}
								{:else}
									{@const maxV = Math.max(...m.spark)}
									{@const minV = Math.min(...m.spark)}
									{@const range = maxV - minV || 1}
									{@const pts = m.spark.map((v,i) =>
										`${(i/(m.spark.length-1))*120},${40 - ((v-minV)/range)*32}`
									).join(' ')}
									<polyline points={pts} fill="none" stroke="#6090e0" stroke-width="2" stroke-linejoin="round"/>
									{#each m.spark as v, i}
										<circle
											cx={(i/(m.spark.length-1))*120}
											cy={40 - ((v-minV)/range)*32}
											r="2.5" fill="#6090e0"
										/>
									{/each}
								{/if}
							</svg>
						</div>
					</div>
				{/each}
			</div>

			<!-- 4: BAR → DOT ANIMASJON -->
			<h3 class="ds-subsection">4 · Bar → Prikk-overgang (animert)</h3>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="hm-anim-header">
					<p class="hm-anim-title">Skritt siste 7 dager</p>
					<button class="hm-anim-toggle" onclick={hmToggleView}>
						{hmViewMode === 'bar' ? '● Prikk-modus' : '▬ Søyle-modus'}
					</button>
				</div>
				<svg class="hm-anim-svg" viewBox="0 0 280 100" preserveAspectRatio="none">
					<!-- Goal dotted line -->
					<line x1="0" y1={hmGoalY} x2="280" y2={hmGoalY} stroke="#555" stroke-width="1" stroke-dasharray="4 3"/>
					{#each hmStepsData as v, i}
						{@const x = 20 + i * 40}
						{@const bh = (v / hmStepsMax) * 85}
						{@const cy = 100 - bh}
						{#if hmViewMode === 'bar'}
							<rect
								x={x - 12} y={cy}
								width="24" height={bh}
								rx="4"
								fill={v >= hmStepsGoal ? '#c9a227' : '#3a3a50'}
								class:hm-collapse={hmAnimating}
							/>
						{:else}
							<circle
								cx={x} cy={cy + bh/2}
								r="10"
								fill={v >= hmStepsGoal ? '#c9a227' : '#3a3a50'}
							/>
						{/if}
						<!-- Star above best bar -->
						{#if v === hmStepsMax}
							<text x={x} y={cy - 6} text-anchor="middle" font-size="10">⭐</text>
						{/if}
					{/each}
				</svg>
				<div class="hm-anim-labels">
					{#each ['Ma','Ti','On','To','Fr','Lø','Sø'] as l}
						<span class="hm-anim-label">{l}</span>
					{/each}
				</div>
				<p style="font-size:0.72rem;color:#555;text-align:center;margin:6px 0 0">
					Trykk på knappen øverst for å se bar→prikk-overgangen
				</p>
			</div>

		</section>

		<!-- ══ NINTHLIFE ═════════════════════════════════════════════════════ -->
		<section id="Modus: Ninthlife" class="ds-section">
			<h2 class="ds-section-heading">Modus: Ninthlife</h2>
			<p class="ds-body" style="margin-bottom:1.5rem;color:var(--text-secondary)">
				Metrikker fra smartklokke. Oppsummert i sirkelkort (2026/365 · måned/30 · uke/7),
				akkumulert sammenligningsgraf og årlig/månedlig/ukentlig nedbrytingstabell.
			</p>

			<!-- 1: METRIC SELECTOR + CIRCLES -->
			<h3 class="ds-subsection">1 · Metrikk-velger + oppsummeringssirkler</h3>
			<div class="nl-outer-frame">
				<!-- Horizontal metric tabs -->
				<div class="nl-metric-tabs">
					{#each nlMetrics as m}
						<button
							class="nl-metric-tab"
							class:active={nlActiveMetric === m.key}
							onclick={() => { nlActiveMetric = m.key; nlActiveCircle = null; }}
						>{m.label}</button>
					{/each}
				</div>

				<!-- 2×3 circle grid -->
				<div class="nl-circles-grid">
					{#each nlCircles(nlActiveMetric) as [period, val, col], idx}
						<button
							class="nl-circle"
							class:nl-circle-active={nlActiveCircle === idx}
							style="--nl-c:{col}"
							onclick={() => nlActiveCircle = nlActiveCircle === idx ? null : idx}
						>
							<span class="nl-circle-period">{period}</span>
							<span class="nl-circle-val">{val}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- 2: ACCUMULATED COMPARISON CHART -->
			<h3 class="ds-subsection">2 · Akkumulert sammenligningsgraf</h3>
			<p class="ds-caption">Oransje = nåværende periode · grå = forrige periode (samme lengde)</p>
			<div class="nl-outer-frame">
				<p class="nl-chart-title">Utvikling</p>
				<div class="nl-chart-wrap">
					<svg class="nl-chart-svg" viewBox="0 0 400 180" preserveAspectRatio="none">
						<!-- Y-axis gridlines -->
						{#each [nlMaxY, nlMaxY - Math.round((nlMaxY-nlMinY)/3), nlMinY + Math.round((nlMaxY-nlMinY)/3), nlMinY] as yv}
							{@const ypos = (1 - (yv - nlMinY)/(nlMaxY - nlMinY)) * 160 + 10}
							<line x1="30" y1={ypos} x2="400" y2={ypos} stroke="#d0c4b8" stroke-width="0.8" stroke-dasharray="3 3"/>
							<text x="26" y={ypos+4} text-anchor="end" fill="#8a7a6e" font-size="11">{yv}</text>
						{/each}
						<!-- X-axis labels: 0, 100, 200, 300 -->
						{#each [0, 1, 2, 3] as xi}
							{@const xp = 30 + (xi/3)*370}
							<text x={xp} y="178" text-anchor="middle" fill="#8a7a6e" font-size="11">{xi*100}</text>
						{/each}
						<!-- "Da" grey line -->
						<path
							d={nlSvgLine(nlDa, nlMaxY, nlMinY, 370, 150).replace('M','M').split('M').map((s,i)=>i===0?'M'+s:s).join('').replace(/^/, 'M').slice(0)
								.split(' ').map((cmd, i) => {
									const [lx, ly] = (cmd.slice(1).split(',') ?? []);
									if (!lx) return cmd;
									return cmd[0] + (parseFloat(lx)+30).toFixed(1) + ',' + (parseFloat(ly)+10).toFixed(1);
								}).join(' ')}
							fill="none" stroke="#b0a090" stroke-width="1.5"
						/>
						<!-- "Nå" orange line -->
						<path
							d={nlSvgLine(nlNå, nlMaxY, nlMinY, 370, 150)
								.split(' ').map((cmd) => {
									const [lx, ly] = (cmd.slice(1).split(',') ?? []);
									if (!lx) return cmd;
									return cmd[0] + (parseFloat(lx)+30).toFixed(1) + ',' + (parseFloat(ly)+10).toFixed(1);
								}).join(' ')}
							fill="none" stroke="#e07030" stroke-width="2"
						/>
						<!-- Labels at end -->
						<text x="396" y="98" fill="#e07030" font-size="11" font-weight="700">Nå</text>
						<text x="396" y="111" fill="#b0a090" font-size="11">Da</text>
					</svg>
				</div>
			</div>

			<!-- 3: PERIOD TABLE -->
			<h3 class="ds-subsection">3 · Nedbrytingstabell</h3>
			<div class="nl-outer-frame">
				<!-- Period tabs -->
				<div class="nl-period-tabs">
					{#each nlPeriods as p}
						<button
							class="nl-period-tab"
							class:active={nlActivePeriod === p}
							onclick={() => nlActivePeriod = p}
						>{p}</button>
					{/each}
				</div>
				<!-- Column icons -->
				<div class="nl-table">
					<div class="nl-table-head">
						<span class="nl-th-row"></span>
						{#each nlTableCols as col}
							<span class="nl-th-cell">{col.icon}</span>
						{/each}
					</div>
					{#each nlTableRows[nlActivePeriod] as row}
						<div class="nl-table-row">
							<span class="nl-row-label">{row.row}</span>
							{#each row.vals as cell}
								<div class="nl-cell-circle" style="border-color:{cell.c !== 'n' ? nlCellColor[cell.c] : 'transparent'}">
									<span class="nl-cell-val" style="color:{cell.c !== 'n' ? nlCellColor[cell.c] : '#8a7a6e'}">{cell.v}</span>
								</div>
							{/each}
						</div>
					{/each}
					<button class="nl-show-all">Hele perioden</button>
				</div>
			</div>

		</section>

		<!-- ══ INTERAKSJONSFLYTER ═══════════════════════════════════════════════ -->
		<section id="Interaksjonsflyter" class="ds-section">
			<h2 class="ds-section-heading">Interaksjonsflyter</h2>
			<p class="ds-body" style="margin-bottom:1.5rem;color:var(--text-secondary)">
				Seks måter chat, database og sensordata kan møte brukeren på — fra automatisk push til fri refleksjon med kontekstfiler.
			</p>

			<!-- ── 1. AUTO-INNSIKT PUSH ─────────────────────────────────── -->
			<h3 class="ds-subsection">1 · Automatisk innsikt fra sensordata</h3>
			<p class="ds-caption">AI oppdager mønstre og presenterer dem proaktivt. Brukeren trenger ikke spørre – dataen taler først.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<p class="if-section-label">Nytt siden sist</p>
				{#each ifInsights as ins}
					<div class="if-insight-card">
						<div class="if-insight-icon" style="color:{ins.color}">{ins.icon}</div>
						<div class="if-insight-body">
							<p class="if-insight-label">{ins.label}</p>
							<p class="if-insight-sub">{ins.sub}</p>
						</div>
						<button class="if-insight-cta" style="color:{ins.color}">{ins.cta} ›</button>
					</div>
				{/each}
				<button class="if-chat-prompt-btn">
					<span class="if-chat-sparkle">✦</span>
					Hva betyr dette for ukesmålet mitt?
				</button>
			</div>

			<!-- ── 2. SYSTEM-1 QUICK-TRACK ──────────────────────────────── -->
			<h3 class="ds-subsection">2 · System-1 lynregistrering</h3>
			<p class="ds-caption">Slider eller pille-valg — én håndbevegelse, stor statistisk verdi over tid. Startpunkt for AI-oppfølging.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<p class="if-section-label">Kveld-sjekk-inn · {new Date().toLocaleDateString('nb-NO',{weekday:'long'})}</p>

				<!-- Quick emoji pick -->
				<p class="if-track-q">Hvordan er stemningen?</p>
				<div class="if-mood-pills">
					{#each ifMoodPills as emoji, i}
						<button
							class="if-mood-pill"
							class:selected={ifQuickMoodPick === emoji}
							onclick={() => ifQuickMoodPick = emoji}
						>{emoji}</button>
					{/each}
				</div>

				<!-- Three sliders -->
				{#each [
					{ label: 'Energi', value: ifEnergyLevel, word: ifEnergyLabel,
					  setter: (v: number) => { ifEnergyLevel = v; }, accent: '#f59e0b' },
					{ label: 'Fokus',  value: ifFocusLevel,  word: ifFocusLabel,
					  setter: (v: number) => { ifFocusLevel = v; }, accent: '#60a5fa' },
				] as sl}
					<div class="if-slider-row">
						<span class="if-slider-label">{sl.label}</span>
						<input class="if-slim-slider" type="range" min="0" max="100"
							value={sl.value}
							oninput={(e) => sl.setter(+(e.target as HTMLInputElement).value)}
							style="--if-accent:{sl.accent}"
						/>
						<span class="if-slider-word" style="color:{sl.accent}">{sl.word}</span>
					</div>
				{/each}

				<button class="if-log-btn">Logg inn ✓</button>
			</div>

			<!-- ── 3. TRENINGSSKJEMA ─────────────────────────────────── -->
			<h3 class="ds-subsection">3 · Rask skjema-registrering (styrkeøkt)</h3>
			<p class="ds-caption">Forhåndsutfylt med sist loggede verdier. Én kolonne per variabel, rask scrolling, ingen modal.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="if-form-header">
					<p class="if-form-title">Styrkeøkt · {new Date().toLocaleDateString('nb-NO',{day:'numeric',month:'short'})}</p>
					<button class="if-form-add" onclick={ifAddRow}>+ Øvelse</button>
				</div>
				<div class="if-form-cols-header">
					<span class="if-col-ex">Øvelse</span>
					<span class="if-col-num">Sett</span>
					<span class="if-col-num">Reps</span>
					<span class="if-col-num">Kg</span>
				</div>
				{#each ifStrengthRows as row, i}
					<div class="if-form-row">
						<input class="if-input-ex" type="text" bind:value={row.name} placeholder="Øvelse"/>
						<input class="if-input-num" type="number" bind:value={row.sets} min="1"/>
						<input class="if-input-num" type="number" bind:value={row.reps} min="1"/>
						<input class="if-input-num" type="number" bind:value={row.kg}   min="0"/>
					</div>
				{/each}
				<div class="if-form-footer">
					<button class="if-log-btn" style="margin-top:4px">Lagre økt ✓</button>
					<button class="if-chat-prompt-btn" style="margin-top:8px">
						<span class="if-chat-sparkle">✦</span>
						AI: Sammenlign med forrige økt
					</button>
				</div>
			</div>

			<!-- ── 4. BILDE-REGISTRERING ──────────────────────────────── -->
			<h3 class="ds-subsection">4 · Bilde → automatisk registrering</h3>
			<p class="ds-caption">Send et skjermbilde eller foto — AI tolker og registrerer data uten manuell tasking.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				{#if !ifImageUploaded}
					<button class="if-upload-zone" onclick={() => ifImageUploaded = true}>
						<span class="if-upload-icon">📷</span>
						<p class="if-upload-label">Send bilde for registrering</p>
						<p class="if-upload-sub">Skjermtid · Matfoto · Blodprøve · Notater</p>
					</button>
				{:else}
					<!-- Mock uploaded screenshot -->
					<div class="if-image-preview">
						<div class="if-image-mock">
							<p style="font-size:2rem;margin:0">📱</p>
							<p style="font-size:0.72rem;color:#666;margin:4px 0 0">Skjermtid-skjermbilde.png</p>
						</div>
					</div>
					<div class="if-ai-processing">
						<span class="if-chat-sparkle">✦</span>
						<p class="if-ai-caption">{ifSampleCaption}</p>
					</div>
					<div class="if-image-actions">
						<button class="if-log-btn">Lagre ✓</button>
						<button class="if-skip-btn" onclick={() => ifImageUploaded = false}>Forkast</button>
					</div>
				{/if}
			</div>

			<!-- ── 5. FRI SKRIVING + ANALYSE ─────────────────────────── -->
			<h3 class="ds-subsection">5 · Fri skriving + AI-analyse</h3>
			<p class="ds-caption">En åpen prompt gir brukeren rom til å uttrykke seg — teksten analyseres og følges opp strukturert.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="if-freewrite-wrap">
					<div class="stoic-ai-pill" style="align-self:flex-start;margin-bottom:1rem">✦ Resonans</div>
					<p class="stoic-journal-q">{ifFreePrompt}</p>
					<textarea
						class="stoic-journal-area if-freewrite-area"
						placeholder="Skriv fritt…"
						bind:value={ifFreeText}
						rows="4"
					></textarea>
					<button
						class="if-log-btn"
						style="margin-top:10px"
						onclick={() => ifFreeAnalyzed = true}
					>Analyser ✦</button>
					{#if ifFreeAnalyzed}
						<div class="if-analysis-card">
							<p class="if-analysis-heading">✦ AI-analyse</p>
							{#each ifFreeAnalysis as row}
								<div class="if-analysis-row">
									<span class="if-analysis-label">{row.label}</span>
									<span class="if-analysis-value">{row.value}</span>
								</div>
							{/each}
							<button class="if-chat-prompt-btn" style="margin-top:10px">
								<span class="if-chat-sparkle">✦</span>
								Fortelt meg mer om grensesetting
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- ── 6. PROSJEKTMAPPE MED KONTEKSTFILER ──────────────── -->
			<h3 class="ds-subsection">6 · Prosjektmappe med kontekstfiler</h3>
			<p class="ds-caption">Tilkoblede dokumenter, bilder og regneark gir AI en rik kontekst — brukeren kan snakke til filene sine.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<!-- Project header -->
				<div class="if-proj-header">
					<div class="if-proj-icon">🏋️</div>
					<div>
						<p class="if-proj-name">Trening &amp; helse 2026</p>
						<p class="if-proj-sub">4 filer · Sist oppdatert i dag</p>
					</div>
					<button class="if-proj-edit">⋯</button>
				</div>
				<!-- Tabs -->
				<div class="cg-tab-pill" style="margin-bottom:12px">
					<button class="cg-tab-pill-btn active">Samtaler</button>
					<button class="cg-tab-pill-btn">Filer</button>
				</div>
				<!-- File list -->
				<div class="if-file-list">
					{#each ifProjectFiles as f}
						<div class="if-file-row">
							<span class="if-file-icon">{f.icon}</span>
							<div class="if-file-meta">
								<p class="if-file-name">{f.name}</p>
								<p class="if-file-size">{f.size}</p>
							</div>
							<button class="if-file-more">⋯</button>
						</div>
					{/each}
					<button class="if-file-add">＋ Legg til fil</button>
				</div>
				<!-- Chat input pinned to bottom -->
				<div class="if-proj-chat">
					<input
						class="if-proj-input"
						type="text"
						placeholder="Spør om treningsprogrammet…"
						bind:value={ifProjectChatText}
					/>
					<button class="stoic-next-fab" style="flex-shrink:0">↑</button>
				</div>
			</div>

			<!-- ── 7. SPONTAN CHAT → STILLE MINNE ────────────────────── -->
			<h3 class="ds-subsection">7 · Spontan chat → stille minne</h3>
			<p class="ds-caption">Brukeren venter ikke. AI husker likevel — uten å avbryte flyten med spørsmål eller tema-forslag.</p>
			<div class="ds-mobile-frame bend-dark-frame">
				<div class="if-chat-scroll">
					{#each ifSpontThread as msg}
						<div class="if-cr if-cr-{msg.s}">
							<div class="if-bub if-bub-{msg.s}">{msg.t}</div>
							{#if msg.mem}
								<div class="if-mem-pill">✦ Husket stille</div>
							{/if}
						</div>
					{/each}
				</div>
				<div class="if-chat-input-row">
					<div class="if-chat-fake-input">Fortell mer…</div>
					<button class="stoic-next-fab">↑</button>
				</div>
			</div>

			<!-- ── 8. ENGASJEMENTSNIVÅ ─────────────────────────────── -->
			<h3 class="ds-subsection">8 · Engasjementsnivå — fra pust til pakke</h3>
			<p class="ds-caption">Bot oppdager et mønster og tilbyr å skalere opp. Brukeren velger eksplisitt hvor mye systemet skal involvere seg.</p>

			<!-- Frame A: Chat + nivåvelger -->
			<div class="ds-mobile-frame bend-dark-frame" style="margin-bottom:16px">
				<div class="if-chat-scroll">
					{#each ifRunThread as msg}
						<div class="if-cr if-cr-{msg.s}">
							<div class="if-bub if-bub-{msg.s}">{msg.t}</div>
						</div>
					{/each}
				</div>

				<!-- Level picker -->
				<div class="if-eng-rail">
					{#each ifEngItems as item, i}
						<button
							class="if-eng-circ"
							style="--ec:{item.col}"
							class:selected={ifEngLvl === i}
							onclick={() => { ifEngLvl = i; ifEngStep = 0; }}
						>{item.lbl}</button>
					{/each}
				</div>
				{#if ifEngLvl !== null}
					<div class="if-eng-desc">{ifEngItems[ifEngLvl].desc}</div>
				{/if}
			</div>

			<!-- Frame B: «Hele pakka»-onboarding, vises når nivå 4 er valgt -->
			{#if ifEngLvl === 4}
				<div class="ds-mobile-frame bend-dark-frame">
					<p class="if-section-label">Oppsett · Løping</p>

					<!-- Step indicator -->
					<div class="if-pkg-steps">
						{#each ['Mål', 'Metrikker', 'Nudging'] as step, i}
							<div class="if-pkg-step" class:active={ifEngStep === i} class:done={ifEngStep > i}>
								<div class="if-pkg-dot">{ifEngStep > i ? '✓' : i+1}</div>
								<span>{step}</span>
							</div>
							{#if i < 2}<div class="if-pkg-line"></div>{/if}
						{/each}
					</div>

					{#if ifEngStep === 0}
						<p class="stoic-big-q" style="font-size:1rem;margin:1rem 0 0.5rem">Hva vil du oppnå med løpingen?</p>
						<blockquote class="stoic-journal-sub">Tenk 6 måneder frem. Vær konkret.</blockquote>
						<textarea class="stoic-journal-area" style="min-height:64px" placeholder="F.eks: løpe 10 km uten pause innen september…"></textarea>
					{:else if ifEngStep === 1}
						<p class="stoic-big-q" style="font-size:1rem;margin:1rem 0 0.75rem">Hvilke måltall følger vi?</p>
						<div class="if-pkg-metric-grid">
							{#each ifPakkaMetrics as m}
								<button
									class="if-pkg-metric-chip"
									class:selected={ifPakkaMetricSel.includes(m)}
									onclick={() => ifToggleMetric(m)}
								>{m}</button>
							{/each}
						</div>
					{:else}
						<p class="stoic-big-q" style="font-size:1rem;margin:1rem 0 0.75rem">Når vil du høre fra meg?</p>
						<div class="if-pkg-nudge-grid">
							{#each [['Kveldssjekk', 'Daglig, etter 20:00'],['Ukesoppsummering','Søndag kveld'],['Bare hvis viktig','Kun ved avvik']] as [lbl, sub]}
								<button class="stoic-emotion-btn" style="text-align:left;display:flex;flex-direction:column;gap:2px">
									<span style="font-weight:600;color:#fff">{lbl}</span>
									<span style="font-size:0.72rem;color:#555">{sub}</span>
								</button>
							{/each}
						</div>
					{/if}

					<div class="if-pkg-footer">
						{#if ifEngStep > 0}
							<button class="stoic-skip" onclick={() => ifEngStep--}>‹ Tilbake</button>
						{/if}
						{#if ifEngStep < 2}
							<button class="bend-cta-btn" style="margin-left:auto;width:auto;padding:10px 24px" onclick={() => ifEngStep++}>Neste →</button>
						{:else}
							<button class="bend-cta-btn" style="margin-left:auto;width:auto;padding:10px 24px">Fullfør ✓</button>
						{/if}
					</div>
				</div>
			{/if}

			<!-- ── 9. BOT BER OM INPUT — VARIANTER ────────────────────────── -->
			<h3 class="ds-subsection" style="margin-top:2.5rem">9 · Bot ber om input — variantgalleri</h3>
			<p class="ds-caption">Tre ulike former for proaktiv innhenting. Bot initierer, bruker svarer med minst mulig friksjon.</p>

			<div class="if-botask-grid">

				<!-- ▸ A: Sinnstemningsslider -->
				<div>
					<p class="if-botask-label">A · Sinnstemningsslider</p>
					<div class="ds-mobile-frame bend-dark-frame if-botask-frame">
						<div class="if-chat-scroll" style="flex:1">
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Hei 👋 Hvilken retning peker dagen din akkurat nå?</div>
							</div>
							{#if ifBotAskMoodSaved}
								<div class="if-cr if-cr-u">
									<div class="if-bub if-bub-u">{ifBotAskMoodEmoji} {ifBotAskMoodLabel}</div>
								</div>
								<div class="if-cr if-cr-a">
									<div class="if-bub if-bub-a">Notert 🌿 Jeg husker dette.</div>
								</div>
							{/if}
						</div>
						{#if !ifBotAskMoodSaved}
							<div class="if-botask-slider-wrap">
								<div class="if-botask-slider-emoji-row">
									<span>😔</span><span>🤩</span>
								</div>
								<input
									type="range" min="0" max="100"
									bind:value={ifBotAskMood}
									class="if-botask-range"
									style="--rv:{ifBotAskMood}"
								/>
								<div class="if-botask-mood-label">{ifBotAskMoodEmoji} {ifBotAskMoodLabel}</div>
								<button class="bend-cta-btn" style="margin-top:10px"
									onclick={() => ifBotAskMoodSaved = true}>Lagre</button>
							</div>
						{/if}
					</div>
				</div>

				<!-- ▸ B: Emoji-velger -->
				<div>
					<p class="if-botask-label">B · Emoji-velger</p>
					<div class="ds-mobile-frame bend-dark-frame if-botask-frame">
						<div class="if-chat-scroll" style="flex:1">
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Kjapp sjekk ⚡ Velg det som treffer nærmest nå.</div>
							</div>
							{#if ifBotAskEmoji}
								<div class="if-cr if-cr-u">
									<div class="if-bub if-bub-u">{ifBotAskEmoji}</div>
								</div>
								<div class="if-cr if-cr-a">
									<div class="if-bub if-bub-a">Forstår. Notert 🙏</div>
								</div>
							{/if}
						</div>
						{#if !ifBotAskEmoji}
							<div class="if-botask-emoji-rail">
								{#each ifBotAskEmojiSet as em}
									<button class="if-botask-emoji-btn"
										onclick={() => ifBotAskEmoji = em}>{em}</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<!-- ▸ C: Energiskala 1–5 -->
				<div>
					<p class="if-botask-label">C · Energiskala</p>
					<div class="ds-mobile-frame bend-dark-frame if-botask-frame">
						<div class="if-chat-scroll" style="flex:1">
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Energinivå i dag — fra 1 til 5?</div>
							</div>
							{#if ifBotAskEnergy !== null}
								<div class="if-cr if-cr-u">
									<div class="if-bub if-bub-u">{ifBotAskEnergy}</div>
								</div>
								<div class="if-cr if-cr-a">
									<div class="if-bub if-bub-a">{ifBotAskEnergy <= 2 ? 'Skjønner. Ta det rolig i dag 🫶' : ifBotAskEnergy === 3 ? 'Greit nok! Notert.' : 'Flott dag! Jeg bruker det videre ⚡'}</div>
								</div>
							{/if}
						</div>
						{#if ifBotAskEnergy === null}
							<div class="if-botask-dots-rail">
								{#each [1,2,3,4,5] as n}
									<button class="if-botask-dot-btn"
										style="--dc:{n<=2?'#e07070':n===3?'#7a8a9a':n===4?'#5fa0a0':'#7c8ef5'}"
										onclick={() => ifBotAskEnergy = n}>{n}</button>
								{/each}
							</div>
						{/if}
					</div>
				</div>

			</div><!-- /if-botask-grid -->

			<!-- ── 10. MELDINGSTRIAGE ──────────────────────────────────────── -->
			<h3 class="ds-subsection" style="margin-top:2.5rem">10 · Meldingstriage — én inntasting, fire utfall</h3>
			<p class="ds-caption">Bot detekterer intensjon, kryssjekker sensordata og aktive mål, og foreslår riktig beholder. Velg et scenario under.</p>

			<!-- Tab-nav: 4 meldingsscenarier -->
			<div class="if-triage-tabs">
				{#each ifTriageScenarios as sc, i}
					<button
						class="if-triage-tab"
						class:active={ifTriageScenario === i}
						style="--tc:{sc.col}"
						onclick={() => { ifTriageScenario = i; ifTriageReset(); }}
					>
						<span class="if-triage-tab-tag">{sc.tag}</span>
						<span class="if-triage-tab-msg">"{sc.msg}"</span>
					</button>
				{/each}
			</div>

			<!-- Phone frame per scenario -->
			<div class="ds-mobile-frame bend-dark-frame if-triage-phone">

				{#if ifTriageScenario === 0}
					<!-- ── Scenario 0: Jeg hater jobben ── -->
					<div class="if-chat-scroll">
						<div class="if-cr if-cr-u">
							<div class="if-bub if-bub-u">Jeg hater jobben 😤</div>
						</div>
						<div class="if-cr if-cr-a">
							<div class="if-bub if-bub-a">Høres tungt ut 😮‍💨</div>
						</div>
						{#if ifTriage0Decision === 'glem'}
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Glemt. Jeg beholder bare det som skjer videre i samtalen her, ingenting lagres.</div>
							</div>
						{:else if ifTriage0Decision === 'prosjekt'}
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">OK — hva er retningen?</div>
							</div>
							{#if ifTriage0ProjType === 'forbedre'}
								<div class="if-cr if-cr-u"><div class="if-bub if-bub-u">Forbedre nåværende</div></div>
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Oppretter tema <strong>Arbeid</strong> 🏗️ Hva er det verste med jobben akkurat nå?</div></div>
							{:else if ifTriage0ProjType === 'ny'}
								<div class="if-cr if-cr-u"><div class="if-bub if-bub-u">Finn ny jobb</div></div>
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Oppretter tema <strong>Jobbskifte</strong> 🚀 Steg 1: hva slags jobb vil du ha?</div></div>
							{/if}
						{/if}
					</div>

					{#if ifTriage0Decision === null}
						<div class="if-triage-prompt">Vil du la dette bli her, eller ta tak i det?</div>
						<div class="if-triage-choices">
							<button class="if-triage-choice" onclick={() => ifTriage0Decision = 'glem'}>
								<span class="if-triage-choice-icon">🌬️</span>
								<span class="if-triage-choice-lbl">Glem det</span>
								<span class="if-triage-choice-sub">Ikke lagre noe</span>
							</button>
							<button class="if-triage-choice" onclick={() => ifTriage0Decision = 'prosjekt'}>
								<span class="if-triage-choice-icon">🗂️</span>
								<span class="if-triage-choice-lbl">Lag prosjekt</span>
								<span class="if-triage-choice-sub">Start et tema</span>
							</button>
						</div>
					{:else if ifTriage0Decision === 'prosjekt' && ifTriage0ProjType === null}
						<div class="if-triage-prompt">Hvilken retning?</div>
						<div class="if-triage-choices">
							<button class="if-triage-choice" onclick={() => ifTriage0ProjType = 'forbedre'}>
								<span class="if-triage-choice-icon">🔧</span>
								<span class="if-triage-choice-lbl">Forbedre nåværende</span>
								<span class="if-triage-choice-sub">Bli der, men bedre</span>
							</button>
							<button class="if-triage-choice" onclick={() => ifTriage0ProjType = 'ny'}>
								<span class="if-triage-choice-icon">🚀</span>
								<span class="if-triage-choice-lbl">Finn ny jobb</span>
								<span class="if-triage-choice-sub">Start jobbskifte-tema</span>
							</button>
						</div>
					{/if}

				{:else if ifTriageScenario === 1}
					<!-- ── Scenario 1: Jeg løp 8,2 km ── -->
					<div class="if-chat-scroll">
						<div class="if-cr if-cr-u">
							<div class="if-bub if-bub-u">Jeg løp 8,2 km i dag</div>
						</div>
						<!-- Bot viser kryssjekk -->
						<div class="if-cr if-cr-a">
							<div class="if-bub if-bub-a" style="padding:0;overflow:hidden;background:none;border:none">
								<div class="if-triage-ctx-cards">
									<div class="if-triage-ctx-card if-ctx-match">
										<span>📡</span>
										<div><strong>Garmin</strong><br><span>8,1 km registrert i dag ✓</span></div>
									</div>
									<div class="if-triage-ctx-card if-ctx-miss">
										<span>🎯</span>
										<div><strong>Mål</strong><br><span>Ingen aktiv løpingsmålsetning</span></div>
									</div>
									<div class="if-triage-ctx-card if-ctx-miss">
										<span>💬</span>
										<div><strong>Tema</strong><br><span>Ingen aktiv løpings-tema</span></div>
									</div>
								</div>
							</div>
						</div>
						{#if ifTriage1Decision === null}
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Bra løpetur! Ingen aktiv plan — vil du begynne å spore løpingen din?</div>
							</div>
						{:else if ifTriage1Decision === 'maal'}
							<div class="if-cr if-cr-u"><div class="if-bub if-bub-u">Sett ukentlig km-mål</div></div>
							<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Hva er realistisk per uke? Tenk de neste 4 ukene 📆</div></div>
						{:else if ifTriage1Decision === 'tema'}
							<div class="if-cr if-cr-u"><div class="if-bub if-bub-u">Opprett løping-tema</div></div>
							<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Oppretter <strong>Løping</strong> 🏃 Kobler Garmin-data automatisk. Hva er motivasjonen?</div></div>
						{:else}
							<div class="if-cr if-cr-u"><div class="if-bub if-bub-u">Bare husk det</div></div>
							<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Notert 🌿 Legger dette til i historikken uten videre oppfølging.</div></div>
						{/if}
					</div>

					{#if ifTriage1Decision === null}
						<div class="if-triage-choices if-triage-choices-3">
							<button class="if-triage-choice" onclick={() => ifTriage1Decision = 'maal'}>
								<span class="if-triage-choice-icon">📅</span>
								<span class="if-triage-choice-lbl">Sett ukentlig mål</span>
							</button>
							<button class="if-triage-choice" onclick={() => ifTriage1Decision = 'tema'}>
								<span class="if-triage-choice-icon">📁</span>
								<span class="if-triage-choice-lbl">Opprett tema</span>
							</button>
							<button class="if-triage-choice" onclick={() => ifTriage1Decision = 'husk'}>
								<span class="if-triage-choice-icon">🌿</span>
								<span class="if-triage-choice-lbl">Bare husk det</span>
							</button>
						</div>
					{/if}

				{:else if ifTriageScenario === 2}
					<!-- ── Scenario 2: Jeg må fikse syklene ── -->
					<div class="if-chat-scroll">
						<div class="if-cr if-cr-u">
							<div class="if-bub if-bub-u">Jeg må fikse syklene</div>
						</div>
						<div class="if-cr if-cr-a">
							<div class="if-bub if-bub-a">Høres ut som en oppgave 🔧 Hvilke sykler er dette?</div>
						</div>

						{#if ifTriage2Step >= 1}
							<div class="if-cr if-cr-u">
								<div class="if-bub if-bub-u">Grusracer og to barnesykler</div>
							</div>
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Hva er galt med dem?</div>
							</div>
						{/if}

						{#if ifTriage2Step >= 2}
							<div class="if-cr if-cr-u">
								<div class="if-bub if-bub-u">Bremser og gir</div>
							</div>
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">OK — her er en plan 👇</div>
							</div>
							<!-- Expandable task list -->
							<div class="if-cr if-cr-a">
								<div class="if-triage-tasklist">
									{#each [
										{ title: 'Flytte sykler til egnet sted', subs: ['Grusracer', 'Barnesykkel 1', 'Barnesykkel 2'] },
										{ title: 'Finne frem verktøy', subs: ['Unbrakonøkler', 'Skiftenøkkel', 'Bremsewire'] },
										{ title: 'Teste gir og bremser', subs: ['Grusracer', 'Barnesykkel 1', 'Barnesykkel 2'] },
										{ title: 'Reparere det som er nødvendig', subs: ['Grusracer', 'Barnesykkel 1', 'Barnesykkel 2'] },
									] as task, ti}
										<div class="if-triage-task-row">
											<button class="if-triage-task-btn"
												onclick={() => ifTriage2Toggle(ti)}>
												<span class="if-triage-task-num">{ti + 1}.</span>
												<span class="if-triage-task-title">{task.title}</span>
												<span class="if-triage-task-chevron">{ifTriage2TaskOpen.includes(ti) ? '▾' : '▸'}</span>
											</button>
											{#if ifTriage2TaskOpen.includes(ti)}
												<div class="if-triage-subtasks">
													{#each task.subs as sub, si}
														<div class="if-triage-subtask">
															<span class="if-triage-subtask-alpha">{String.fromCharCode(97 + si)}.</span>
															<span class="if-triage-subtask-lbl">☐</span>
															<span>{sub}</span>
														</div>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}

						{#if ifTriage2Step >= 3}
							<div class="if-cr if-cr-u">
								<div class="if-bub if-bub-u">Jeg skjønner ikke hva som er feil med giret på barnesykkelen</div>
							</div>
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">Ta et bilde av drivverk og girspak 📷</div>
							</div>
						{/if}

						{#if ifTriage2Step >= 4}
							<div class="if-cr if-cr-u">
								<div class="if-triage-photo-bub">
									<div class="if-triage-photo-thumb">📷</div>
									<span class="if-triage-photo-name">IMG_3847.jpg</span>
								</div>
							</div>
							<div class="if-cr if-cr-a">
								<div class="if-bub if-bub-a">
									Ser ut som kabelen er slack og innerjustering er ute av posisjon.<br><br>
									Finn denne videoen:
									<div class="if-triage-yt-card">
										<div class="if-triage-yt-thumb">▶</div>
										<div>
											<div class="if-triage-yt-title">Shimano 7-trinns girjustering — steg for steg</div>
											<div class="if-triage-yt-meta">YouTube · 8 min</div>
										</div>
									</div>
								</div>
							</div>
						{/if}
					</div>

					<!-- Step-by-step input area -->
					{#if ifTriage2Step === 0}
						<div class="if-triage-chips">
							<button class="if-triage-chip" onclick={() => ifTriage2Step = 1}>Grusracer og to barnesykler</button>
						</div>
					{:else if ifTriage2Step === 1}
						<div class="if-triage-chips">
							<button class="if-triage-chip" onclick={() => ifTriage2Step = 2}>Bremser og gir</button>
						</div>
					{:else if ifTriage2Step === 2}
						<div class="if-triage-chips">
							<button class="if-triage-chip" onclick={() => ifTriage2Step = 3}>Jeg skjønner ikke hva som er galt med giret…</button>
						</div>
					{:else if ifTriage2Step === 3}
						<div class="if-triage-choices">
							<button class="if-triage-choice if-triage-choice-full" onclick={() => ifTriage2Step = 4}>
								<span class="if-triage-choice-icon">📷</span>
								<span class="if-triage-choice-lbl">Send bilde</span>
							</button>
						</div>
					{/if}

				{:else}
					<!-- ── Scenario 3: Jeg vil lære å løpe ── -->
					<div class="if-chat-scroll">
						<div class="if-cr if-cr-u">
							<div class="if-bub if-bub-u">Jeg vil lære å løpe</div>
						</div>
						<div class="if-cr if-cr-a">
							<div class="if-bub if-bub-a">Flott mål ⚡ Jeg kan hjelpe deg på mange nivåer — fra å bare huske det til å sette opp full plan med metrikker og daglig sjekk. Hva passer deg?</div>
						</div>
						{#if ifTriage3EngLvl !== null}
							<div class="if-cr if-cr-u">
								<div class="if-bub if-bub-u">{ifTriage3EngItems[ifTriage3EngLvl].lbl}</div>
							</div>
							{#if ifTriage3EngLvl === 0}
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Notert 🌿 Ingen videre oppfølging.</div></div>
							{:else if ifTriage3EngLvl === 1}
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Lager et minne om ønsket ditt. Du kan alltids komme tilbake og eskalere.</div></div>
							{:else if ifTriage3EngLvl === 2}
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Oppretter tema <strong>Løping</strong> 🏃 Start med å fortelle litt om bakgrunn — er du nybegynner?</div></div>
							{:else if ifTriage3EngLvl === 3}
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">Kobler tema til registreringer. Hvilke data vil du spore? (km/uke, tempo, puls…)</div></div>
							{:else}
								<div class="if-cr if-cr-a"><div class="if-bub if-bub-a">La oss sette opp hele pakken 📦</div></div>
								{#if ifTriage3Step === 0}
									<!-- Pakka step 0: mål -->
								{:else if ifTriage3Step === 1}
									<!-- Pakka step 1: metrikker (vises i input-området) -->
								{:else}
									<!-- Pakka step 2: nudging -->
								{/if}
							{/if}
						{/if}
					</div>

					{#if ifTriage3EngLvl === null}
						<div class="if-eng-rail" style="padding:12px 0 4px">
							{#each ifTriage3EngItems as item, i}
								<button
									class="if-eng-circ"
									style="--ec:{item.col}"
									onclick={() => ifTriage3EngLvl = i}
								>{item.lbl}</button>
							{/each}
						</div>
					{:else if ifTriage3EngLvl === 4}
						{#if ifTriage3Step === 0}
							<textarea class="stoic-journal-area" style="min-height:56px;margin-top:8px" placeholder="Hva vil du oppnå med løpingen?&#10;Tenk 6 mnd frem. Vær konkret."></textarea>
							<button class="bend-cta-btn" style="margin-top:8px" onclick={() => ifTriage3Step = 1}>Neste →</button>
						{:else if ifTriage3Step === 1}
							<p style="font-size:0.75rem;color:#888;margin:8px 0 6px">Hvilke måltall følger vi?</p>
							<div class="if-pkg-metric-grid">
								{#each ['km/uke', 'snitt-tempo', 'hvilepuls', 'vekt'] as m}
									<button class="if-pkg-metric-chip if-pkg-metric-chip">{m}</button>
								{/each}
							</div>
							<button class="bend-cta-btn" style="margin-top:8px" onclick={() => ifTriage3Step = 2}>Neste →</button>
						{:else}
							<p style="font-size:0.75rem;color:#888;margin:8px 0 6px">Når vil du høre fra meg?</p>
							<div style="display:flex;flex-direction:column;gap:6px">
								{#each [['Kveldssjekk', 'Daglig etter 20:00'], ['Ukesoppsummering', 'Søndag kveld']] as [lbl, sub]}
									<button class="stoic-emotion-btn" style="text-align:left;display:flex;flex-direction:column;gap:2px">
										<span style="font-weight:600;color:#fff;font-size:0.78rem">{lbl}</span>
										<span style="font-size:0.68rem;color:#555">{sub}</span>
									</button>
								{/each}
							</div>
							<button class="bend-cta-btn" style="margin-top:10px">Fullfør ✓</button>
						{/if}
					{/if}
				{/if}

			</div><!-- /triage phone -->

		</section>

		<!-- ══ HJEMSKJERM: ROUTING-HUB ══════════════════════════════════════ -->
		<section id="Hjemskjerm: Tre soner" class="ds-section">
			<h2 class="ds-section-heading">Hjemskjerm: Tre soner</h2>
			<p class="ds-body" style="margin-bottom:1rem;color:var(--text-secondary)">
				Tre vertikale soner. Trykk på en sone for å la den ekspandere til fullskjerm.
			</p>
			<ul class="ds-caption" style="margin-bottom:1.5rem;padding-left:1.2rem;color:var(--text-secondary)">
				<li><strong>Widgets</strong> — sirkler/kort per sensor-kategori. Trykk = kategori-dashboard · langt trykk (0.7 s) = kontekstuell chat.</li>
				<li><strong>Temaer</strong> — swipe-liste sortert etter siste aktivitet. Åpner tema-side med Chat / Data / Filer.</li>
				<li><strong>Chat &amp; Fil</strong> — hurtigtilgang. Chat = ny throwaway-samtale (skaper minner). Fil = opplasting med AI-forslag.</li>
			</ul>

			<!-- Phone frame: three stacked zones -->
			<div class="hs2-phone">

				<!-- ── ZONE 1: Widgets ── -->
				<div
					class="hs2-zone hs2-z-widget"
					class:hs2-full={hsPane === 'widget'}
					class:hs2-hide={hsPane !== null && hsPane !== 'widget'}
				>
					{#if hsPane !== 'widget'}
						<!-- Collapsed: circles med long-press → kontekstuell chat -->
						<div class="hs2-widget-row">
							{#each hsWidgets as w, i}
								<div
									class="hs2-mini-circ"
									style="--wc:{w.col}"
									class:hs2-lp-active={hsLongpressWidget === i}
									role="button"
									tabindex="0"
									onpointerdown={(e) => {
										const phone = e.currentTarget.closest('.hs2-phone');
										if (phone) {
											const r = phone.getBoundingClientRect();
											hsLpPos = { x: e.clientX - r.left, y: e.clientY - r.top };
										}
										hsLongpressWidget = i;
										hsLongpressTimer = setTimeout(() => {
											spawnRipple(hsLpPos.x, hsLpPos.y, w.col);
											hsWidgetCtxIdx = i;
											hsPane = 'chat';
											hsLongpressTimer = undefined;
											hsLongpressWidget = null;
										}, 700);
									}}
									onpointerup={() => {
										if (hsLongpressTimer) {
											clearTimeout(hsLongpressTimer);
											hsLongpressTimer = undefined;
											hsWidgetCtxIdx = i;
											hsPane = 'widget';
										}
										hsLongpressWidget = null;
									}}
									onpointerleave={() => { clearTimeout(hsLongpressTimer); hsLongpressTimer = undefined; hsLongpressWidget = null; }}
								>
									<span class="hs2-mc-val">{w.val}</span>
									<span class="hs2-mc-unit">{w.unit}</span>
									<span class="hs2-mc-lbl">{w.label}</span>
								</div>
							{/each}
						</div>
					{:else}
						<!-- Expanded: sensor-dashboard for valgt kategori -->
						<div class="hs2-top-bar">
							<button class="hs2-back" onclick={() => hsPane = null}>‹ Tilbake</button>
							<span class="hs2-top-title">{hsWidgets[hsWidgetCtxIdx ?? 0].label}</span>
						</div>
						{#if hsWidgetCtxIdx === 2}
							<!-- Relasjon: dobbel-linje, siste 7 registreringer -->
							<div class="hs2-rel-header">
								<span class="hs2-rel-sub">Siste 7 registreringer</span>
								<div class="hs2-rel-scores">
									<span class="hs2-rel-score" style="color:#d4829a">● 5</span>
									<span class="hs2-rel-score" style="color:#7cb5c0">● 4</span>
								</div>
							</div>
							<svg class="hs2-rel-chart" viewBox="0 0 160 70" preserveAspectRatio="none">
								<line x1="0" y1="14" x2="160" y2="14" stroke="#222" stroke-width="0.5"/>
								<line x1="0" y1="28" x2="160" y2="28" stroke="#222" stroke-width="0.5"/>
								<line x1="0" y1="42" x2="160" y2="42" stroke="#222" stroke-width="0.5"/>
								<line x1="0" y1="56" x2="160" y2="56" stroke="#222" stroke-width="0.5"/>
								<polygon points="4,70 4,42 30,28 56,42 82,14 108,28 134,28 156,14 156,70" fill="#d4829a" fill-opacity="0.1"/>
								<polygon points="4,70 4,56 30,42 56,28 82,42 108,28 134,42 156,28 156,70" fill="#7cb5c0" fill-opacity="0.1"/>
								<polyline points="4,42 30,28 56,42 82,14 108,28 134,28 156,14"
									fill="none" stroke="#d4829a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
								<polyline points="4,56 30,42 56,28 82,42 108,28 134,42 156,28"
									fill="none" stroke="#7cb5c0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
								<circle cx="156" cy="14" r="3" fill="#d4829a"/>
								<circle cx="156" cy="28" r="3" fill="#7cb5c0"/>
							</svg>
							<div class="hs2-rel-legend">
								<span style="color:#d4829a">● Person A</span>
								<span style="color:#7cb5c0">● Person B</span>
							</div>
						{:else}
							<div class="hs2-widget-grid">
								{#each hsWidgetGrid as w, i}
									<button
										class="hs2-widget-tile"
										class:active={hsActiveWidget === i}
										style="--wc:{w.col}"
										onclick={() => hsActiveWidget = i}
									>
										<span class="hs2-wt-val">{w.val}</span>
										<span class="hs2-wt-unit">{w.unit}</span>
										<span class="hs2-wt-lbl">{w.label}</span>
									</button>
								{/each}
							</div>
							<div class="hs2-widget-detail">
								<span class="hs2-detail-label">{hsWidgetGrid[hsActiveWidget].label}</span>
								<span class="hs2-detail-big">{hsWidgetGrid[hsActiveWidget].val} {hsWidgetGrid[hsActiveWidget].unit}</span>
								<svg class="hs2-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
									<polyline points="0,20 14,17 28,22 42,14 56,16 70,10 84,13 100,8"
										fill="none" stroke={hsWidgetGrid[hsActiveWidget].col} stroke-width="2"/>
								</svg>
							</div>
						{/if}
					{/if}
				</div>

				<!-- ── ZONE DIVIDER ── -->
				{#if hsPane === null}
					<div class="hs2-zone-sep"></div>
				{/if}

				<!-- ── ZONE 2: Temaer ── -->
				<div
					class="hs2-zone hs2-z-tema"
					class:hs2-full={hsPane === 'tema'}
					class:hs2-hide={hsPane !== null && hsPane !== 'tema'}
				>
					{#if hsPane !== 'tema'}
						<!-- Collapsed: horizontal swipe-rail -->
						<div class="hs2-tema-rail">
							{#each hsTemaNavn as t, i}
								<button
									class="hs2-tema-pill"
									class:active={hsActiveTema === i}
									onclick={() => { hsActiveTema = i; hsPane = 'tema'; hsTemaSubtab = 'chat'; }}
								>{t}</button>
							{/each}
						</div>
					{:else}
						<!-- Expanded: tema page -->
						<div class="hs2-top-bar">
							<button class="hs2-back" onclick={() => hsPane = null}>‹ Tilbake</button>
							<span class="hs2-top-title">{hsTemaNavn[hsActiveTema]}</span>
						</div>
						<div class="hs2-subtabs">
							{#each [['chat','Chat'],['widget','Data'],['fil','Filer']] as [key, lbl]}
								<button
									class="hs2-subtab"
									class:active={hsTemaSubtab === key}
									onclick={() => hsTemaSubtab = key as 'chat'|'widget'|'fil'}
								>{lbl}</button>
							{/each}
						</div>
						{#if hsTemaSubtab === 'chat'}
							<div class="hs2-chat-body">
								{#each hsChatThread as msg}
									<div class="hs2-thread-row hs2-row-{msg.s}">
										<div class="hs2-thread-bub hs2-bub-{msg.s}">{msg.t}</div>
										{#if msg.branch}<div class="hs2-branch-tag">→ {msg.branch}</div>{/if}
									</div>
								{/each}
							</div>
							<div class="hs2-input-bar">
								<input class="hs2-input" type="text"
									placeholder="Spør om {hsTemaNavn[hsActiveTema]}…"
									bind:value={hsChatText}/>
							</div>
						{:else if hsTemaSubtab === 'widget'}
							<div class="hs2-widget-grid" style="padding:12px 10px;flex:1">
								{#each hsWidgetGrid.slice(0,4) as w}
									<div class="hs2-widget-tile active" style="--wc:{w.col}">
										<span class="hs2-wt-val">{w.val}</span>
										<span class="hs2-wt-unit">{w.unit}</span>
										<span class="hs2-wt-lbl">{w.label}</span>
									</div>
								{/each}
							</div>
						{:else}
							<div class="hs2-file-list">
								{#each ['Treningslogg feb.xlsx','Løpeprogram v3.pdf','Blodprøver 2025.pdf'] as f}
									<div class="hs2-file-item">
										<span class="hs2-file-ico">📄</span>
										<span class="hs2-file-nm">{f}</span>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				{#if hsPane === null}
					<div class="hs2-zone-sep"></div>
				{/if}

				<!-- ── ZONE 3: Chat & Fil ── -->
				<div
					class="hs2-zone hs2-z-bottom"
					class:hs2-full={hsPane === 'chat' || hsPane === 'fil'}
					class:hs2-hide={hsPane !== null && hsPane !== 'chat' && hsPane !== 'fil'}
				>
					{#if hsPane === null}
						<!-- Collapsed: hurtigknappar som mime widget-sirklar -->
						<div class="hs2-qact-rail">
							<button class="hs2-qact-btn" style="--qc:#667eea"
							onpointerdown={(e) => triggerRipple(e, '#667eea')}
							onclick={() => { hsWidgetCtxIdx = null; hsPane = 'chat'; }}>
							<div class="hs2-qact-circ">💬</div>
							<span class="hs2-qact-lbl">Chat</span>
						</button>
						<button class="hs2-qact-btn" style="--qc:#7c8ef5"
							onpointerdown={(e) => triggerRipple(e, '#7c8ef5')}
							onclick={() => { hsActiveTema = 0; hsPane = 'tema'; hsTemaSubtab = 'chat'; }}>
							<div class="hs2-qact-circ">💪</div>
							<span class="hs2-qact-lbl">Styrke</span>
						</button>
						<button class="hs2-qact-btn" style="--qc:#5fa0a0"
							onpointerdown={(e) => triggerRipple(e, '#5fa0a0')}
							onclick={() => { hsWidgetCtxIdx = null; hsPane = 'chat'; }}>
							<div class="hs2-qact-circ">😌</div>
							<span class="hs2-qact-lbl">Humør</span>
						</button>
						<button class="hs2-qact-btn" style="--qc:#e07070"
							onpointerdown={(e) => triggerRipple(e, '#e07070')}
							onclick={() => { hsFileSuggested = false; hsFileAdded = false; hsPane = 'fil'; }}>
							<div class="hs2-qact-circ">📎</div>
							<span class="hs2-qact-lbl">Legg til</span>
						</button>
						<button class="hs2-qact-btn" style="--qc:#888"
							onpointerdown={(e) => triggerRipple(e, '#888')}>
							<div class="hs2-qact-circ">⚡</div>
							<span class="hs2-qact-lbl">Hurtig</span>
						</button>
					</div>

					{:else if hsPane === 'chat'}
						<!-- Expanded: throwaway chat / widget-kontekstuell chat -->
						<div class="hs2-top-bar">
							<button class="hs2-back" onclick={() => { hsPane = null; hsWidgetCtxIdx = null; }}>‹ Tilbake</button>
							<span class="hs2-top-title">{hsWidgetCtxIdx !== null ? hsWidgets[hsWidgetCtxIdx].label + ' — chat' : 'Ny samtale'}</span>
							{#if hsWidgetCtxIdx === null}<span class="hs2-top-sub">skaper minner</span>{/if}
						</div>
						{#if hsWidgetCtxIdx !== null}
							<div class="hs2-ctx-banner">
								<div class="hs2-mini-circ hs2-mini-circ-sm" style="--wc:{hsWidgets[hsWidgetCtxIdx].col}">
									<span class="hs2-mc-val">{hsWidgets[hsWidgetCtxIdx].val}</span>
									<span class="hs2-mc-lbl">{hsWidgets[hsWidgetCtxIdx].label}</span>
								</div>
								<span class="hs2-ctx-hint">✦ {hsWidgets[hsWidgetCtxIdx].label}-data sendt som kontekst</span>
							</div>
						{/if}
						<div class="hs2-chat-body">
							{#each hsChatThread as msg}
								<div class="hs2-thread-row hs2-row-{msg.s}">
									<div class="hs2-thread-bub hs2-bub-{msg.s}">{msg.t}</div>
									{#if msg.branch}<div class="hs2-branch-tag">→ {msg.branch}</div>{/if}
								</div>
							{/each}
						</div>
						<div class="hs2-input-bar">
							<input class="hs2-input" type="text" placeholder="Si hva du har på hjertet…" bind:value={hsChatText}/>
						</div>

					{:else}
						<!-- Expanded: file dialog -->
						<div class="hs2-top-bar">
							<button class="hs2-back" onclick={() => hsPane = null}>‹ Tilbake</button>
							<span class="hs2-top-title">Legg til</span>
						</div>
						<button
							class="hs2-drop-zone"
							onclick={() => { hsFileSuggested = true; }}
						>
							<span class="hs2-drop-ico">📎</span>
							<span class="hs2-drop-lbl">Trykk for å legge til fil, bilde eller lyd</span>
						</button>
						{#if hsFileSuggested}
							<div class="hs2-file-suggestions">
								<p class="hs2-sugg-heading">✦ AI foreslår:</p>
								{#each hsFileSugg as s, i}
									<button
										class="hs2-sugg-row"
										class:chosen={hsFileAdded && i === 0}
										onclick={() => { if (i === 0) hsFileAdded = true; }}
									>
										<span class="hs2-sugg-ico">{s.icon}</span>
										<span class="hs2-sugg-txt">{s.text}</span>
										{#if hsFileAdded && i === 0}<span class="hs2-sugg-check">✓</span>{/if}
									</button>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Ripple overlay -->
				{#each hsRipples as r (r.id)}
					<div class="hs2-ripple" style="left:{r.x}px; top:{r.y}px; --rc:{r.col}" aria-hidden="true"></div>
				{/each}

			</div><!-- end hs2-phone -->

		</section>

		<!-- ══ WIDGETS — GALLERI ═════════════════════════════════════════════════════════ -->
		<section id="Widgets — galleri" class="ds-section">
			<h2 class="ds-section-heading">Widgets — galleri</h2>
			<p class="ds-body" style="margin-bottom:2rem;color:var(--text-secondary)">
				Widgets er levende miniatyrbilder av et tema eller mål. De vises i sone 1 på hjemskjerm,
				siden i temaet, og som komprimerte kort i lister. Todo-lister, mål-ringer og streaks er alle varianter.
			</p>

			<!-- ── Variantgalleri ── -->
			<div class="wg-gallery">

				<!-- ▸ 1: Akkumulert løpemål + periodevalg -->
				<div class="wg-cell">
					<p class="wg-label">Mål-ring · Løping</p>
					<div class="wg-frame">
						<div class="wg-ring-wrap">
							<svg class="wg-ring-svg" viewBox="0 0 64 64">
								<circle cx="32" cy="32" r="26" fill="none" stroke="#1e1e2a" stroke-width="5"/>
								<circle cx="32" cy="32" r="26" fill="none" stroke="#7c8ef5" stroke-width="5"
									stroke-dasharray="{((wgRunData[wgRunPeriod].pct / 100) * 163.4).toFixed(1)} 163.4"
									stroke-linecap="round" transform="rotate(-90 32 32)"/>
							</svg>
							<div class="wg-ring-center">
								<span class="wg-delta" style="color:#7c8ef5">{wgRunData[wgRunPeriod].delta}</span>
								<span class="wg-unit">{wgRunData[wgRunPeriod].ctx}</span>
							</div>
						</div>
						<div class="wg-period-pills">
							{#each ['uke','måned','kvartal'] as p}
								<button class="wg-period-btn" class:active={wgRunPeriod === p}
									onclick={() => wgRunPeriod = p as typeof wgRunPeriod}>{p}</button>
							{/each}
						</div>
						<span class="wg-name">Løping</span>
					</div>
				</div>

				<!-- ▸ 2: Todo-ring (2/5 · 40%) -->
				<div class="wg-cell">
					<p class="wg-label">Mål-ring · Todo</p>
					<div class="wg-frame">
						<div class="wg-ring-wrap">
							<svg class="wg-ring-svg" viewBox="0 0 64 64">
								<circle cx="32" cy="32" r="26" fill="none" stroke="#1e1a0e" stroke-width="5"/>
								<circle cx="32" cy="32" r="26" fill="none" stroke="#f0b429" stroke-width="5"
									stroke-dasharray="65.4 163.4"
									stroke-linecap="round" transform="rotate(-90 32 32)"/>
							</svg>
							<div class="wg-ring-center">
								<span class="wg-delta" style="color:#f0b429">2/5</span>
								<span class="wg-unit">40%</span>
							</div>
						</div>
						<span class="wg-name">Fikse syklene</span>
					</div>
				</div>

				<!-- ▸ 3: Vekt-delta + periodevalg -->
				<div class="wg-cell">
					<p class="wg-label">Delta-ring · Vekt</p>
					<div class="wg-frame">
						<div class="wg-ring-wrap">
							<svg class="wg-ring-svg" viewBox="0 0 64 64">
								<circle cx="32" cy="32" r="26" fill="none" stroke="#1a1a1a" stroke-width="5"/>
								<circle cx="32" cy="32" r="26" fill="none"
									stroke="{wgWeightData[wgWeightPeriod].col}" stroke-width="5"
									stroke-dasharray="{((wgWeightData[wgWeightPeriod].pct / 100) * 163.4).toFixed(1)} 163.4"
									stroke-linecap="round" transform="rotate(-90 32 32)"/>
							</svg>
							<div class="wg-ring-center">
								<span class="wg-delta" style="color:{wgWeightData[wgWeightPeriod].col}">{wgWeightData[wgWeightPeriod].delta}</span>
								<span class="wg-unit">kg</span>
							</div>
						</div>
						<div class="wg-period-pills">
							{#each ['7d','30d','90d'] as p}
								<button class="wg-period-btn" class:active={wgWeightPeriod === p}
									onclick={() => wgWeightPeriod = p as typeof wgWeightPeriod}>{p}</button>
							{/each}
						</div>
						<span class="wg-name">Vekt</span>
					</div>
				</div>

				<!-- ▸ 4: Streak -->
				<div class="wg-cell">
					<p class="wg-label">Streak</p>
					<div class="wg-frame">
						<div class="wg-streak-circ" style="--wc:#f0b429">
							<span class="wg-streak-flame">🔥</span>
							<span class="wg-big" style="color:#f0b429;line-height:1">12</span>
							<span class="wg-unit">dager</span>
						</div>
						<div class="wg-streak-dots">
							{#each Array(7) as _, di}
								<div class="wg-streak-dot" class:wg-done={di < 5} class:wg-today={di === 5}></div>
							{/each}
						</div>
						<span class="wg-name">Jogging</span>
					</div>
				</div>

				<!-- ▸ 5: Forbruk vs. forrige mnd -->
				<div class="wg-cell">
					<p class="wg-label">Forbruk vs. forrige mnd</p>
					<div class="wg-frame">
						<div class="wg-ring-wrap">
							<svg class="wg-ring-svg" viewBox="0 0 64 64">
								<!-- Track = hele budsjettet (= fjorige mnd) -->
								<circle cx="32" cy="32" r="26" fill="none" stroke="#1a1a1a" stroke-width="5"/>
								<!-- Progress = faktisk måned-til-dato (64% av budsjett brukt) -->
								<circle cx="32" cy="32" r="26" fill="none" stroke="#5fa0a0" stroke-width="5"
									stroke-dasharray="104.6 163.4"
									stroke-linecap="round" transform="rotate(-90 32 32)"/>
								<!-- Forventet daglig pace-markering (dag 20/30 = 66.7%) -->
								<line x1="32" y1="6" x2="32" y2="11"
									stroke="#555" stroke-width="1.5" stroke-linecap="round"
									transform="rotate({0.667 * 360} 32 32)"/>
							</svg>
							<div class="wg-ring-center">
								<span class="wg-delta" style="color:#5fa0a0">−320</span>
								<span class="wg-unit">kr vs pace</span>
							</div>
						</div>
						<span class="wg-name">Dagligvarer</span>
					</div>
				</div>

				<!-- ▸ 6: Dobbel ring (ingen legende — se temaside) -->
				<div class="wg-cell">
					<p class="wg-label">Dobbel ring · Aktivitet</p>
					<div class="wg-frame">
						<div class="wg-ring-wrap">
							<svg class="wg-ring-svg" viewBox="0 0 64 64">
								<circle cx="32" cy="32" r="27" fill="none" stroke="#1e1e1e" stroke-width="4"/>
								<circle cx="32" cy="32" r="27" fill="none" stroke="#e07070" stroke-width="4"
									stroke-dasharray="116 169.6" stroke-linecap="round" transform="rotate(-90 32 32)"/>
								<circle cx="32" cy="32" r="19" fill="none" stroke="#1e1e1e" stroke-width="4"/>
								<circle cx="32" cy="32" r="19" fill="none" stroke="#5fa0a0" stroke-width="4"
									stroke-dasharray="89.5 119.4" stroke-linecap="round" transform="rotate(-90 32 32)"/>
							</svg>
							<div class="wg-ring-center">
								<span class="wg-delta" style="color:#e07070">68%</span>
							</div>
						</div>
						<span class="wg-name">Aktivitet</span>
					</div>
				</div>

				<!-- ▸ 7: Tall-sirkel · Søvn -->
				<div class="wg-cell">
					<p class="wg-label">Tall-sirkel · Søvn</p>
					<div class="wg-frame">
						<div class="wg-val-circ" style="--wc:#5fa0a0">
							<div class="wg-val-inner">
								<span class="wg-big">7.8</span>
								<span class="wg-unit">h</span>
							</div>
							<span class="wg-name">Søvn</span>
						</div>
					</div>
				</div>

				<!-- ▸ 8: Sparkline · Skritt -->
				<div class="wg-cell">
					<p class="wg-label">Sparkline · Trend</p>
					<div class="wg-frame">
						<div class="wg-spark-circ" style="--wc:#7c8ef5">
							<svg class="wg-spark-svg" viewBox="0 0 56 24" preserveAspectRatio="none">
								<polyline points="0,20 8,16 16,10 24,14 32,6 40,9 48,4 56,2"
									fill="none" stroke="#7c8ef5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
								<circle cx="56" cy="2" r="2.5" fill="#7c8ef5"/>
							</svg>
							<div class="wg-val-inner" style="margin-top:4px">
								<span class="wg-big" style="color:#7c8ef5">8.4</span>
								<span class="wg-unit">k skritt</span>
							</div>
							<span class="wg-name" style="color:#444">↑ 14% fra i går</span>
						</div>
					</div>
				</div>

				<!-- ▸ 9: Dobbel-sparkline · Parforhold -->
				<div class="wg-cell">
					<p class="wg-label">Dobbel-sparkline · Relasjon</p>
					<div class="wg-frame">
						<div class="wg-rel-circ">
							<svg viewBox="0 0 64 64" style="width:100%;height:100%;display:block">
								<!-- subtile horisontale gridlinjer -->
								<line x1="0" y1="20" x2="64" y2="20" stroke="#1e1e1e" stroke-width="0.5"/>
								<line x1="0" y1="32" x2="64" y2="32" stroke="#1e1e1e" stroke-width="0.5"/>
								<line x1="0" y1="44" x2="64" y2="44" stroke="#1e1e1e" stroke-width="0.5"/>
								<!-- fyllärer -->
								<polygon points="2,64 2,32 12,20 22,32 32,8 42,20 52,20 62,8 62,64"
									fill="#d4829a" fill-opacity="0.12"/>
								<polygon points="2,64 2,44 12,32 22,20 32,32 42,20 52,32 62,20 62,64"
									fill="#7cb5c0" fill-opacity="0.12"/>
								<!-- person A (rosa) -->
								<polyline points="2,32 12,20 22,32 32,8 42,20 52,20 62,8"
									fill="none" stroke="#d4829a" stroke-width="1.5"
									stroke-linecap="round" stroke-linejoin="round"/>
								<!-- person B (blå) -->
								<polyline points="2,44 12,32 22,20 32,32 42,20 52,32 62,20"
									fill="none" stroke="#7cb5c0" stroke-width="1.5"
									stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</div>
						<div class="wg-rel-vals">
							<span style="color:#d4829a">● 5</span>
							<span style="color:#7cb5c0">● 4</span>
						</div>
						<span class="wg-name">Kobling · i dag</span>
					</div>
				</div>

			</div><!-- /wg-gallery -->

			<!-- ── Streak-header (full bredde) ── -->
			<h3 class="ds-subsection" style="margin-top:2rem">Streak-header</h3>
			<p class="ds-caption">Brukes øverst i et tema eller på hjem-skjermens topp. Kombinerer dato, nåværende streak og ukens mini-kalender.</p>
			<div class="wg-streak-header">
				<div class="wg-sh-left">
					<span class="wg-sh-date">Fredag 27. mars</span>
					<span class="wg-sh-sub">Uke 13</span>
				</div>
				<div class="wg-sh-mid">
					{#each ['M','T','O','T','F','L','S'] as day, di}
						<div class="wg-sh-day">
							<span class="wg-sh-daylbl">{day}</span>
							<div class="wg-sh-dot" class:wg-sh-done={di < 4} class:wg-sh-today={di === 4}></div>
						</div>
					{/each}
				</div>
				<div class="wg-sh-right">
					<span class="wg-streak-flame" style="font-size:1.2rem">🔥</span>
					<span class="wg-sh-streak">12</span>
				</div>
			</div>

		</section>

	</main>
</div>

<!-- ── TOAST CONTAINER ─────────────────────────────────────────────────────── -->
<div class="toast-container">
	{#each toasts as t (t.id)}
		<div class="toast toast-{t.type}" transition:fly={{ y: 12, duration: 250 }}>
			{t.message}
		</div>
	{/each}
</div>

</svelte:element>

<style>
/* ── THEME SUPPORT ─────────────────────────────────────────────────────────── */
.design-root {
	background: var(--bg-primary);
	color: var(--text-primary);
	min-height: 100vh;
}
.design-root[data-theme="light"] {
	--bg-primary: #ffffff;
	--bg-secondary: #f5f5f5;
	--bg-card: #ffffff;
	--bg-header: #f8f8f8;
	--bg-input: #ffffff;
	--bg-hover: #f0f0f0;
	--text-primary: #1a1a1a;
	--text-secondary: #666666;
	--text-tertiary: #999999;
	--border-color: #e0e0e0;
	--border-subtle: #f0f0f0;
	--accent-primary: #667eea;
	--accent-hover: #5568d3;
	--success-bg: rgba(34,197,94,0.1);
	--success-text: #16a34a;
	--success-border: rgba(34,197,94,0.2);
	--error-bg: rgba(239,68,68,0.1);
	--error-text: #dc2626;
	--error-border: rgba(239,68,68,0.2);
	--info-bg: rgba(102,126,234,0.1);
	--info-border: rgba(102,126,234,0.3);
	--shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
	--shadow-md: 0 4px 6px rgba(0,0,0,0.07);
}
.design-root[data-theme="dark"] {
	--bg-primary: #0a0a0a;
	--bg-secondary: #111111;
	--bg-card: #1a1a1a;
	--bg-header: #111111;
	--bg-input: #111111;
	--bg-hover: #222222;
	--text-primary: #ffffff;
	--text-secondary: #aaaaaa;
	--text-tertiary: #888888;
	--border-color: #2a2a2a;
	--border-subtle: #1a1a1a;
	--accent-primary: #667eea;
	--accent-hover: #7c8ef5;
	--success-bg: rgba(34,197,94,0.12);
	--success-text: #4ade80;
	--success-border: rgba(34,197,94,0.25);
	--error-bg: rgba(239,68,68,0.12);
	--error-text: #f87171;
	--error-border: rgba(239,68,68,0.25);
	--info-bg: rgba(102,126,234,0.12);
	--info-border: rgba(102,126,234,0.35);
	--shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
	--shadow-md: 0 4px 6px rgba(0,0,0,0.5);
}

/* ── TOPBAR ────────────────────────────────────────────────────────────────── */
.ds-topbar {
	position: sticky;
	top: 0;
	z-index: 100;
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 0.75rem 1.5rem;
	background: var(--bg-header);
	border-bottom: 1px solid var(--border-color);
	backdrop-filter: blur(10px);
}
.ds-logo { font-size: 1rem; font-weight: 700; letter-spacing: -0.02em; }
.ds-logo em { font-style: normal; font-weight: 400; color: var(--text-secondary); margin-left: 6px; }
.ds-theme-toggle { display: flex; gap: 4px; }
.ds-theme-btn {
	padding: 4px 10px;
	border: 1px solid var(--border-color);
	background: transparent;
	color: var(--text-secondary);
	border-radius: 999px;
	font-size: 0.75rem;
	cursor: pointer;
	transition: all 0.15s;
}
.ds-theme-btn.active {
	background: var(--accent-primary);
	border-color: var(--accent-primary);
	color: white;
}

/* ── LAYOUT ────────────────────────────────────────────────────────────────── */
.ds-layout { display: flex; min-height: calc(100vh - 49px); }
.ds-sidebar {
	width: 200px;
	flex-shrink: 0;
	padding: 1.5rem 0;
	border-right: 1px solid var(--border-color);
	position: sticky;
	top: 49px;
	height: calc(100vh - 49px);
	overflow-y: auto;
}
.ds-nav-item {
	display: block;
	padding: 0.5rem 1.25rem;
	text-decoration: none;
	font-size: 0.85rem;
	color: var(--text-secondary);
	border-left: 2px solid transparent;
	transition: all 0.15s;
}
.ds-nav-item:hover, .ds-nav-item.active {
	color: var(--accent-primary);
	border-left-color: var(--accent-primary);
	background: var(--bg-hover);
}
.ds-main { flex: 1; padding: 2rem; max-width: 900px; }

/* ── SECTIONS ──────────────────────────────────────────────────────────────── */
.ds-section { margin-bottom: 4rem; scroll-margin-top: 65px; }
.ds-section-heading {
	font-size: 1.5rem;
	font-weight: 700;
	margin: 0 0 1.5rem;
	padding-bottom: 0.75rem;
	border-bottom: 2px solid var(--border-color);
	letter-spacing: -0.02em;
}
.ds-subsection {
	font-size: 0.75rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: var(--text-tertiary);
	margin: 1.75rem 0 0.75rem;
}

/* ── COLORS ────────────────────────────────────────────────────────────────── */
.ds-color-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.ds-color-swatch { display: flex; flex-direction: column; gap: 4px; }
.ds-color-blob { width: 56px; height: 56px; border-radius: 8px; border: 1px solid var(--border-color); }
.ds-color-name { font-size: 0.65rem; font-family: monospace; color: var(--text-tertiary); word-break: break-all; max-width: 80px; }
.ds-color-label { font-size: 0.7rem; color: var(--text-secondary); }
.ds-semantic-chip {
	padding: 6px 14px;
	border-radius: 999px;
	font-size: 0.8rem;
	font-weight: 500;
}

/* ── TYPOGRAPHY ────────────────────────────────────────────────────────────── */
.ds-type-stack { display: flex; flex-direction: column; gap: 1.5rem; }
.ds-type-row {
	display: flex;
	align-items: baseline;
	gap: 1.5rem;
	padding: 1rem;
	background: var(--bg-secondary);
	border-radius: 8px;
}
.ds-type-meta { font-size: 0.7rem; color: var(--text-tertiary); min-width: 160px; font-family: monospace; }
.ds-type-display { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; }
.ds-h1 { font-size: 1.5rem; font-weight: 700; margin: 0; }
.ds-h2 { font-size: 1.25rem; font-weight: 600; margin: 0; }
.ds-h3 { font-size: 1rem; font-weight: 600; margin: 0; }
.ds-body { font-size: 1rem; margin: 0; line-height: 1.6; }
.ds-small { font-size: 0.875rem; color: var(--text-secondary); margin: 0; }
.ds-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
.ds-stat-num { font-size: 3rem; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
.ds-mono { font-family: monospace; font-size: 0.85rem; background: var(--bg-secondary); padding: 2px 6px; border-radius: 4px; }

/* ── SPACING ───────────────────────────────────────────────────────────────── */
.ds-spacing-grid { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
.ds-spacing-row { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.ds-spacing-label { font-size: 0.65rem; color: var(--text-tertiary); }
.ds-spacing-bar { background: var(--accent-primary); opacity: 0.6; border-radius: 2px; }

.ds-mobile-frame {
	max-width: 375px;
	border: 1px solid var(--border-color);
	border-radius: 24px;
	padding: 20px 16px;
	background: var(--bg-secondary);
	margin: 0.5rem 0;
}
.ds-mobile-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
.ds-grid-col { background: rgba(102,126,234,0.2); border-radius: 4px; height: 40px; display: grid; place-items: center; font-size: 0.75rem; color: var(--accent-primary); }
.ds-mobile-note { font-size: 0.7rem; color: var(--text-tertiary); margin: 8px 0 0; text-align: center; }

.ds-radius-grid { display: flex; flex-wrap: wrap; gap: 12px; }
.ds-radius-box {
	width: 80px; height: 60px;
	background: var(--bg-secondary);
	border: 2px solid var(--border-color);
	display: flex; flex-direction: column;
	align-items: center; justify-content: center;
	gap: 2px;
}
.ds-radius-box span { font-size: 0.75rem; font-weight: 600; }
.ds-radius-box small { font-size: 0.6rem; color: var(--text-tertiary); }

/* ── BUTTONS ───────────────────────────────────────────────────────────────── */
.btn {
	display: inline-flex; align-items: center; gap: 6px;
	padding: 0.55rem 1.1rem;
	border: none; border-radius: 999px;
	font: inherit; font-size: 0.9rem; font-weight: 500;
	cursor: pointer; transition: all 0.15s;
	white-space: nowrap;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary { background: var(--accent-primary); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); box-shadow: 0 4px 12px rgba(102,126,234,0.35); }
.btn-secondary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); }
.btn-secondary:hover:not(:disabled) { background: var(--bg-hover); }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn-ghost:hover:not(:disabled) { background: var(--bg-hover); }
.btn-danger { background: var(--error-bg); color: var(--error-text); border: 1px solid var(--error-border); }
.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
.btn-lg { padding: 0.8rem 1.5rem; font-size: 1rem; }
.btn-full { width: 100%; justify-content: center; }

.ds-tab-group { display: flex; background: var(--bg-secondary); border-radius: 999px; padding: 3px; width: fit-content; }
.ds-tab {
	padding: 0.4rem 1rem; border: none; background: transparent;
	border-radius: 999px; font: inherit; font-size: 0.85rem;
	color: var(--text-secondary); cursor: pointer; transition: all 0.15s;
}
.ds-tab.active { background: var(--bg-primary); color: var(--text-primary); font-weight: 600; box-shadow: var(--shadow-sm); }

.ds-fab-demo { display: flex; gap: 12px; padding: 1rem; }
.btn-fab {
	width: 52px; height: 52px; border-radius: 50%;
	background: var(--accent-primary); color: white;
	border: none; font-size: 1.5rem; cursor: pointer;
	box-shadow: 0 4px 16px rgba(102,126,234,0.4);
	transition: all 0.15s;
	display: grid; place-items: center;
}
.btn-fab:hover { transform: scale(1.1); }
.btn-fab-chat { background: #1a1a1a; }
:global(.design-root[data-theme="dark"]) .btn-fab-chat { background: #ffffff; color: #0a0a0a; }

/* ── CARDS ─────────────────────────────────────────────────────────────────── */
.ds-card-row { display: flex; flex-wrap: wrap; gap: 12px; }
.card {
	flex: 1 1 160px;
	padding: 1rem;
	background: var(--bg-card);
	border: 1px solid var(--border-color);
	border-radius: 12px;
}
.card-elevated {
	box-shadow: var(--shadow-md);
	border-color: transparent;
}
.card-accent {
	background: var(--info-bg);
	border-color: var(--info-border);
}

.goal-card {
	background: var(--bg-card);
	border: 1px solid var(--border-color);
	border-radius: 16px;
	padding: 1rem;
	margin-bottom: 0.75rem;
}
.goal-card-inactive { opacity: 0.8; }
.goal-card-top { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 12px; }
.goal-icon { font-size: 1.5rem; }
.goal-title { font-weight: 600; font-size: 0.95rem; margin: 0 0 2px; }
.goal-sub { font-size: 0.75rem; color: var(--text-tertiary); margin: 0; }
.goal-badge {
	margin-left: auto; padding: 2px 8px;
	border-radius: 999px; font-size: 0.7rem; font-weight: 600;
	white-space: nowrap;
}
.goal-badge-on-track { background: var(--success-bg); color: var(--success-text); }
.goal-badge-behind { background: var(--error-bg); color: var(--error-text); }
.goal-progress-row { display: flex; align-items: baseline; gap: 4px; margin-bottom: 8px; }
.goal-stat { font-size: 1.75rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.goal-of { font-size: 0.85rem; color: var(--text-tertiary); }
.goal-hint { font-size: 0.75rem; color: var(--text-tertiary); margin: 6px 0 0; }

.sensor-card {
	flex: 1 1 120px;
	display: flex; gap: 10px; align-items: center;
	padding: 0.75rem;
	background: var(--bg-card);
	border: 1px solid var(--border-color);
	border-radius: 12px;
}
.sensor-icon { font-size: 1.5rem; }
.sensor-label { font-size: 0.7rem; color: var(--text-tertiary); margin: 0; }
.sensor-value { font-size: 1.1rem; font-weight: 700; margin: 2px 0; }
.sensor-delta { font-size: 0.7rem; margin: 0; color: var(--text-tertiary); }
.sensor-delta-down { color: var(--success-text); }
.sensor-delta-up { color: var(--error-text); }

/* ── INPUT ─────────────────────────────────────────────────────────────────── */
.form-field { margin-bottom: 1rem; }
.form-label { display: block; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
.form-input {
	width: 100%; padding: 0.6rem 0.9rem;
	background: var(--bg-input); color: var(--text-primary);
	border: 1px solid var(--border-color); border-radius: 8px;
	font: inherit; font-size: 0.9rem;
	transition: border-color 0.15s, box-shadow 0.15s;
}
.form-input:focus { outline: none; border-color: var(--accent-primary); box-shadow: 0 0 0 3px rgba(102,126,234,0.15); }
.form-select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; background-size: 16px; padding-right: 2rem; }
.form-toggle-row { display: flex; align-items: center; justify-content: space-between; }
.form-toggle-label { font-size: 0.9rem; color: var(--text-primary); }
.form-toggle {
	width: 44px; height: 24px; border-radius: 999px;
	background: var(--border-color); border: none; cursor: pointer; position: relative;
	transition: background 0.2s;
}
.form-toggle::after {
	content: ''; position: absolute;
	top: 3px; left: 3px;
	width: 18px; height: 18px; border-radius: 50%;
	background: white; transition: transform 0.2s;
}
.form-toggle.active { background: var(--accent-primary); }
.form-toggle.active::after { transform: translateX(20px); }

.chat-input-wrap { display: flex; gap: 8px; align-items: center; }
.chat-input-field {
	flex: 1; padding: 0.65rem 1rem;
	background: var(--bg-input); color: var(--text-primary);
	border: 1px solid var(--border-color); border-radius: 999px;
	font: inherit; font-size: 0.9rem;
	transition: border-color 0.15s;
}
.chat-input-field:focus { outline: none; border-color: var(--accent-primary); }
.chat-send-btn {
	width: 36px; height: 36px; border-radius: 50%;
	background: var(--accent-primary); color: white;
	border: none; font-size: 1rem; cursor: pointer;
	display: grid; place-items: center;
	transition: all 0.15s;
	flex-shrink: 0;
}
.chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.chat-send-btn:not(:disabled):hover { background: var(--accent-hover); transform: scale(1.05); }

/* ── STAT CARDS ────────────────────────────────────────────────────────────── */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.stat-card {
	padding: 1rem;
	background: var(--bg-card);
	border: 1px solid var(--border-color);
	border-radius: 12px;
}
.stat-card.stat-accent {
	background: var(--accent-primary);
	border-color: transparent;
	color: white;
}
.stat-card.stat-accent .stat-label,
.stat-card.stat-accent .stat-context { color: rgba(255,255,255,0.75); }
.stat-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); margin: 0 0 6px; }
.stat-value { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; margin: 0 0 4px; line-height: 1; }
.stat-context { font-size: 0.75rem; color: var(--text-secondary); margin: 0; }
.stat-positive { color: var(--success-text); }

/* ── PROGRESS ──────────────────────────────────────────────────────────────── */
.progress-bar-wrap { background: var(--bg-secondary); border-radius: 999px; height: 8px; overflow: hidden; }
.progress-bar-fill { height: 100%; background: var(--accent-primary); border-radius: 999px; transition: width 0.6s cubic-bezier(0.34,1.56,0.64,1); }
.progress-bar-warn { background: #f59e0b; }
.progress-bar-success { background: #10b981; }

.ds-progress-stack { display: flex; flex-direction: column; gap: 16px; max-width: 480px; }
.ds-progress-item { display: flex; flex-direction: column; gap: 6px; }
.ds-progress-header { display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 500; }
.ds-range { width: 100%; accent-color: var(--accent-primary); }

.ds-ring-wrap { position: relative; width: 100px; height: 100px; }
.ds-ring-label {
	position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
	display: flex; flex-direction: column; align-items: center;
}
.ds-ring-value { font-size: 1.1rem; font-weight: 700; }
.ds-ring-sub { font-size: 0.65rem; color: var(--text-tertiary); }

/* ── CHARTS ────────────────────────────────────────────────────────────────── */
.sparkline-wrap { max-width: 320px; }
.sparkline { width: 100%; height: 60px; display: block; }

.bar-chart-wrap {
	display: flex; align-items: flex-end; gap: 6px;
	height: 120px; padding: 0 4px;
}
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.bar-bar { width: 100%; background: var(--accent-primary); border-radius: 4px 4px 0 0; transition: height 0.4s; opacity: 0.85; min-height: 4px; }
.bar-label { font-size: 0.65rem; color: var(--text-tertiary); }

.heatmap-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; max-width: 200px; }
.heatmap-cell { aspect-ratio: 1; border-radius: 3px; }

/* ── NAVIGATION ────────────────────────────────────────────────────────────── */
.bottom-nav {
	display: flex; background: var(--bg-card);
	border-top: 1px solid var(--border-color);
	border-radius: 0 0 22px 22px;
}
.bottom-nav-item {
	flex: 1; display: flex; flex-direction: column; align-items: center;
	gap: 2px; padding: 10px 4px 12px;
	background: transparent; border: none;
	cursor: pointer; transition: color 0.15s;
	color: var(--text-tertiary);
}
.bottom-nav-item.active { color: var(--accent-primary); }
.bottom-nav-icon { font-size: 1.25rem; }
.bottom-nav-label { font-size: 0.65rem; font-weight: 500; }
.ds-page-preview { background: var(--bg-primary); border-radius: 16px 16px 0 0; min-height: 100px; }

.top-app-bar {
	display: flex; align-items: center;
	padding: 12px 4px;
	gap: 8px;
}
.top-app-bar-title { flex: 1; text-align: center; font-weight: 600; font-size: 1rem; }
.icon-btn {
	width: 36px; height: 36px; border-radius: 50%;
	background: transparent; border: none; cursor: pointer;
	font-size: 1rem; color: var(--text-primary);
	display: grid; place-items: center;
}
.icon-btn:hover { background: var(--bg-hover); }

.chip-nav { display: flex; gap: 8px; overflow-x: auto; padding: 4px 0; }
.chip {
	padding: 6px 14px; border-radius: 999px;
	background: var(--bg-secondary); color: var(--text-secondary);
	border: 1px solid var(--border-color); font: inherit; font-size: 0.8rem;
	cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.chip.active { background: var(--accent-primary); color: white; border-color: transparent; }

/* ── ANIMATIONS ────────────────────────────────────────────────────────────── */
.ds-anim-stage { display: flex; flex-wrap: wrap; gap: 12px; min-height: 60px; padding: 1rem; background: var(--bg-secondary); border-radius: 12px; }
.ds-anim-box { padding: 12px 20px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 8px; font-size: 0.85rem; }

@keyframes pulse-ring {
	0% { transform: scale(1); opacity: 1; }
	70% { transform: scale(2); opacity: 0; }
	100% { transform: scale(2); opacity: 0; }
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes shimmer {
	0% { background-position: -200% 0; }
	100% { background-position: 200% 0; }
}

.anim-pulse-dot {
	width: 12px; height: 12px; border-radius: 50%;
	background: #10b981; position: relative;
}
.anim-pulse-dot::after {
	content: ''; position: absolute; inset: 0;
	border-radius: 50%; background: #10b981;
	animation: pulse-ring 1.8s ease-out infinite;
}
.anim-spinner {
	width: 20px; height: 20px; border-radius: 50%;
	border: 2.5px solid var(--border-color);
	border-top-color: var(--accent-primary);
	animation: spin 0.7s linear infinite;
}
.anim-shimmer-bar {
	width: 120px; height: 14px; border-radius: 4px;
	background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-hover) 50%, var(--bg-secondary) 75%);
	background-size: 200% 100%;
	animation: shimmer 1.5s infinite;
}

.skeleton-card { display: flex; flex-direction: column; gap: 8px; }
.skeleton-line {
	height: 12px; border-radius: 4px;
	background: linear-gradient(90deg, var(--bg-secondary) 25%, var(--bg-hover) 50%, var(--bg-secondary) 75%);
	background-size: 200% 100%;
	animation: shimmer 1.5s infinite;
}
.skeleton-line-short { width: 50%; }
.skeleton-line-medium { width: 75%; }

/* ── CHAT ──────────────────────────────────────────────────────────────────── */
.chat-messages-wrap { display: flex; flex-direction: column; gap: 10px; }
.chat-bubble-row { display: flex; align-items: flex-end; gap: 8px; }
.chat-bubble-row.user-row { flex-direction: row-reverse; }
.chat-avatar {
	width: 28px; height: 28px; border-radius: 50%;
	background: var(--accent-primary); color: white;
	font-size: 0.7rem; font-weight: 700;
	display: grid; place-items: center; flex-shrink: 0;
}
.chat-bubble {
	max-width: 80%; padding: 8px 12px;
	background: var(--bg-card); border: 1px solid var(--border-color);
	border-radius: 16px 16px 16px 4px;
	font-size: 0.875rem; line-height: 1.5;
}
.chat-bubble-user {
	background: var(--accent-primary); color: white;
	border-color: transparent;
	border-radius: 16px 16px 4px 16px;
}
.chat-typing { display: flex; gap: 4px; align-items: center; padding: 12px 14px; }
.typing-dot {
	width: 6px; height: 6px; border-radius: 50%;
	background: var(--text-tertiary);
	animation: bounce 1.2s ease-in-out infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes bounce { 0%,80%,100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }

.ds-page-preview-tall { background: var(--bg-primary); flex: 1; min-height: 120px; }
.bottom-sheet-preview {
	background: var(--bg-card);
	border-top: 1px solid var(--border-color);
	padding: 12px 16px 16px;
	border-radius: 0 0 22px 22px;
}
.bottom-sheet-handle { width: 36px; height: 4px; border-radius: 2px; background: var(--border-color); margin: 0 auto 12px; }

/* ── TOAST ─────────────────────────────────────────────────────────────────── */
.toast-container {
	position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
	display: flex; flex-direction: column; gap: 8px; z-index: 9999;
	pointer-events: none;
}
.toast {
	padding: 12px 20px; border-radius: 12px;
	font-size: 0.875rem; font-weight: 500;
	box-shadow: 0 8px 24px rgba(0,0,0,0.15);
	backdrop-filter: blur(8px);
	white-space: nowrap;
}
.toast-success { background: var(--success-bg); color: var(--success-text); border: 1px solid var(--success-border); }
.toast-error { background: var(--error-bg); color: var(--error-text); border: 1px solid var(--error-border); }
.toast-info { background: var(--info-bg); color: var(--accent-primary); border: 1px solid var(--info-border); }

/* ── BADGES ────────────────────────────────────────────────────────────────── */
.badge { padding: 3px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; }
.badge-success { background: var(--success-bg); color: var(--success-text); }
.badge-warn { background: rgba(245,158,11,0.12); color: #b45309; }
.badge-error { background: var(--error-bg); color: var(--error-text); }
.badge-neutral { background: var(--bg-secondary); color: var(--text-secondary); border: 1px solid var(--border-color); }
.badge-info { background: var(--info-bg); color: var(--accent-primary); }

/* ── EMPTY STATE ───────────────────────────────────────────────────────────── */
.empty-state {
	text-align: center; padding: 3rem 1rem;
	background: var(--bg-secondary); border-radius: 16px;
	max-width: 320px;
}
.empty-icon { font-size: 3rem; margin-bottom: 12px; }
.empty-title { font-size: 1.1rem; font-weight: 600; margin: 0 0 8px; }
.empty-sub { font-size: 0.875rem; color: var(--text-secondary); margin: 0 0 1.5rem; line-height: 1.5; }

/* ── UTILS ─────────────────────────────────────────────────────────────────── */
.ds-row { display: flex; }
.ds-wrap { flex-wrap: wrap; }
.ds-align-center { align-items: center; gap: 12px; }

/* ════════════════════════════════════════════════════════════════════════════
   MODUS: FOKUS & KOMPOSISJON  (Bend-inspirert)
   ════════════════════════════════════════════════════════════════════════ */

/* Dark frame override – always dark regardless of theme toggle */
.bend-dark-frame {
	background: #0d0d0d !important;
	border-color: #2a2a2a !important;
	color: #ffffff;
}

/* 1. Header */
.bend-header {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	padding: 4px 0 16px;
}
.bend-date-block { flex: 1; }
.bend-date-label {
	font-size: 0.72rem;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: #888;
	margin: 0 0 4px;
}
.bend-date-day {
	font-size: 2rem;
	font-weight: 700;
	margin: 0;
	color: #ffffff;
	letter-spacing: -0.03em;
}
.bend-header-actions { display: flex; gap: 10px; align-items: center; padding-top: 8px; }
.bend-streak-pill {
	display: flex;
	align-items: center;
	gap: 5px;
	background: #1f1f1f;
	border-radius: 999px;
	padding: 6px 12px;
	border: 1px solid #2a2a2a;
}
.bend-streak-flame { font-size: 1rem; }
.bend-streak-num { font-size: 0.95rem; font-weight: 700; color: #fff; }
.bend-avatar-btn {
	width: 36px; height: 36px; border-radius: 50%;
	background: #1f1f1f; border: 1px solid #2a2a2a;
	display: grid; place-items: center; font-size: 1rem;
	cursor: pointer;
}

/* 2. Featured card + bubble cluster */
.bend-featured-card {
	background: #1a1a1a;
	border-radius: 20px;
	padding: 1.25rem;
	border: 1px solid #2a2a2a;
}
.bend-card-meta {
	font-size: 0.68rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: #666;
	margin: 0 0 4px;
}
.bend-card-title {
	font-size: 1.5rem;
	font-weight: 700;
	color: #fff;
	margin: 0 0 1.25rem;
}
.bend-bubble-cluster {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	justify-content: center;
	align-items: center;
	padding: 8px 0;
}
.bend-bubble {
	width: var(--size, 60px);
	height: var(--size, 60px);
	border-radius: 50%;
	border: 1px solid;
	display: grid;
	place-items: center;
	animation: bubblePop 0.4s cubic-bezier(0.34,1.56,0.64,1) both;
	animation-delay: var(--delay, 0s);
	transition: transform 0.15s;
	cursor: pointer;
}
.bend-bubble:hover { transform: scale(1.12); }
.bend-bubble-emoji { font-size: 1.6rem; }
@keyframes bubblePop {
	from { opacity: 0; transform: scale(0.5); }
	to   { opacity: 1; transform: scale(1); }
}

/* 3. Focus mode */
.bend-focus-frame { min-height: 280px; }
.bend-focus-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 1.5rem;
	padding: 1rem 0;
}
.bend-orb {
	position: relative;
	width: 100px;
	height: 100px;
}
.bend-orb-dot {
	position: absolute;
	top: 50%; left: 50%;
	width: var(--s, 5px);
	height: var(--s, 5px);
	border-radius: 50%;
	background: oklch(65% 0.2 var(--hue));
	transform:
		rotate(var(--angle))
		translateX(var(--r))
		translate(-50%, -50%);
	animation: orbPulse 3s ease-in-out infinite;
	animation-delay: calc(var(--hue) * 5ms);
}
@keyframes orbPulse {
	0%, 100% { opacity: 0.7; transform: rotate(var(--angle)) translateX(var(--r)) translate(-50%,-50%) scale(1); }
	50% { opacity: 1; transform: rotate(var(--angle)) translateX(calc(var(--r) * 1.08)) translate(-50%,-50%) scale(1.15); }
}
.bend-brand {
	font-size: 1.25rem;
	font-weight: 700;
	color: #fff;
	margin: 0;
	letter-spacing: -0.02em;
}
.bend-brand em { font-style: normal; font-weight: 300; color: #666; font-size: 0.8em; }
.bend-focus-input-wrap { width: 100%; }
.bend-focus-input {
	width: 100%;
	padding: 0.8rem 1rem;
	background: #1a1a1a;
	border: 1px solid #2a2a2a;
	border-radius: 12px;
	color: #fff;
	font: inherit;
	font-size: 0.95rem;
	outline: none;
	transition: border-color 0.15s;
}
.bend-focus-input::placeholder { color: #555; }
.bend-focus-input:focus { border-color: #3b82f6; }

/* 4. NL screen */
.bend-nl-screen { display: flex; flex-direction: column; gap: 12px; }
.bend-nl-header { display: flex; align-items: center; gap: 12px; padding-bottom: 4px; }
.bend-nl-title { font-size: 1rem; font-weight: 700; color: #fff; margin: 0; flex: 1; }
.bend-close-btn {
	width: 32px; height: 32px; border-radius: 50%;
	background: #1f1f1f; border: 1px solid #2a2a2a;
	color: #888; font-size: 0.9rem;
	display: grid; place-items: center; cursor: pointer;
}
.bend-prompt-card {
	background: #1a1a1a;
	border: 1px solid #2a2a2a;
	border-radius: 12px;
	padding: 0.9rem 1rem;
	color: #ccc;
	font-size: 0.9rem;
	line-height: 1.5;
}
.bend-filter-chips { display: flex; gap: 8px; flex-wrap: wrap; }
.bend-filter-chip {
	padding: 7px 14px;
	background: #1a1a1a;
	border: 1px solid #2a2a2a;
	border-radius: 8px;
	color: #ccc;
	font: inherit;
	font-size: 0.82rem;
	cursor: pointer;
	transition: border-color 0.15s, color 0.15s;
}
.bend-filter-chip:hover { border-color: #3b82f6; color: #fff; }
.bend-cta-area { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.bend-status-text {
	text-align: center;
	font-size: 0.8rem;
	color: #666;
	margin: 0;
}
.bend-cta-btn {
	width: 100%;
	padding: 0.9rem;
	border-radius: 999px;
	background: #3b82f6;
	color: #fff;
	border: none;
	font: inherit;
	font-size: 0.95rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.2s, opacity 0.2s;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
}
.bend-cta-btn:not(:disabled):hover { background: #2563eb; }
.bend-cta-loading { background: #2563eb; }
.bend-cta-spinner {
	width: 18px; height: 18px;
	border-radius: 50%;
	border: 2.5px solid rgba(255,255,255,0.3);
	border-top-color: #fff;
	animation: spin 0.7s linear infinite;
}
.bend-result {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 1rem;
	background: #1a1a1a;
	border-radius: 12px;
	border: 1px solid #2a2a2a;
}
.bend-result-label { font-size: 0.9rem; color: #fff; margin: 0; }

/* 5. Circle picker */
.bend-picker-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}
.bend-circle-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 16px;
	padding-bottom: 80px;
}
.bend-circle-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	background: transparent;
	border: none;
	cursor: pointer;
	position: relative;
}
.bend-circle-img {
	width: 80px; height: 80px;
	border-radius: 50%;
	background: var(--item-bg, #1a1a1a);
	border: 3px solid transparent;
	transition: border-color 0.2s, transform 0.15s;
	display: grid; place-items: center;
	font-size: 2.2rem;
}
.bend-circle-item.selected .bend-circle-img {
	border-color: #3b82f6;
	transform: scale(1.06);
}
.bend-circle-check {
	position: absolute;
	top: 0; right: calc(50% - 48px);
	width: 22px; height: 22px;
	border-radius: 50%;
	background: #3b82f6;
	color: white;
	font-size: 0.7rem;
	font-weight: 700;
	display: grid; place-items: center;
	border: 2px solid #0d0d0d;
}
.bend-circle-label {
	font-size: 0.75rem;
	color: #ccc;
	margin: 0;
	text-align: center;
	line-height: 1.3;
}
.bend-sticky-cta {
	position: sticky;
	bottom: 0;
	padding: 12px 0 16px;
	background: linear-gradient(to top, #0d0d0d 60%, transparent);
	margin: 0 -16px -20px;
	padding-left: 16px;
	padding-right: 16px;
}

/* ══════════════════════════════════════════════════════════════════════════════
   MODUS: OVERSIKT & ORGANISERING  (ChatGPT-inspirert)
   ══════════════════════════════════════════════════════════════════════════ */

/* Title row */
.cg-title-row {
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding-bottom: 1.25rem;
}
.cg-app-title {
	font-size: 1.3rem;
	font-weight: 700;
	color: #fff;
	letter-spacing: -0.02em;
}
.cg-title-actions { display: flex; gap: 10px; align-items: center; }
.cg-avatar {
	width: 30px; height: 30px; border-radius: 50%;
	background: #e55;
	color: white; font-size: 0.7rem; font-weight: 700;
	display: grid; place-items: center;
}
.cg-icon-btn {
	width: 32px; height: 32px; border-radius: 50%;
	background: transparent; border: none;
	color: #aaa; font-size: 1rem;
	display: grid; place-items: center; cursor: pointer;
}
.cg-icon-btn:hover { background: #1f1f1f; }

/* Quick actions */
.cg-quick-actions { display: flex; gap: 12px; margin-bottom: 1.25rem; }
.cg-quick-btn {
	flex: 1;
	display: flex; flex-direction: column; align-items: center; gap: 6px;
	background: #1a1a1a; border: 1px solid #2a2a2a;
	border-radius: 999px; padding: 14px 8px;
	cursor: pointer; transition: background 0.15s;
}
.cg-quick-btn:hover { background: #222; }
.cg-quick-icon { font-size: 1.4rem; }
.cg-quick-label { font-size: 0.72rem; color: #aaa; font-weight: 500; }

.cg-divider { height: 1px; background: #1f1f1f; margin: 0 0 1.25rem; }

/* Section labels */
.cg-section-label {
	font-size: 0.85rem;
	font-weight: 700;
	color: #fff;
	margin: 0 0 0.5rem;
}

/* List */
.cg-list { display: flex; flex-direction: column; margin-bottom: 0.5rem; }
.cg-list-item {
	display: flex; align-items: center; gap: 12px;
	padding: 10px 4px;
	background: transparent; border: none;
	cursor: pointer; border-radius: 8px;
	transition: background 0.1s;
	text-align: left;
}
.cg-list-item:hover { background: #1a1a1a; }
.cg-list-icon { font-size: 1.1rem; opacity: 0.85; }
.cg-list-name { font-size: 0.95rem; color: #eee; }
.cg-new-item .cg-list-name { color: #aaa; }
.cg-more-item .cg-list-name { color: #666; font-size: 0.85rem; }
.cg-recent-item { padding: 9px 4px; }
.cg-recent-title { font-size: 0.92rem; color: #ccc; margin: 0; }

/* Floating Chat FAB */
.cg-fab-row { display: flex; justify-content: flex-end; padding-top: 12px; }
.cg-chat-fab {
	padding: 10px 20px;
	background: #fff; color: #111;
	border: none; border-radius: 999px;
	font: inherit; font-size: 0.9rem; font-weight: 600;
	cursor: pointer; transition: opacity 0.15s;
	display: flex; align-items: center; gap: 6px;
}
.cg-chat-fab:hover { opacity: 0.85; }

/* Project view */
.cg-proj-header {
	display: flex; align-items: center; justify-content: space-between;
	padding: 12px 16px 4px;
	border-bottom: 1px solid #1f1f1f;
}
.cg-breadcrumb {
	flex: 1; text-align: center;
	background: transparent; border: none;
	color: #aaa; font: inherit; font-size: 0.85rem;
	cursor: pointer;
}
.cg-proj-title-block {
	display: flex; align-items: center; gap: 10px;
	padding: 16px 16px 12px;
}
.cg-proj-icon { font-size: 1.6rem; }
.cg-proj-title { font-size: 1.5rem; font-weight: 700; color: #fff; margin: 0; letter-spacing: -0.02em; }

/* Tab pill */
.cg-tab-pill {
	display: inline-flex;
	background: #1a1a1a;
	border-radius: 999px;
	padding: 3px;
	border: 1px solid #2a2a2a;
}
.cg-tab-pill-btn {
	padding: 5px 16px;
	border: none; border-radius: 999px;
	background: transparent; color: #666;
	font: inherit; font-size: 0.85rem; font-weight: 500;
	cursor: pointer; transition: all 0.15s;
}
.cg-tab-pill-btn.active {
	background: #2e2e2e;
	color: #fff;
	font-weight: 600;
}

/* Conversation list */
.cg-conv-list { display: flex; flex-direction: column; }
.cg-conv-item {
	display: flex; flex-direction: column; gap: 3px;
	padding: 13px 16px;
	background: transparent; border: none;
	border-top: 1px solid #1a1a1a;
	cursor: pointer; text-align: left;
	transition: background 0.1s;
}
.cg-conv-item:hover { background: #111; }
.cg-conv-title { font-size: 0.95rem; font-weight: 600; color: #eee; margin: 0; }
.cg-conv-preview { font-size: 0.82rem; color: #555; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Files empty */
.cg-files-empty {
	display: flex; flex-direction: column; align-items: center;
	padding: 2.5rem 1rem; gap: 6px;
}
.cg-files-icon { font-size: 2.5rem; margin: 0; }
.cg-files-label { font-size: 1rem; font-weight: 600; color: #fff; margin: 0; }
.cg-files-sub { font-size: 0.82rem; color: #555; margin: 0; text-align: center; line-height: 1.5; }

/* Sticky chat input */
.cg-sticky-input {
	display: flex; align-items: center; gap: 8px;
	padding: 10px 12px;
	background: #111;
	border-top: 1px solid #1f1f1f;
}
.cg-attach-btn {
	width: 32px; height: 32px; border-radius: 50%;
	background: #1f1f1f; border: 1px solid #2a2a2a;
	color: #aaa; font-size: 1.1rem;
	display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
}
.cg-sticky-field {
	flex: 1; padding: 7px 12px;
	background: transparent; border: none;
	color: #aaa; font: inherit; font-size: 0.85rem; outline: none;
}
.cg-sticky-field::placeholder { color: #444; }
.cg-voice-btn {
	width: 32px; height: 32px; border-radius: 50%;
	background: #2a2a2a; border: none;
	font-size: 0.9rem;
	display: grid; place-items: center; cursor: pointer; flex-shrink: 0;
}

/* Light-mode conversation list */
.cg-light-list {
	background: var(--bg-card);
	border: 1px solid var(--border-color);
	border-radius: 16px;
	overflow: hidden;
}
.cg-light-header {
	font-size: 0.75rem; font-weight: 700;
	text-transform: uppercase; letter-spacing: 0.06em;
	color: var(--text-tertiary);
	padding: 12px 16px 6px;
	margin: 0;
}
.cg-light-item {
	display: flex; align-items: center; gap: 12px;
	padding: 12px 16px;
	background: transparent; border: none;
	border-top: 1px solid var(--border-subtle);
	cursor: pointer; text-align: left; width: 100%;
	transition: background 0.1s;
}
.cg-light-item:first-of-type { border-top: none; }
.cg-light-item:hover { background: var(--bg-hover); }
.cg-light-dot {
	width: 6px; height: 6px; border-radius: 50%;
	background: var(--text-tertiary); flex-shrink: 0;
}
.cg-light-title { font-size: 0.9rem; font-weight: 500; color: var(--text-primary); margin: 0 0 2px; }
.cg-light-preview { font-size: 0.78rem; color: var(--text-tertiary); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px; }

/* ══════════════════════════════════════════════════════════════════════════════
   TEMPO – Kontinuitet & Utvikling
   ══════════════════════════════════════════════════════════════════════════════ */
.tempo-stat-grid-wrap { max-width: 375px; border-radius: 16px; }
.tempo-stat-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	grid-template-rows: repeat(2, 1fr);
	background: #ff6000;
}
.tempo-stat-cell {
	padding: 12px 10px;
	border-right: 1px solid rgba(0,0,0,0.18);
	border-bottom: 1px solid rgba(0,0,0,0.18);
}
.tempo-stat-label {
	font-size: 0.62rem; font-weight: 700; letter-spacing: 0.08em;
	color: rgba(255,255,255,0.7); margin: 0 0 3px;
}
.tempo-stat-value {
	font-size: 1.3rem; font-weight: 800; color: #fff; margin: 0; letter-spacing: -0.02em;
}
.tempo-dot-row { display: flex; justify-content: center; gap: 5px; padding: 8px; background: #ff6000; }
.tempo-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.35); }
.tempo-dot.active { background: #fff; }

.tempo-cal-header { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.tempo-cal-dow { text-align: center; font-size: 0.7rem; font-weight: 600; color: #555; padding: 4px 0; }
.tempo-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.tempo-cal-cell {
	position: relative; display: flex; flex-direction: column;
	align-items: center; justify-content: flex-start; padding: 4px 0 6px; min-height: 42px;
}
.tempo-cal-num { font-size: 0.75rem; color: #555; margin-top: 2px; }
.tempo-cal-active { color: #ff8c00; font-weight: 700; }
.tempo-cal-dot { width: 22px; height: 22px; border-radius: 50%; margin-bottom: 2px; }
.tempo-dot-high { background: #cc2200; }
.tempo-dot-mid  { background: #ff6000; }
.tempo-dot-low  { background: #ff9900; }

.tempo-chart-header { display: flex; flex-direction: column; align-items: center; gap: 4px; padding-bottom: 12px; }
.tempo-chart-icon { width: 44px; height: 44px; border-radius: 50%; background: #fff; display: grid; place-items: center; font-size: 1.3rem; }
.tempo-chart-sub { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.1em; color: #888; margin: 0; }
.tempo-chart-wrap { width: 100%; height: 140px; margin-bottom: 16px; }
.tempo-svg { width: 100%; height: 100%; display: block; }

.tempo-goal-details { background: #1a1a1a; border-radius: 12px; border: 1px solid #2a2a2a; overflow: hidden; }
.tempo-detail-row { display: flex; align-items: center; gap: 10px; padding: 11px 14px; border-bottom: 1px solid #222; }
.tempo-detail-row:last-child { border-bottom: none; }
.tempo-detail-icon { font-size: 1rem; }
.tempo-detail-label { flex: 1; font-size: 0.9rem; color: #ccc; }
.tempo-detail-val { font-size: 0.9rem; font-weight: 600; color: #fff; }

.tempo-ytd-link { text-align: center; color: #ff8c00; text-decoration: underline; font-size: 0.85rem; margin: 0 0 12px; cursor: pointer; }
.tempo-ytd-card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px; }
.tempo-ytd-title { text-align: center; font-size: 1rem; font-weight: 600; color: #fff; margin: 0 0 12px; }
.tempo-ytd-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-left: 100px; margin-bottom: 8px; }
.tempo-ytd-col { font-size: 0.72rem; font-weight: 700; line-height: 1.3; color: #ff8c00; }
.tempo-ytd-divider { height: 1px; background: #2a2a2a; margin: 6px 0; }
.tempo-ytd-row { display: grid; grid-template-columns: 100px 1fr 1fr; align-items: center; gap: 4px; }
.tempo-ytd-metric { display: flex; align-items: center; gap: 5px; }
.tempo-ytd-icon { font-size: 0.9rem; }
.tempo-ytd-mlabel { font-size: 0.62rem; font-weight: 700; letter-spacing: 0.06em; color: #555; }
.tempo-ytd-prev-val { font-size: 0.9rem; color: #888; }
.tempo-ytd-curr-val { font-size: 0.9rem; color: #ccc; display: flex; flex-direction: column; gap: 1px; }
.tempo-delta { font-size: 0.78rem; font-weight: 700; }
.tempo-delta.up   { color: #22c55e; }
.tempo-delta.down { color: #ef4444; }

.tempo-rings-row { display: flex; justify-content: space-around; gap: 12px; }
.tempo-ring-card { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.tempo-ring-label { font-size: 0.9rem; font-weight: 700; margin: 0; text-align: center; }
.tempo-ring-deadline { font-size: 0.72rem; color: #666; margin: 0; }

/* 7 – Spontan chat → stille minne */
.if-chat-scroll {
	display: flex; flex-direction: column; gap: 6px;
	padding: 12px 0; overflow-y: auto; flex: 1;
}
.if-cr { display: flex; flex-direction: column; gap: 2px; }
.if-cr-u { align-items: flex-end; }
.if-cr-a { align-items: flex-start; }
.if-bub {
	padding: 8px 12px; border-radius: 14px;
	font-size: 0.82rem; line-height: 1.45; max-width: 84%;
}
.if-bub-u { background: #2a3a56; color: #e0e8ff; }
.if-bub-a { background: #1a1a1a; border: 1px solid #2a2a2a; color: #ccc; }
.if-mem-pill {
	font-size: 0.65rem; color: #888;
	padding: 3px 10px; border: 1px solid #2a2a2a;
	border-radius: 999px; background: #111;
	align-self: flex-start; margin-top: 2px;
}
.if-chat-input-row {
	display: flex; align-items: center; gap: 8px;
	padding: 8px 0 0; border-top: 1px solid #2a2a2a; margin-top: 4px;
}
.if-chat-fake-input {
	flex: 1; padding: 9px 14px; border-radius: 999px;
	border: 1px solid #2a2a2a; background: #1a1a1a;
	font-size: 0.78rem; color: #444;
}

/* 8 – Engasjementsnivå */
.if-eng-rail {
	display: flex; gap: 8px; padding: 12px 0 4px;
	justify-content: space-between;
}
.if-eng-circ {
	flex: 1; aspect-ratio: 1;
	border-radius: 50%; border: 2px solid var(--ec, #555);
	background: #1a1a1a; color: #888;
	font: inherit; font-size: 0.62rem; font-weight: 600;
	cursor: pointer; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
	display: flex; align-items: center; justify-content: center;
	text-align: center; padding: 0;
}
.if-eng-circ.selected {
	background: color-mix(in srgb, var(--ec,#555) 18%, #1a1a1a);
	color: var(--ec, #fff);
	box-shadow: 0 0 0 4px color-mix(in srgb, var(--ec,#555) 25%, transparent);
}
.if-eng-desc {
	font-size: 0.72rem; color: #777; line-height: 1.4;
	padding: 4px 2px 10px; text-align: center;
}

/* 8 – Pakka-onboarding */
.if-pkg-steps {
	display: flex; align-items: center; gap: 0;
	margin: 8px 0 16px;
}
.if-pkg-step {
	display: flex; flex-direction: column; align-items: center; gap: 4px;
	flex-shrink: 0;
}
.if-pkg-dot {
	width: 24px; height: 24px; border-radius: 50%;
	border: 1.5px solid #3a3a3a; background: #1a1a1a;
	display: flex; align-items: center; justify-content: center;
	font-size: 0.65rem; color: #555; font-weight: 700;
}
.if-pkg-step.active .if-pkg-dot { border-color: #e0e0e0; color: #e0e0e0; }
.if-pkg-step.done .if-pkg-dot { border-color: #4caf76; color: #4caf76; background: rgba(76,175,118,0.1); }
.if-pkg-step span { font-size: 0.6rem; color: #555; }
.if-pkg-step.active span { color: #ccc; }
.if-pkg-line {
	flex: 1; height: 1px; background: #2a2a2a; margin-bottom: 18px;
}
.if-pkg-metric-grid {
	display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 8px;
}
.if-pkg-metric-chip {
	padding: 8px 14px; border-radius: 999px;
	border: 1px solid #2a2a2a; background: #1a1a1a;
	color: #888; font: inherit; font-size: 0.8rem; cursor: pointer;
	transition: all 0.15s;
}
.if-pkg-metric-chip.selected { border-color: #7c8ef5; color: #7c8ef5; background: rgba(124,142,245,0.1); }
.if-pkg-nudge-grid { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 8px; }
.if-pkg-footer {
	display: flex; align-items: center; padding-top: 12px;
	border-top: 1px solid #2a2a2a; margin-top: 4px;
}

/* 9 – Bot ber om input — variantgalleri */
.if-botask-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 20px;
	align-items: start;
}
@media (max-width: 700px) {
	.if-botask-grid { grid-template-columns: 1fr; }
}
.if-botask-label {
	font-size: 0.72rem; font-weight: 600; color: #666;
	text-transform: uppercase; letter-spacing: 0.06em;
	margin: 0 0 8px 2px;
}
.if-botask-frame {
	display: flex; flex-direction: column; min-height: 260px; padding: 12px !important;
}
.if-botask-slider-wrap {
	padding-top: 10px; border-top: 1px solid #2a2a2a; margin-top: 6px;
	display: flex; flex-direction: column; gap: 4px;
}
.if-botask-slider-emoji-row {
	display: flex; justify-content: space-between;
	font-size: 1.1rem; padding: 0 2px 4px;
}
.if-botask-range {
	-webkit-appearance: none; appearance: none;
	width: 100%; height: 4px; border-radius: 2px; cursor: pointer;
	background: linear-gradient(
		to right,
		#4caf76 0%,
		#667eea calc(var(--rv, 60) * 1%),
		#2a2a2a calc(var(--rv, 60) * 1%)
	);
	outline: none;
}
.if-botask-range::-webkit-slider-thumb {
	-webkit-appearance: none; width: 18px; height: 18px;
	border-radius: 50%; background: #fff;
	border: 2px solid #555; cursor: pointer;
}
.if-botask-mood-label {
	font-size: 0.85rem; color: #ccc; text-align: center;
	font-weight: 500; padding: 4px 0;
}
.if-botask-emoji-rail {
	display: flex; justify-content: space-between;
	padding-top: 10px; border-top: 1px solid #2a2a2a; margin-top: 6px;
}
.if-botask-emoji-btn {
	font-size: 1.5rem; background: none; border: 1px solid #2a2a2a;
	border-radius: 50%; width: 42px; height: 42px;
	display: flex; align-items: center; justify-content: center;
	cursor: pointer; transition: transform 0.12s, border-color 0.12s;
}
.if-botask-emoji-btn:hover { transform: scale(1.18); border-color: #555; }
.if-botask-dots-rail {
	display: flex; justify-content: space-between; gap: 6px;
	padding-top: 10px; border-top: 1px solid #2a2a2a; margin-top: 6px;
}
.if-botask-dot-btn {
	flex: 1; aspect-ratio: 1; border-radius: 50%;
	border: 2px solid var(--dc, #555); background: #1a1a1a;
	color: var(--dc, #999); font: inherit; font-size: 0.85rem; font-weight: 700;
	cursor: pointer; transition: background 0.12s, box-shadow 0.12s;
}
.if-botask-dot-btn:hover {
	background: color-mix(in srgb, var(--dc,#555) 15%, #1a1a1a);
	box-shadow: 0 0 0 3px color-mix(in srgb, var(--dc,#555) 20%, transparent);
}

/* 10 – Meldingstriage */
.if-triage-tabs {
	display: grid; grid-template-columns: repeat(2,1fr);
	gap: 8px; margin-bottom: 16px;
}
.if-triage-tab {
	background: #1a1a1a; border: 1.5px solid #2a2a2a; border-radius: 10px;
	padding: 10px 12px; cursor: pointer; text-align: left;
	transition: border-color 0.15s, background 0.15s;
	display: flex; flex-direction: column; gap: 4px;
}
.if-triage-tab.active {
	border-color: var(--tc, #555);
	background: color-mix(in srgb, var(--tc,#555) 10%, #1a1a1a);
}
.if-triage-tab-tag {
	font-size: 0.6rem; font-weight: 700; text-transform: uppercase;
	letter-spacing: 0.08em; color: var(--tc, #888);
}
.if-triage-tab-msg {
	font-size: 0.75rem; color: #bbb; line-height: 1.3;
}
.if-triage-phone {
	display: flex; flex-direction: column;
	min-height: 340px; padding: 12px !important;
}
.if-triage-prompt {
	font-size: 0.75rem; color: #777; text-align: center;
	padding: 8px 0 6px; border-top: 1px solid #2a2a2a; margin-top: 4px;
}
.if-triage-choices {
	display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
}
.if-triage-choices-3 { grid-template-columns: repeat(3, 1fr); }
.if-triage-choice {
	background: #1a1a1a; border: 1.5px solid #2a2a2a; border-radius: 10px;
	padding: 10px 8px; cursor: pointer; display: flex; flex-direction: column;
	align-items: center; gap: 4px; transition: border-color 0.15s, background 0.15s;
}
.if-triage-choice:hover { border-color: #444; background: #222; }
.if-triage-choice-full { grid-column: 1/-1; flex-direction: row; justify-content: center; }
.if-triage-choice-icon { font-size: 1.4rem; }
.if-triage-choice-lbl { font-size: 0.73rem; font-weight: 600; color: #ccc; text-align: center; }
.if-triage-choice-sub { font-size: 0.62rem; color: #555; text-align: center; }
.if-triage-ctx-cards {
	display: flex; flex-direction: column; gap: 6px;
	padding: 4px 0;
}
.if-triage-ctx-card {
	display: flex; align-items: center; gap: 10px;
	padding: 8px 10px; border-radius: 8px; border: 1px solid #2a2a2a;
	background: #1a1a1a; font-size: 0.72rem; color: #999; line-height: 1.3;
}
.if-triage-ctx-card strong { color: #ccc; font-size: 0.73rem; }
.if-triage-ctx-card span:first-child { font-size: 1rem; flex-shrink: 0; }
.if-ctx-match { border-color: rgba(76,175,118,0.35); background: rgba(76,175,118,0.06); }
.if-ctx-miss  { border-color: #2a2a2a; }
.if-triage-todo-card {
	display: flex; align-items: center; gap: 10px;
	padding: 10px 12px; border-radius: 8px;
	border: 1px solid #2a2a2a; background: #1a1a1a;
}
.if-triage-todo-check { font-size: 1.1rem; color: #555; flex-shrink: 0; }
.if-triage-todo-title { font-size: 0.8rem; color: #ddd; font-weight: 500; }
.if-triage-todo-sub { font-size: 0.65rem; color: #555; margin-top: 2px; }
.if-triage-chips {
	display: flex; flex-wrap: wrap; gap: 8px;
	padding-top: 10px; border-top: 1px solid #2a2a2a; margin-top: 4px;
}
.if-triage-chip {
	padding: 7px 14px; border-radius: 999px;
	border: 1px solid #2a2a2a; background: #1a1a1a;
	color: #aaa; font: inherit; font-size: 0.75rem; cursor: pointer;
	transition: border-color 0.15s, color 0.15s;
}
.if-triage-chip:hover { border-color: #555; color: #fff; }

/* Sykkel-scenario: expandable task list */
.if-triage-tasklist {
	background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 10px;
	overflow: hidden; width: 100%;
}
.if-triage-task-row { border-bottom: 1px solid #222; }
.if-triage-task-row:last-child { border-bottom: none; }
.if-triage-task-btn {
	display: flex; align-items: center; gap: 6px;
	width: 100%; padding: 9px 10px; background: none; border: none;
	cursor: pointer; text-align: left;
	transition: background 0.12s;
}
.if-triage-task-btn:hover { background: #222; }
.if-triage-task-num {
	color: #f0b429; font-size: 0.72rem; font-weight: 700; flex-shrink: 0; width: 16px;
}
.if-triage-task-title {
	flex: 1; font-size: 0.75rem; color: #ccc; font-weight: 500;
}
.if-triage-task-chevron {
	font-size: 0.65rem; color: #555; flex-shrink: 0;
}
.if-triage-subtasks {
	padding: 4px 10px 8px 28px; display: flex; flex-direction: column; gap: 5px;
	border-top: 1px solid #222;
}
.if-triage-subtask {
	display: flex; align-items: center; gap: 6px;
	font-size: 0.7rem; color: #888;
}
.if-triage-subtask-alpha {
	color: #555; font-size: 0.65rem; width: 14px; flex-shrink: 0;
}
.if-triage-subtask-lbl {
	color: #444; flex-shrink: 0;
}
/* Photo bubble */
.if-triage-photo-bub {
	display: flex; align-items: center; gap: 8px;
	background: #2a2a2a; border: 1px solid #3a3a3a; border-radius: 12px;
	padding: 8px 12px; max-width: 180px; margin-left: auto;
}
.if-triage-photo-thumb {
	width: 40px; height: 40px; background: #1a1a1a; border-radius: 6px;
	display: flex; align-items: center; justify-content: center;
	font-size: 1.2rem; flex-shrink: 0; border: 1px solid #3a3a3a;
}
.if-triage-photo-name {
	font-size: 0.68rem; color: #aaa;
}
/* YouTube card */
.if-triage-yt-card {
	display: flex; align-items: center; gap: 10px;
	background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
	padding: 8px 10px; margin-top: 8px; cursor: pointer;
	transition: border-color 0.15s;
}
.if-triage-yt-card:hover { border-color: #444; }
.if-triage-yt-thumb {
	width: 36px; height: 36px; background: #e02020; border-radius: 6px;
	display: flex; align-items: center; justify-content: center;
	color: #fff; font-size: 0.9rem; flex-shrink: 0;
}
.if-triage-yt-title {
	font-size: 0.72rem; color: #ddd; font-weight: 500; line-height: 1.3;
}
.if-triage-yt-meta {
	font-size: 0.62rem; color: #555; margin-top: 3px;
}

/* ══════════════════════════════════════════════════════════════════════════════
   WIDGETS — GALLERI
   ══════════════════════════════════════════════════════════════════════════════ */
.wg-gallery {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 24px;
	margin-bottom: 2.5rem;
}
@media (max-width: 700px) { .wg-gallery { grid-template-columns: repeat(2, 1fr); } }

.wg-label {
	font-size: 0.65rem; font-weight: 700; color: #555;
	text-transform: uppercase; letter-spacing: 0.08em; margin: 0 0 8px 2px;
}
.wg-frame {
	display: flex; flex-direction: column; align-items: center;
	background: #111; border: 1px solid #222; border-radius: 16px;
	padding: 20px 12px 16px; gap: 10px;
}
.wg-big { font-size: 1.1rem; font-weight: 700; color: var(--wc, #ccc); line-height: 1; }
.wg-unit { font-size: 0.6rem; color: #555; text-transform: lowercase; }
.wg-name { font-size: 0.6rem; color: #444; text-transform: uppercase; letter-spacing: 0.07em; }

/* Tall-sirkel */
.wg-val-circ {
	width: 80px; height: 80px; border-radius: 50%;
	border: 2.5px solid var(--wc, #888);
	background: radial-gradient(ellipse at 40% 35%, color-mix(in srgb, var(--wc,#888) 10%, #1a1a1a), #111);
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	box-shadow: 0 0 18px color-mix(in srgb, var(--wc,#888) 15%, transparent);
	position: relative;
}
.wg-val-inner {
	display: flex; flex-direction: column; align-items: center; gap: 1px;
}

/* Mål-ring */
.wg-ring-wrap {
	position: relative; width: 80px; height: 80px;
	display: flex; align-items: center; justify-content: center;
}
.wg-ring-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.wg-ring-center {
	display: flex; flex-direction: column; align-items: center;
	gap: 1px; z-index: 1;
}
.wg-ring-legend {
	display: flex; align-items: center; font-size: 0.58rem; color: #555;
}
.wg-leg-dot {
	width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 3px;
}

/* Delta-tal i ring-senter (vises i stedet for wg-big) */
.wg-delta {
	font-size: 1rem; font-weight: 800; line-height: 1; letter-spacing: -0.02em;
}

/* Periode-piller */
.wg-period-pills {
	display: flex; gap: 4px;
}
.wg-period-btn {
	padding: 3px 8px; border-radius: 999px;
	border: 1px solid #2a2a2a; background: #111;
	color: #444; font: inherit; font-size: 0.58rem; font-weight: 600;
	text-transform: lowercase; cursor: pointer;
	transition: border-color 0.12s, color 0.12s, background 0.12s;
	white-space: nowrap;
}
.wg-period-btn.active {
	border-color: #555; color: #ccc; background: #1a1a1a;
}
.wg-period-btn:hover { border-color: #444; color: #aaa; }

/* Dobbel-sparkline · Relasjon */
.wg-rel-circ {
	width: 80px; height: 80px; border-radius: 50%;
	overflow: hidden; background: #0f0f0f;
	border: 1.5px solid #2a2a2a; flex-shrink: 0;
}
.wg-rel-vals {
	display: flex; gap: 10px;
	font-size: 0.7rem; font-weight: 700;
}

/* Dobbel ring center */
.wg-ring-center .wg-big { font-size: 0.85rem; }

/* Streak */
.wg-streak-circ {
	width: 80px; height: 80px; border-radius: 50%;
	border: 2.5px solid var(--wc, #f0b429);
	background: radial-gradient(ellipse at 40% 30%, color-mix(in srgb, var(--wc,#f0b429) 12%, #1a1a1a), #111);
	box-shadow: 0 0 18px color-mix(in srgb, var(--wc,#f0b429) 15%, transparent);
	display: flex; flex-direction: column; align-items: center; justify-content: center;
	gap: 0;
}
.wg-streak-flame { font-size: 0.9rem; line-height: 1; }
.wg-streak-dots {
	display: flex; gap: 4px; align-items: center;
}
.wg-streak-dot {
	width: 7px; height: 7px; border-radius: 50%;
	background: #2a2a2a; border: 1px solid #333; transition: background 0.15s;
}
.wg-streak-dot.wg-done  { background: #f0b429; border-color: #f0b429; }
.wg-streak-dot.wg-today {
	background: none; border: 1.5px solid #f0b429;
	box-shadow: 0 0 5px rgba(240,180,41,0.5);
}

/* Todo-widget */
.wg-todo-card {
	width: 100%; background: #1a1a1a; border: 1.5px solid var(--wc, #f0b429);
	border-radius: 12px; overflow: hidden;
}
.wg-todo-header {
	display: flex; justify-content: space-between; align-items: center;
	padding: 10px 12px 4px;
}
.wg-todo-title { font-size: 0.75rem; font-weight: 600; color: #ddd; }
.wg-todo-count { font-size: 0.65rem; color: var(--wc, #f0b429); font-weight: 700; }
.wg-todo-bar {
	height: 2px; background: #2a2a2a; margin: 4px 12px 0;
}
.wg-todo-fill {
	height: 100%; background: var(--wc, #f0b429); border-radius: 1px;
	transition: width 0.4s;
}
.wg-todo-rows {
	padding: 8px 10px 10px; display: flex; flex-direction: column; gap: 5px;
}
.wg-todo-row {
	display: flex; align-items: center; gap: 7px;
}
.wg-todo-check {
	width: 13px; height: 13px; border-radius: 3px; flex-shrink: 0;
}
.wg-check-done {
	background: var(--wc, #f0b429);
	border: 1px solid var(--wc, #f0b429);
	background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Cpolyline points='2,5 4,7 8,3' fill='none' stroke='%23000' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
}
.wg-check-open { border: 1.5px solid #333; background: #111; }
.wg-todo-item { font-size: 0.68rem; color: #aaa; }
.wg-done-lbl { color: #444; text-decoration: line-through; }

/* Sparkline-widget */
.wg-spark-circ {
	width: 100%;
	display: flex; flex-direction: column; align-items: center; gap: 4px;
	background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--wc,#888) 8%, #111), #111);
	border: 1.5px solid color-mix(in srgb, var(--wc,#888) 30%, #222);
	border-radius: 14px; padding: 12px 10px 10px;
}
.wg-spark-svg {
	width: 100%; height: 32px;
}

/* Streak-header */
.wg-streak-header {
	display: flex; align-items: center; gap: 0;
	background: #111; border: 1px solid #222; border-radius: 14px;
	padding: 14px 18px;
}
.wg-sh-left {
	display: flex; flex-direction: column; gap: 2px; min-width: 100px;
}
.wg-sh-date { font-size: 0.82rem; font-weight: 600; color: #ddd; }
.wg-sh-sub  { font-size: 0.62rem; color: #444; }
.wg-sh-mid {
	display: flex; gap: 10px; flex: 1; justify-content: center; align-items: center;
}
.wg-sh-day {
	display: flex; flex-direction: column; align-items: center; gap: 5px;
}
.wg-sh-daylbl { font-size: 0.58rem; color: #444; font-weight: 600; text-transform: uppercase; }
.wg-sh-dot {
	width: 8px; height: 8px; border-radius: 50%;
	background: #222; border: 1px solid #333;
}
.wg-sh-dot.wg-sh-done  { background: #f0b429; border-color: #f0b429; }
.wg-sh-dot.wg-sh-today {
	background: none; border: 1.5px solid #f0b429;
	box-shadow: 0 0 6px rgba(240,180,41,0.5);
}
.wg-sh-right {
	display: flex; align-items: center; gap: 4px; min-width: 48px; justify-content: flex-end;
}
.wg-sh-streak {
	font-size: 1.3rem; font-weight: 800; color: #f0b429; line-height: 1;
}

/* ══════════════════════════════════════════════════════════════════════════════
   STOIC – Refleksjon & Sinnstemning
   ══════════════════════════════════════════════════════════════════════════════ */
.stoic-focus-frame  { min-height: 360px; display: flex; flex-direction: column; justify-content: space-between; }
.stoic-picker-frame { min-height: 420px; display: flex; flex-direction: column; }
.stoic-journal-frame { min-height: 380px; display: flex; flex-direction: column; }

.stoic-home-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.stoic-streak-pill { padding: 6px 14px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 999px; font-size: 0.85rem; color: #aaa; }
.stoic-greeting { font-size: 1.1rem; font-weight: 400; color: #fff; margin: 0; }
.stoic-avatar { width: 32px; height: 32px; border-radius: 50%; background: #2a2a2a; display: grid; place-items: center; font-size: 0.9rem; }

.stoic-week-strip { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; margin-bottom: 16px; }
.stoic-day-cell { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 0; border-radius: 8px; }
.stoic-day-cell.today { background: #2a2a2a; outline: 1px solid #3a3a3a; }
.stoic-dow { font-size: 0.6rem; color: #666; font-weight: 600; }
.stoic-day-num { font-size: 0.85rem; color: #ccc; font-weight: 600; }
.stoic-day-cell.today .stoic-day-num { color: #fff; }

.stoic-cards-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
.stoic-ctx-card {
	padding: 16px 14px; border-radius: 16px; display: flex; flex-direction: column;
	gap: 8px; min-height: 120px; justify-content: space-between;
}
.stoic-ctx-dim    { background: #1a1a1a; border: 1px solid #2a2a2a; }
.stoic-ctx-active { background: #2a2a2a; border: 1px solid #3a3a3a; }
.stoic-ctx-type { font-size: 0.72rem; color: #555; margin: 0; }
.stoic-ctx-q { font-size: 0.92rem; font-weight: 600; color: #ccc; margin: 0; line-height: 1.3; }
.stoic-begin-btn { padding: 7px 14px; border-radius: 999px; font: inherit; font-size: 0.82rem; font-weight: 600; cursor: pointer; border: none; align-self: flex-start; }
.stoic-begin-dim   { background: #1a1a1a; color: #555; }
.stoic-begin-light { background: #e0e0e0; color: #111; }
.stoic-social-proof { text-align: center; font-size: 0.72rem; color: #555; margin: 4px 0 16px; }
.stoic-practices-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.stoic-practices-title { font-size: 0.9rem; font-weight: 700; color: #fff; margin: 0; }
.stoic-practices-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }
.stoic-practice-card {
	flex-shrink: 0; padding: 14px 10px; background: #1a1a1a; border: 1px solid #2a2a2a;
	border-radius: 14px; width: 110px; font-size: 0.75rem; color: #aaa; text-align: center; line-height: 1.4;
}

.stoic-question-block { padding-top: 2rem; }
.stoic-big-q { font-size: 1.35rem; font-weight: 700; color: #fff; line-height: 1.3; margin: 0 0 0.5rem; }
.stoic-slider-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.stoic-feeling-label { font-size: 1rem; color: #888; margin: 0; }
.stoic-feeling-word  { font-size: 1.6rem; font-weight: 700; color: #fff; margin: 0; min-height: 2rem; }
.stoic-slider {
	width: 100%; -webkit-appearance: none; appearance: none;
	height: 52px; border-radius: 999px;
	background: #2a2a2a; outline: none; border: none; cursor: pointer;
}
.stoic-slider::-webkit-slider-thumb {
	-webkit-appearance: none; width: 52px; height: 52px;
	border-radius: 50%; background: #e0e0e0; cursor: grab;
	box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.stoic-slider-labels { display: flex; justify-content: space-between; width: 100%; font-size: 0.75rem; color: #555; }
.stoic-bottom-bar { display: flex; align-items: center; justify-content: space-between; padding-top: 8px; }
.stoic-skip { background: transparent; border: none; color: #555; font: inherit; font-size: 0.85rem; cursor: pointer; }

.stoic-emotion-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 1.25rem 0 0.75rem; }
.stoic-emotion-btn {
	padding: 14px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
	color: #ccc; font: inherit; font-size: 0.9rem; font-weight: 500; cursor: pointer;
	transition: all 0.15s; text-align: center;
}
.stoic-emotion-btn.selected { background: #222; border-color: #888; color: #fff; box-shadow: inset 0 0 0 1px #888; }
.stoic-show-more {
	width: 100%; padding: 10px; background: #111; border: 1px solid #2a2a2a;
	border-radius: 999px; color: #888; font: inherit; font-size: 0.82rem; cursor: pointer;
}
.stoic-personalize { background: transparent; border: none; color: #555; font: inherit; font-size: 0.8rem; cursor: pointer; }

.stoic-ctx-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 1.25rem 0 0.75rem; }
.stoic-ctx-tile {
	display: flex; flex-direction: column; align-items: center; gap: 10px;
	padding: 16px 8px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; cursor: pointer; transition: all 0.15s;
}
.stoic-ctx-tile.selected { background: #222; border-color: #888; box-shadow: inset 0 0 0 1px #888; }
.stoic-ctx-icon { font-size: 1.5rem; }
.stoic-ctx-tlabel { font-size: 0.72rem; color: #aaa; text-align: center; }
.stoic-ctx-tile.selected .stoic-ctx-tlabel { color: #fff; }

.stoic-journal-topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
.stoic-ai-pill { padding: 6px 14px; background: #1f1f1f; border: 1px solid #2a2a2a; border-radius: 999px; font-size: 0.8rem; color: #aaa; }
.stoic-journal-q { font-size: 1.25rem; font-weight: 700; color: #fff; line-height: 1.35; margin: 0 0 0.75rem; }
.stoic-journal-sub { border-left: 2px solid #2a2a2a; padding-left: 12px; margin: 0 0 1rem; color: #555; font-size: 0.85rem; line-height: 1.6; }
.stoic-journal-area {
	flex: 1; width: 100%; background: transparent; border: none;
	color: #ccc; font: inherit; font-size: 0.95rem; line-height: 1.6; resize: none; outline: none; caret-color: #aaa;
}
.stoic-journal-area::placeholder { color: #444; }
.stoic-journal-bar {
	display: flex; align-items: center; gap: 8px;
	padding-top: 12px; border-top: 1px solid #1f1f1f; margin-top: auto;
}
.stoic-bar-btn { padding: 8px 14px; background: #1f1f1f; border: 1px solid #2a2a2a; border-radius: 999px; color: #aaa; font: inherit; font-size: 0.82rem; cursor: pointer; }
.stoic-deeper-btn {
	padding: 8px 18px; background: #1f1f1f; border: 1px solid #2a2a2a; border-radius: 999px;
	color: #ccc; font: inherit; font-size: 0.85rem; font-weight: 500; cursor: pointer; margin-left: auto; transition: border-color 0.15s;
}
.stoic-deeper-btn:hover { border-color: #555; }
.stoic-next-fab {
	width: 40px; height: 40px; border-radius: 50%; background: #e0e0e0; border: none;
	font-size: 1.1rem; color: #111; display: grid; place-items: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}

/* ══════════════════════════════════════════════════════════════════════════════
   WITHINGS HEALTH MATE – Vitalitet & Helse
   ══════════════════════════════════════════════════════════════════════════════ */

/* Score pill row */
.hm-score-row {
	display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px;
}
.hm-score-pill {
	flex-shrink: 0; display: flex; align-items: center; gap: 10px;
	padding: 10px 16px; background: #1e1e1e; border: 1px solid #2a2a2a; border-radius: 14px;
	cursor: pointer; transition: border-color 0.15s; min-width: 110px;
}
.hm-score-pill.hm-score-active { border-color: var(--hm-c, #c9a227); }
.hm-score-icon {
	width: 36px; height: 36px; border-radius: 50%;
	display: grid; place-items: center; font-size: 0.9rem; flex-shrink: 0;
}
.hm-score-pts { display: flex; align-items: baseline; gap: 2px; }
.hm-score-num { font-size: 1.4rem; font-weight: 700; color: #fff; line-height: 1; }
.hm-score-lbl { font-size: 0.7rem; font-weight: 600; color: #888; }

/* Score detail card */
.hm-score-card {
	background: #1c1c1c; border-radius: 16px; border: 1px solid #2a2a2a; padding: 18px 16px 0;
}
.hm-score-card-header {
	display: flex; gap: 12px; align-items: flex-start; margin-bottom: 14px;
}
.hm-score-card-eyebrow { font-size: 1rem; font-weight: 700; color: #fff; margin: 0 0 4px; }
.hm-score-card-sub { font-size: 0.75rem; color: #666; margin: 0; line-height: 1.5; }
.hm-chart-btn {
	flex-shrink: 0; width: 32px; height: 32px; background: #2a2a2a; border: none;
	border-radius: 8px; color: #888; font-size: 0.7rem; cursor: pointer; display: grid; place-items: center;
}
.hm-score-cols {
	display: grid; grid-template-columns: 1fr 1.2fr 1fr;
	border-top: 1px solid #2a2a2a;
}
.hm-score-col {
	padding: 12px 10px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
}
.hm-col-curr { background: rgba(255,255,255,0.04); border-left: 1px solid #2a2a2a; border-right: 1px solid #2a2a2a; }
.hm-col-label { font-size: 0.7rem; color: #666; margin: 0; }
.hm-col-value { font-size: 1.8rem; font-weight: 300; color: #fff; margin: 0; line-height: 1; }
.hm-col-badge {
	display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 600;
}
.hm-badge-stable { background: #2a2a2a; color: #aaa; }
.hm-badge-up     { background: #143314; color: #22c55e; }
.hm-pred-star {
	width: 36px; height: 36px; font-size: 1.3rem; color: #ffdc80;
	display: grid; place-items: center; align-self: center;
}
.hm-timeline-svg { width: 100%; display: block; margin-top: 4px; }

/* Metric cards */
.hm-metric-card {
	background: #1c1c1c; border-radius: 16px; border: 1px solid #2a2a2a; padding: 14px 16px;
}
.hm-metric-header {
	display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;
}
.hm-metric-title-row { display: flex; align-items: center; gap: 6px; }
.hm-metric-icon { font-size: 0.9rem; }
.hm-metric-label { font-size: 0.85rem; font-weight: 500; color: #aaa; }
.hm-metric-date { font-size: 0.72rem; color: #555; }
.hm-metric-body { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; }
.hm-metric-value {
	font-size: 1.75rem; font-weight: 300; color: #fff; margin: 0 0 4px; line-height: 1;
}
.hm-metric-unit { font-size: 1rem; font-weight: 400; color: #888; }
.hm-metric-tag { display: flex; align-items: center; gap: 4px; font-size: 0.78rem; font-weight: 500; }
.hm-tag-check { font-size: 0.72rem; }
.hm-spark-svg { width: 120px; height: 40px; flex-shrink: 0; }

/* Bar → Dot animation */
.hm-anim-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.hm-anim-title { font-size: 0.95rem; font-weight: 600; color: #fff; margin: 0; }
.hm-anim-toggle {
	padding: 6px 14px; background: #1e1e1e; border: 1px solid #333; border-radius: 999px;
	font: inherit; font-size: 0.75rem; color: #aaa; cursor: pointer; transition: border-color 0.15s;
}
.hm-anim-toggle:hover { border-color: #c9a227; color: #c9a227; }
.hm-anim-svg { width: 100%; height: 100px; display: block; overflow: visible; }
.hm-anim-svg rect, .hm-anim-svg circle { transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1); }
.hm-collapse { transform: scaleY(0.01); }
.hm-anim-labels {
	display: flex; justify-content: space-around;
	padding: 6px 20px 0;
}
.hm-anim-label { font-size: 0.7rem; color: #555; text-align: center; width: 40px; }

/* ══════════════════════════════════════════════════════════════════════════════
   INTERAKSJONSFLYTER
   ══════════════════════════════════════════════════════════════════════════════ */
.ds-caption {
	font-size: 0.82rem;
	color: var(--text-secondary);
	margin: -4px 0 14px;
	line-height: 1.5;
}
.if-section-label {
	font-size: 0.7rem; font-weight: 700; letter-spacing: 0.08em;
	color: #666; text-transform: uppercase; margin: 0 0 10px;
}

/* 1 – Auto-insight cards */
.if-insight-card {
	display: flex; align-items: flex-start; gap: 12px;
	padding: 14px 0;
	border-bottom: 1px solid #1f1f1f;
}
.if-insight-card:last-of-type { border-bottom: none; }
.if-insight-icon {
	width: 36px; height: 36px; flex-shrink: 0;
	background: #1a1a1a; border-radius: 50%;
	display: grid; place-items: center; font-size: 1rem; font-weight: 700;
}
.if-insight-body { flex: 1; }
.if-insight-label { font-size: 0.9rem; font-weight: 600; color: #e0e0e0; margin: 0 0 3px; }
.if-insight-sub   { font-size: 0.75rem; color: #666; margin: 0; line-height: 1.4; }
.if-insight-cta   { flex-shrink: 0; background: transparent; border: none; font: inherit; font-size: 0.78rem; font-weight: 600; cursor: pointer; white-space: nowrap; padding: 0; }

.if-chat-prompt-btn {
	width: 100%; padding: 12px 16px;
	background: #1a1a1a; border: 1px dashed #2a2a2a; border-radius: 999px;
	display: flex; align-items: center; gap: 8px; justify-content: center;
	color: #888; font: inherit; font-size: 0.85rem; cursor: pointer;
	margin-top: 10px; transition: border-color 0.15s, color 0.15s;
}
.if-chat-prompt-btn:hover { border-color: #555; color: #ccc; }
.if-chat-sparkle { color: #9070c0; font-size: 0.9rem; }

/* 2 – System-1 sliders */
.if-track-q { font-size: 1rem; font-weight: 600; color: #fff; margin: 0 0 10px; }
.if-mood-pills { display: flex; gap: 8px; margin-bottom: 18px; }
.if-mood-pill {
	flex: 1; padding: 10px 0; font-size: 1.4rem;
	background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
	cursor: pointer; transition: all 0.15s;
}
.if-mood-pill.selected { background: #2a2a2a; border-color: #888; transform: scale(1.12); }
.if-slider-row {
	display: grid; grid-template-columns: 56px 1fr 72px;
	align-items: center; gap: 10px; margin-bottom: 12px;
}
.if-slider-label { font-size: 0.78rem; color: #888; font-weight: 600; }
.if-slim-slider {
	-webkit-appearance: none; appearance: none;
	height: 28px; border-radius: 999px;
	background: #1e1e1e; outline: none; border: 1px solid #2a2a2a; cursor: pointer;
}
.if-slim-slider::-webkit-slider-thumb {
	-webkit-appearance: none; width: 28px; height: 28px;
	border-radius: 50%; background: var(--if-accent, #888);
	cursor: grab; box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.if-slider-word { font-size: 0.8rem; font-weight: 600; text-align: right; }
.if-log-btn {
	width: 100%; padding: 13px;
	background: #e0e0e0; border: none; border-radius: 999px;
	color: #111; font: inherit; font-size: 0.9rem; font-weight: 700;
	cursor: pointer; transition: background 0.15s;
}
.if-log-btn:hover { background: #fff; }

/* 3 – Strength form */
.if-form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.if-form-title  { font-size: 0.95rem; font-weight: 700; color: #fff; margin: 0; }
.if-form-add {
	padding: 6px 14px; background: #1f1f1f; border: 1px solid #2a2a2a;
	border-radius: 999px; color: #aaa; font: inherit; font-size: 0.8rem; cursor: pointer;
}
.if-form-cols-header {
	display: grid; grid-template-columns: 1fr 44px 44px 52px;
	gap: 6px; margin-bottom: 4px;
}
.if-col-ex  { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em; color: #555; text-transform: uppercase; }
.if-col-num { font-size: 0.65rem; font-weight: 700; letter-spacing: 0.06em; color: #555; text-align: center; text-transform: uppercase; }
.if-form-row {
	display: grid; grid-template-columns: 1fr 44px 44px 52px;
	gap: 6px; margin-bottom: 6px; align-items: center;
}
.if-input-ex {
	padding: 9px 10px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
	color: #ccc; font: inherit; font-size: 0.88rem; outline: none; width: 100%;
}
.if-input-ex:focus { border-color: #444; }
.if-input-num {
	padding: 9px 4px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px;
	color: #ccc; font: inherit; font-size: 0.88rem; text-align: center; outline: none; width: 100%;
}
.if-input-num:focus { border-color: #444; }
.if-form-footer { margin-top: 6px; }
.if-skip-btn {
	background: transparent; border: none; color: #555;
	font: inherit; font-size: 0.82rem; cursor: pointer; margin-left: 12px;
}

/* 4 – Image upload */
.if-upload-zone {
	width: 100%; padding: 32px 16px;
	background: #1a1a1a; border: 2px dashed #2a2a2a; border-radius: 16px;
	display: flex; flex-direction: column; align-items: center; gap: 8px;
	cursor: pointer; transition: border-color 0.15s;
}
.if-upload-zone:hover { border-color: #555; }
.if-upload-icon  { font-size: 2rem; }
.if-upload-label { font-size: 0.9rem; font-weight: 600; color: #ccc; margin: 0; }
.if-upload-sub   { font-size: 0.72rem; color: #555; margin: 0; text-align: center; }
.if-image-preview { margin-bottom: 12px; }
.if-image-mock {
	background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px;
	padding: 20px; text-align: center;
}
.if-ai-processing {
	display: flex; align-items: flex-start; gap: 10px;
	background: #111; border: 1px solid #2a2a2a; border-radius: 12px;
	padding: 12px 14px; margin-bottom: 12px;
}
.if-ai-caption { font-size: 0.85rem; color: #ccc; line-height: 1.5; margin: 0; }
.if-image-actions { display: flex; align-items: center; gap: 8px; }

/* 5 – Free write */
.if-freewrite-wrap {
	display: flex; flex-direction: column;
}
.if-freewrite-area {
	border: 1px solid #2a2a2a; border-radius: 12px;
	padding: 12px; background: #111 !important;
}
.if-analysis-card {
	background: #111; border: 1px solid #2a2a2a; border-radius: 12px;
	padding: 14px; margin-top: 12px;
}
.if-analysis-heading { font-size: 0.78rem; font-weight: 700; color: #9070c0; margin: 0 0 10px; letter-spacing: 0.04em; }
.if-analysis-row {
	display: flex; justify-content: space-between; gap: 12px;
	padding: 8px 0; border-bottom: 1px solid #1f1f1f; font-size: 0.85rem;
}
.if-analysis-row:last-of-type { border-bottom: none; }
.if-analysis-label { color: #666; flex-shrink: 0; }
.if-analysis-value { color: #ddd; text-align: right; }

/* 6 – Project folder */
.if-proj-header {
	display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
}
.if-proj-icon {
	width: 44px; height: 44px; background: #2a2a2a; border-radius: 12px;
	display: grid; place-items: center; font-size: 1.3rem; flex-shrink: 0;
}
.if-proj-name { font-size: 0.95rem; font-weight: 700; color: #fff; margin: 0 0 2px; }
.if-proj-sub  { font-size: 0.72rem; color: #666; margin: 0; }
.if-proj-edit {
	margin-left: auto; background: transparent; border: none;
	color: #666; font-size: 1.1rem; cursor: pointer; padding: 6px;
}
.if-file-list { margin-bottom: 14px; }
.if-file-row {
	display: flex; align-items: center; gap: 10px;
	padding: 10px 0; border-bottom: 1px solid #1f1f1f;
}
.if-file-row:last-of-type { border-bottom: none; }
.if-file-icon { font-size: 1.2rem; flex-shrink: 0; }
.if-file-meta { flex: 1; }
.if-file-name { font-size: 0.85rem; color: #ccc; margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px; }
.if-file-size { font-size: 0.7rem; color: #555; margin: 0; }
.if-file-more { background: transparent; border: none; color: #555; font-size: 1rem; cursor: pointer; padding: 4px 6px; }
.if-file-add {
	width: 100%; padding: 9px;
	background: transparent; border: 1px dashed #2a2a2a; border-radius: 8px;
	color: #555; font: inherit; font-size: 0.82rem; cursor: pointer;
	margin-top: 6px; transition: border-color 0.15s; text-align: center;
}
.if-file-add:hover { border-color: #444; color: #aaa; }
.if-proj-chat {
	display: flex; align-items: center; gap: 8px;
	padding-top: 12px; border-top: 1px solid #1f1f1f;
}
.if-proj-input {
	flex: 1; padding: 12px 14px;
	background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 999px;
	color: #ccc; font: inherit; font-size: 0.88rem; outline: none;
}
.if-proj-input:focus { border-color: #444; }

/* ══════════════════════════════════════════════════════════════════════════════
   NINTHLIFE
   ══════════════════════════════════════════════════════════════════════════════ */
.nl-outer-frame {
	background: #f5ebe0;
	border-radius: 20px;
	padding: 20px 16px;
	max-width: 400px;
	margin-bottom: 16px;
}

/* Metric selector tabs */
.nl-metric-tabs {
	display: flex;
	gap: 0;
	margin-bottom: 20px;
	border-bottom: 1px solid #ddd0c4;
	overflow-x: auto;
}
.nl-metric-tab {
	padding: 6px 10px;
	background: transparent;
	border: none;
	font: inherit;
	font-size: 0.82rem;
	color: #8a9ab0;
	cursor: pointer;
	border-bottom: 2px solid transparent;
	margin-bottom: -1px;
	white-space: nowrap;
	transition: color 0.15s, border-color 0.15s;
}
.nl-metric-tab.active {
	color: #2a3a56;
	font-weight: 700;
	border-bottom-color: #2a3a56;
}

/* Circle grid */
.nl-circles-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 14px;
}
.nl-circle {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 3px;
	width: 88px;
	height: 88px;
	border-radius: 50%;
	border: 2.5px solid var(--nl-c, #9090a0);
	background: #f9f1ea;
	cursor: pointer;
	transition: background 0.15s, box-shadow 0.15s;
	justify-self: center;
}
.nl-circle:hover { background: #fff; }
.nl-circle.nl-circle-active {
	background: var(--nl-c, #9090a0);
	box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}
.nl-circle.nl-circle-active .nl-circle-period,
.nl-circle.nl-circle-active .nl-circle-val { color: #fff; }
.nl-circle-period {
	font-size: 0.62rem;
	font-weight: 600;
	letter-spacing: 0.06em;
	color: #8a7a6e;
	text-transform: uppercase;
}
.nl-circle-val {
	font-size: 1.1rem;
	font-weight: 700;
	color: #2a3a56;
	line-height: 1;
}

/* Chart */
.nl-chart-title {
	font-size: 1.1rem;
	font-weight: 700;
	color: #2a3a56;
	text-align: center;
	margin: 0 0 12px;
}
.nl-chart-wrap {
	background: #fdf6ee;
	border-radius: 12px;
	border: 1px solid #e8d8c8;
	padding: 10px 8px 4px;
	overflow: hidden;
}
.nl-chart-svg { width: 100%; height: 180px; display: block; }

/* Period tabs */
.nl-period-tabs {
	display: flex;
	gap: 0;
	margin-bottom: 14px;
}
.nl-period-tab {
	padding: 6px 14px;
	background: transparent;
	border: none;
	font: inherit;
	font-size: 0.85rem;
	color: #8a9ab0;
	cursor: pointer;
	transition: color 0.15s;
}
.nl-period-tab.active { color: #2a3a56; font-weight: 700; }

/* Table */
.nl-table { width: 100%; overflow-x: auto; }
.nl-table-head {
	display: grid;
	grid-template-columns: 52px repeat(6, 1fr);
	margin-bottom: 6px;
}
.nl-th-cell {
	text-align: center;
	font-size: 1rem;
}
.nl-table-row {
	display: grid;
	grid-template-columns: 52px repeat(6, 1fr);
	align-items: center;
	margin-bottom: 8px;
}
.nl-row-label {
	font-size: 0.82rem;
	font-weight: 600;
	color: #5a6a7e;
	padding-right: 4px;
}
.nl-cell-circle {
	width: 44px;
	height: 44px;
	border-radius: 50%;
	border: 2px solid transparent;
	background: #f9f1ea;
	display: grid;
	place-items: center;
	justify-self: center;
	transition: background 0.12s;
}
.nl-cell-circle:hover { background: #fff; }
.nl-cell-val {
	font-size: 0.72rem;
	font-weight: 600;
	text-align: center;
	line-height: 1.1;
	max-width: 40px;
	word-break: break-all;
}
.nl-show-all {
	display: block;
	margin: 10px auto 0;
	padding: 8px 24px;
	background: transparent;
	border: none;
	font: inherit;
	font-size: 0.88rem;
	font-weight: 700;
	color: #2a3a56;
	cursor: pointer;
}

/* ══════════════════════════════════════════════════════════════════════════════
   HJEMSKJERM: TRE SONER
   ══════════════════════════════════════════════════════════════════════════════ */
/* Phone frame */
.hs2-phone {
	display: flex;
	flex-direction: column;
	width: 100%;
	max-width: 320px;
	height: 520px;
	border: 1.5px solid #2a2a2a;
	border-radius: 24px;
	overflow: hidden;
	box-shadow: 0 8px 32px rgba(0,0,0,0.55);
	background: #0f0f0f;
	margin-bottom: 16px;
}

/* Zone base */
.hs2-zone {
	display: flex;
	flex-direction: column;
	overflow: hidden;
	transition: flex 0.28s cubic-bezier(.4,0,.2,1), max-height 0.28s cubic-bezier(.4,0,.2,1);
}
.hs2-full { flex: 1 1 0 !important; }
.hs2-hide { flex: 0 0 0 !important; overflow: hidden; }

/* Zone 1: Widgets — 40 % */
.hs2-z-widget { flex: 2 2 40%; background: #0f0f0f; min-height: 0; }

/* Zone 2: Temaer — 20 % */
.hs2-z-tema {
	flex: 1 1 20%;
	background: #0f0f0f;
	min-height: 0;
}

/* Zone 3: Chat & Fil — 40 % */
.hs2-z-bottom { flex: 2 2 40%; background: #0f0f0f; min-height: 0; }

/* Zone separators */
.hs2-zone-sep {
	height: 1px;
	background: #2a2a2a;
	flex-shrink: 0;
}

/* ── Widget collapsed row ── */
.hs2-widget-row {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 14px;
	padding: 16px;
	height: 100%;
	box-sizing: border-box;
}
.hs2-mini-circ {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 64px;
	height: 64px;
	border-radius: 50%;
	border: 2px solid var(--wc, #888);
	background: #1a1a1a;
	gap: 0;
	flex-shrink: 0;
	cursor: pointer;
	user-select: none;
	touch-action: none;
	transition: background 0.15s, box-shadow 0.15s;
}
.hs2-mini-circ:hover { background: #222; }
.hs2-mini-circ.hs2-lp-active {
	box-shadow: 0 0 0 5px color-mix(in srgb, var(--wc,#888) 35%, transparent);
}
.hs2-mc-val {
	font-size: 0.88rem;
	font-weight: 700;
	color: var(--wc, #ccc);
	line-height: 1;
}
.hs2-mc-unit {
	font-size: 0.55rem;
	color: color-mix(in srgb, var(--wc,#888) 80%, #000);
	line-height: 1;
}
.hs2-mc-lbl {
	font-size: 0.5rem;
	color: #555;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	line-height: 1.2;
}
.hs2-expand-btn {
	margin-left: auto;
	background: transparent;
	border: none;
	color: #555;
	font-size: 1.3rem;
	cursor: pointer;
	padding: 4px 8px;
	line-height: 1;
	flex-shrink: 0;
}

/* ── Relasjon sensor-dashboard ── */
.hs2-rel-header {
	display: flex; align-items: center; justify-content: space-between;
	padding: 10px 14px 4px; flex-shrink: 0;
}
.hs2-rel-sub { font-size: 0.6rem; color: #555; text-transform: uppercase; letter-spacing: 0.07em; }
.hs2-rel-scores { display: flex; gap: 10px; }
.hs2-rel-score { font-size: 0.75rem; font-weight: 700; }
.hs2-rel-chart { width: 100%; flex: 1; min-height: 0; display: block; padding: 0 4px; }
.hs2-rel-legend {
	display: flex; justify-content: center; gap: 14px;
	padding: 4px 0 8px; font-size: 0.6rem; color: #666; flex-shrink: 0;
}

/* ── Top bar (inside expanded zones) ── */
.hs2-top-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 10px 12px 8px;
	border-bottom: 1px solid #2a2a2a;
	flex-shrink: 0;
	background: #0f0f0f;
}
.hs2-back {
	padding: 4px 0;
	background: transparent;
	border: none;
	font: inherit;
	font-size: 0.78rem;
	color: #aaa;
	cursor: pointer;
	white-space: nowrap;
}
.hs2-top-title {
	font-size: 0.85rem;
	font-weight: 700;
	color: #fff;
	flex: 1;
}
.hs2-top-sub {
	font-size: 0.65rem;
	color: #555;
	white-space: nowrap;
}

/* ── Widget expanded grid ── */
.hs2-widget-grid {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 8px;
	padding: 10px 10px 6px;
}
.hs2-widget-tile {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 1px;
	padding: 10px 4px;
	border-radius: 12px;
	border: 1.5px solid #2a2a2a;
	background: #1a1a1a;
	cursor: pointer;
	transition: border-color 0.15s, background 0.15s;
}
.hs2-widget-tile:hover { border-color: var(--wc,#888); }
.hs2-widget-tile.active {
	border-color: var(--wc, #888);
	background: color-mix(in srgb, var(--wc,#888) 12%, #1a1a1a);
}
.hs2-wt-val {
	font-size: 0.88rem;
	font-weight: 700;
	color: var(--wc, #ccc);
}
.hs2-wt-unit {
	font-size: 0.58rem;
	color: #555;
}
.hs2-wt-lbl {
	font-size: 0.6rem;
	color: #555;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	margin-top: 1px;
}

/* Widget detail row */
.hs2-widget-detail {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	border-top: 1px solid #2a2a2a;
	margin-top: auto;
	flex-shrink: 0;
}
.hs2-detail-label {
	font-size: 0.7rem;
	color: #555;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	width: 48px;
	flex-shrink: 0;
}
.hs2-detail-big {
	font-size: 1rem;
	font-weight: 700;
	color: #fff;
	white-space: nowrap;
}
.hs2-spark {
	width: 80px;
	height: 28px;
	flex-shrink: 0;
	margin-left: auto;
}

/* ── Tema rail (collapsed) ── */
.hs2-tema-rail {
	display: flex;
	gap: 6px;
	padding: 10px 12px;
	overflow-x: auto;
	flex-shrink: 0;
	align-items: center;
	height: 100%;
	box-sizing: border-box;
}
.hs2-tema-pill {
	padding: 6px 12px;
	border-radius: 20px;
	border: 1px solid #2a2a2a;
	background: #1a1a1a;
	font: inherit;
	font-size: 0.75rem;
	color: #888;
	cursor: pointer;
	white-space: nowrap;
	transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.hs2-tema-pill:hover { border-color: #555; color: #ccc; }
.hs2-tema-pill.active {
	border-color: #666;
	background: #2a2a2a;
	color: #fff;
	font-weight: 600;
}

/* ── Tema sub-tabs ── */
.hs2-subtabs {
	display: flex;
	border-bottom: 1px solid #2a2a2a;
	padding: 0 8px;
	flex-shrink: 0;
	background: #0f0f0f;
}
.hs2-subtab {
	padding: 7px 12px;
	background: transparent;
	border: none;
	border-bottom: 2px solid transparent;
	margin-bottom: -1px;
	font: inherit;
	font-size: 0.78rem;
	color: #555;
	cursor: pointer;
	transition: color 0.15s, border-color 0.15s;
}
.hs2-subtab.active {
	color: #fff;
	font-weight: 700;
	border-bottom-color: #fff;
}

/* ── Chat body — lys øy, følger systemtema ── */
.hs2-chat-body {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 10px 10px 4px;
	overflow-y: auto;
	background: #fff;
}
.hs2-thread-row { display: flex; flex-direction: column; gap: 2px; }
.hs2-row-u { align-items: flex-end; }
.hs2-row-a { align-items: flex-start; }
.hs2-thread-bub {
	padding: 6px 10px;
	border-radius: 12px;
	font-size: 0.72rem;
	line-height: 1.4;
	max-width: 88%;
}
.hs2-bub-u { background: #1f2e4a; color: #fff; }
.hs2-bub-a { background: #f0f0f2; color: #111; }
.hs2-branch-tag {
	font-size: 0.6rem;
	color: #667eea;
	padding-left: 4px;
}

/* ── Input bar (lys, device-aware) ── */
.hs2-input-bar {
	padding: 8px 10px;
	border-top: 1px solid #e0e0e8;
	background: #f8f9fb;
	flex-shrink: 0;
}
.hs2-input {
	width: 100%;
	box-sizing: border-box;
	padding: 7px 12px;
	border: 1px solid #d0d4de;
	border-radius: 20px;
	font: inherit;
	font-size: 0.75rem;
	background: #fff;
	color: #111;
	outline: none;
	transition: border-color 0.15s;
}
.hs2-input:focus { border-color: #667eea; }

/* ── Quick-action circles (collapsed zone 3) ── */
.hs2-qact-rail {
	display: flex;
	align-items: center;
	justify-content: space-around;
	padding: 12px;
	height: 100%;
	box-sizing: border-box;
}
.hs2-qact-btn {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 5px;
	background: transparent;
	border: none;
	cursor: pointer;
	flex-shrink: 0;
	padding: 0;
}
.hs2-qact-circ {
	width: 52px;
	height: 52px;
	border-radius: 50%;
	border: 2px solid var(--qc, #555);
	background: #1a1a1a;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.2rem;
	transition: background 0.15s;
}
.hs2-qact-btn:hover .hs2-qact-circ { background: #2a2a2a; }
.hs2-qact-lbl {
	font-size: 0.55rem;
	color: #666;
	text-align: center;
	line-height: 1;
}

/* ── Widget-kontekstuell chat ── */
.hs2-ctx-banner {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 8px 12px;
	border-bottom: 1px solid #2a2a2a;
	background: #0f0f0f;
	flex-shrink: 0;
}
.hs2-mini-circ-sm {
	width: 44px;
	height: 44px;
	pointer-events: none;
	flex-shrink: 0;
}
.hs2-ctx-hint {
	font-size: 0.68rem;
	color: #555;
}

/* ── File zone ── */
.hs2-drop-zone {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	margin: 12px;
	padding: 20px;
	border: 1.5px dashed #3a3a3a;
	border-radius: 14px;
	background: #1a1a1a;
	cursor: pointer;
	transition: border-color 0.15s, background 0.15s;
}
.hs2-drop-zone:hover { border-color: #666; background: #222; }
.hs2-drop-ico { font-size: 1.6rem; }
.hs2-drop-lbl { font-size: 0.72rem; color: #555; text-align: center; line-height: 1.4; }
.hs2-file-suggestions {
	padding: 0 12px 12px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.hs2-sugg-heading {
	font-size: 0.68rem;
	color: #888;
	margin: 0 0 4px;
	font-weight: 600;
}
.hs2-sugg-row {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 8px 10px;
	border-radius: 8px;
	border: 1px solid #2a2a2a;
	background: #1a1a1a;
	cursor: pointer;
	transition: border-color 0.15s, background 0.15s;
}
.hs2-sugg-row:hover { border-color: #555; }
.hs2-sugg-row.chosen { border-color: #4caf76; background: rgba(76,175,118,0.1); }
.hs2-sugg-ico { font-size: 1rem; flex-shrink: 0; }
.hs2-sugg-txt { font-size: 0.72rem; color: #aaa; flex: 1; text-align: left; }
.hs2-sugg-check { color: #4caf76; font-weight: 700; font-size: 0.9rem; }

/* ── Tema expanded: file list ── */
.hs2-file-list {
	padding: 10px 12px;
	display: flex;
	flex-direction: column;
	gap: 6px;
	overflow-y: auto;
	flex: 1;
}
.hs2-file-item {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 7px 10px;
	border-radius: 8px;
	border: 1px solid #2a2a2a;
	background: #1a1a1a;
}
.hs2-file-ico { font-size: 1rem; flex-shrink: 0; }
.hs2-file-nm { font-size: 0.72rem; color: #aaa; }

/* ── Ripple overlay ── */
.hs2-phone { position: relative; overflow: hidden; } /* ensure stacking + clip */
.hs2-ripple {
	position: absolute;
	transform: translate(-50%, -50%) scale(0);
	width: 24px;
	height: 24px;
	border-radius: 50%;
	background: var(--rc, #ffffff);
	opacity: 0.28;
	pointer-events: none;
	z-index: 20;
	animation: hs2-ripple-expand 0.55s cubic-bezier(0.2, 0, 0.6, 1) forwards;
}
@keyframes hs2-ripple-expand {
	0%   { transform: translate(-50%, -50%) scale(0);   opacity: 0.32; }
	60%  { opacity: 0.14; }
	100% { transform: translate(-50%, -50%) scale(32);  opacity: 0; }
}

/* Keep old hs- classes to avoid breaking other things -- unused but harmless */
.hs-phone {
	display: flex;
	border: 1.5px solid var(--border-color);
	border-radius: 24px;
	overflow: hidden;
	max-width: 360px;
	height: 450px;
	margin-bottom: 16px;
	box-shadow: 0 8px 24px rgba(0,0,0,0.08);
}

/* Nav strip */
.hs-nav {
	width: 88px;
	background: #13182a;
	display: flex;
	flex-direction: column;
	padding: 14px 8px 10px;
	gap: 2px;
	flex-shrink: 0;
}
.hs-nav-zone {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 10px 6px;
	background: transparent;
	border: none;
	cursor: pointer;
	border-radius: 8px;
	text-align: left;
	transition: background 0.15s;
}
.hs-nav-zone:hover { background: rgba(255,255,255,0.06); }
.hs-nav-zone.hs-zone-active { background: rgba(255,255,255,0.1); }
.hs-nav-static { cursor: default; }
.hs-nav-static:hover { background: transparent; }
.hs-zone-lbl {
	font-size: 0.6rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: #6878a0;
	text-transform: uppercase;
}
.hs-nav-circles {
	display: flex;
	flex-wrap: wrap;
	gap: 3px;
}
.hs-nav-dot {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	border: 1.5px solid;
	font-size: 0.57rem;
	font-weight: 700;
	line-height: 1;
}
.hs-nav-sep {
	height: 1px;
	background: rgba(255,255,255,0.07);
	margin: 4px 0;
}
.hs-nav-tema {
	display: flex;
	flex-direction: column;
	gap: 3px;
}
.hs-tema-chip {
	font-size: 0.62rem;
	color: #8898cc;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.hs-nav-input-btns {
	display: flex;
	gap: 4px;
}
.hs-input-mode {
	font-size: 0.58rem;
	font-weight: 700;
	padding: 3px 5px;
	border-radius: 4px;
	border: 1px solid #334466;
	background: transparent;
	color: #6878a0;
	cursor: pointer;
	transition: background 0.12s, color 0.12s;
}
.hs-input-mode.hs-zone-active {
	background: #334466;
	color: #a0b8e8;
	border-color: #334466;
}

/* Main content */
.hs-main {
	flex: 1;
	display: flex;
	flex-direction: column;
	background: #f8f9fb;
	overflow: hidden;
	position: relative;
}
.hs-main-label {
	font-size: 0.68rem;
	color: #8090a8;
	padding: 10px 12px 4px;
	font-weight: 600;
	letter-spacing: 0.07em;
	text-transform: uppercase;
}
/* Chat thread (dash/main zone) */
.hs-chat-thread {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 5px;
	padding: 10px 10px 4px;
	overflow-y: auto;
}
.hs-thread-row {
	display: flex;
	flex-direction: column;
	gap: 3px;
}
.hs-row-u { align-items: flex-end; }
.hs-row-a { align-items: flex-start; }
.hs-thread-bubble {
	padding: 6px 10px;
	border-radius: 12px;
	font-size: 0.72rem;
	line-height: 1.35;
	max-width: 88%;
}
.hs-bubble-u {
	background: #2a3a56;
	color: #fff;
}
.hs-bubble-a {
	background: #fff;
	border: 1px solid #e0e6f0;
	color: #2a3a56;
}
.hs-branch-tag {
	font-size: 0.62rem;
	color: #7c8ef5;
	padding-left: 4px;
	margin-top: -1px;
}

/* Tema panel */
.hs-tema-header {
	display: flex;
	padding: 10px 8px 0;
	border-bottom: 1px solid #e8ecf2;
}
.hs-tema-tab {
	padding: 5px 9px;
	background: transparent;
	border: none;
	font: inherit;
	font-size: 0.76rem;
	color: #8090a8;
	cursor: pointer;
	border-bottom: 2px solid transparent;
	margin-bottom: -1px;
	transition: color 0.15s, border-color 0.15s;
}
.hs-tema-tab.active {
	color: #2a3a56;
	font-weight: 700;
	border-bottom-color: #2a3a56;
}
.hs-pg-dots {
	display: flex;
	justify-content: center;
	gap: 5px;
	padding: 7px 0;
}
.hs-pg-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #d0d8e8;
	transition: background 0.15s;
}
.hs-pg-dot.active { background: #2a3a56; }
.hs-tema-body {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	padding: 10px 14px;
	overflow: hidden;
}
.hs-vis-circle {
	border-radius: 50%;
	border: 1.5px solid #d0d8e8;
	background: #fff;
	flex-shrink: 0;
}

/* Shared bottom input */
.hs-bottom-input {
	padding: 8px 10px;
	border-top: 1px solid #e8ecf2;
	background: #fff;
}
.hs-input-field {
	width: 100%;
	box-sizing: border-box;
	padding: 7px 10px;
	border: 1px solid #d8e0ec;
	border-radius: 20px;
	font: inherit;
	font-size: 0.76rem;
	background: #f4f6fb;
	color: var(--text-primary);
	outline: none;
	transition: border-color 0.15s;
}
.hs-input-field:focus { border-color: #8090c8; }

/* Fil zone */
.hs-fil-body {
	flex: 1;
	display: flex;
	flex-direction: column;
	padding: 10px 10px 8px;
	gap: 8px;
}
.hs-file-area {
	flex: 1;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: flex-start;
	padding-left: 10px;
}
.hs-fil-input-row {
	display: flex;
	gap: 6px;
	align-items: center;
}
.hs-plus-btn {
	width: 34px;
	height: 34px;
	border-radius: 50%;
	border: 1.5px solid #8090c8;
	background: transparent;
	color: #8090c8;
	font-size: 1.1rem;
	cursor: pointer;
	flex-shrink: 0;
	display: grid;
	place-items: center;
	transition: background 0.15s;
}
.hs-plus-btn:hover { background: #eef0f8; }
.hs-doc-card {
	background: #fff;
	border: 1px solid #d8e0ec;
	border-radius: 10px;
	padding: 10px 12px;
	display: flex;
	align-items: center;
	gap: 10px;
}
.hs-doc-msg {
	font-size: 0.73rem;
	color: #4a5a70;
	flex: 1;
	margin: 0;
	line-height: 1.35;
}
.hs-doc-add {
	padding: 5px 10px;
	border-radius: 6px;
	border: none;
	background: #2a3a56;
	color: #fff;
	font: inherit;
	font-size: 0.7rem;
	font-weight: 600;
	cursor: pointer;
	white-space: nowrap;
	transition: background 0.15s;
}
.hs-doc-add:hover { background: #1a2844; }

/* Chat zone */
.hs-chat-msgs {
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 12px 10px;
	overflow: auto;
}
.hs-bubble-ai, .hs-bubble-user {
	padding: 7px 11px;
	border-radius: 14px;
	font-size: 0.76rem;
	line-height: 1.4;
	max-width: 86%;
}
.hs-bubble-ai {
	background: #fff;
	border: 1px solid #e8ecf2;
	align-self: flex-start;
	color: #2a3a56;
}
.hs-bubble-user {
	background: #2a3a56;
	color: #fff;
	align-self: flex-end;
}
</style>
