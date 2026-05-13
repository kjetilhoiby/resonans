<script lang="ts">
  import { onMount } from 'svelte';
  import RadialSectorChart, { type SectorDef } from './RadialSectorChart.svelte';

  export interface DayData {
    planned: number;    // antall planlagte oppgaver
    completed: number;  // antall løste oppgaver
    isPast: boolean;
    isToday: boolean;
  }

  interface Props {
    year: number;
    month: number; // 1–12
    /** Én entry per dag i måneden (index 0 = dag 1). Manglende dager = tom. */
    days: DayData[];
    size?: number;
    animateOnMount?: boolean;
    /** Aktiver syklus gjennom flere datasett (oppgaver → effort → stemning …) */
    cycle?: boolean;
    /** Etikett for det datasettet som vises akkurat nå (kan bindes til av forelder) */
    currentLabel?: string;
  }

  let {
    year,
    month,
    days,
    size = 200,
    animateOnMount = true,
    cycle = true,
    currentLabel = $bindable<string>('Gjort'),
  }: Props = $props();

  const daysInMonth = $derived(new Date(year, month, 0).getDate());

  interface Dataset {
    id: string;
    label: string;
    color: string;
    build: () => SectorDef[];
  }

  const tasksMaxPlanned = $derived(
    Math.max(1, ...days.map((d) => d?.planned ?? 0))
  );

  function buildTasks(): SectorDef[] {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = days[i];
      const visible = day?.isPast || day?.isToday;
      if (!visible || !day.planned) {
        return { radius: 0, color: 'transparent', opacity: 0 };
      }
      const bgRadius = day.planned / tasksMaxPlanned;
      const radius = day.completed / tasksMaxPlanned;
      const opacity = day.isToday ? 1 : 0.85;
      return {
        bgRadius,
        bgColor: day.isToday ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
        radius: Math.max(0, radius),
        color: '#5fa080',
        opacity,
      };
    });
  }

  function noise(seed: number, salt: number): number {
    const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return Math.abs(x - Math.floor(x));
  }

  function buildMock(color: string, salt: number): SectorDef[] {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = days[i];
      const visible = day?.isPast || day?.isToday;
      if (!visible) {
        return { radius: 0, color: 'transparent', opacity: 0 };
      }
      const radius = 0.25 + 0.7 * noise(i + 1, salt);
      const opacity = day.isToday ? 1 : 0.85;
      return { radius, color, opacity };
    });
  }

  const datasets = $derived<Dataset[]>([
    { id: 'oppgaver', label: 'Gjort', color: '#5fa080', build: buildTasks },
    { id: 'effort',   label: 'Trent', color: '#f59e0b', build: () => buildMock('#f59e0b', 1.7) },
    { id: 'stemning', label: 'Følt',  color: '#a78bfa', build: () => buildMock('#a78bfa', 3.1) },
  ]);

  let currentIdx = $state(0);
  const currentDataset = $derived(datasets[currentIdx] ?? datasets[0]);
  const targetSectors = $derived(currentDataset.build());

  $effect(() => {
    currentLabel = currentDataset.label;
  });

  // Spredning: en segment med radius=1 bruker SPREAD_T_MAX ms.
  // Mindre segmenter stopper tidligere → "samme grunnfart, ulike stopp-punkter".
  const SPREAD_T_MAX = 900;
  const RETRACT_T_MAX = 550;

  type Phase = 'pre' | 'spreading' | 'rest' | 'retracting' | 'collapsed';
  let phase = $state<Phase>('pre');
  let phaseStart = $state(0);
  let now = $state(0);

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  const liveSectors = $derived.by<SectorDef[]>(() => {
    return targetSectors.map((s) => {
      const targetMax = Math.max(s.radius ?? 0, s.bgRadius ?? 0);
      if (targetMax <= 0) return s;

      let fill: number;
      if (phase === 'pre' || phase === 'collapsed') {
        fill = 0;
      } else if (phase === 'rest') {
        fill = 1;
      } else if (phase === 'spreading') {
        const duration = targetMax * SPREAD_T_MAX;
        const elapsed = now - phaseStart;
        const p = duration > 0 ? Math.min(1, elapsed / duration) : 1;
        fill = easeOutCubic(p);
      } else {
        const duration = targetMax * RETRACT_T_MAX;
        const elapsed = now - phaseStart;
        const p = duration > 0 ? Math.min(1, elapsed / duration) : 1;
        fill = 1 - easeOutCubic(p);
      }

      return {
        ...s,
        radius: (s.radius ?? 0) * fill,
        bgRadius: s.bgRadius != null ? s.bgRadius * fill : undefined,
      };
    });
  });

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  onMount(() => {
    if (!cycle) {
      phase = 'rest';
      return;
    }

    let stopped = false;
    let rafId: number | null = null;

    function tick() {
      if (stopped) return;
      now = performance.now();
      rafId = requestAnimationFrame(tick);
    }

    async function loop() {
      await sleep(animateOnMount ? 400 : 0);
      if (stopped) return;

      while (!stopped) {
        // Spredning — hvert segment bruker (target * SPREAD_T_MAX) ms
        phaseStart = performance.now();
        phase = 'spreading';
        await sleep(SPREAD_T_MAX);
        if (stopped) return;

        // Hvile på full spredning
        phase = 'rest';
        await sleep(1500);
        if (stopped) return;

        // Sammentrekning — samme prinsipp, kortere tidsbudsjett
        phaseStart = performance.now();
        phase = 'retracting';
        await sleep(RETRACT_T_MAX);
        if (stopped) return;

        // Bytte datasett mens hjulet er sammentrukket; labelen bytter via $effect
        phase = 'collapsed';
        currentIdx = (currentIdx + 1) % datasets.length;
        await sleep(550);
      }
    }

    rafId = requestAnimationFrame(tick);
    loop();

    return () => {
      stopped = true;
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  });
</script>

<RadialSectorChart
  sectors={liveSectors}
  totalSlots={daysInMonth}
  {size}
  animateOnMount={false}
  gapDeg={1.5}
  innerRadiusFraction={0}
  showTrack={false}
/>
