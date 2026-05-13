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
  }

  let {
    year,
    month,
    days,
    size = 200,
    animateOnMount = true,
    cycle = true,
  }: Props = $props();

  const daysInMonth = $derived(new Date(year, month, 0).getDate());

  interface Dataset {
    id: string;
    emoji: string;
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

  // Deterministisk pseudo-tilfeldig 0..1 basert på dag-indeks
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
    { id: 'oppgaver', emoji: '🎯', color: '#5fa080', build: buildTasks },
    { id: 'effort',   emoji: '💪', color: '#f59e0b', build: () => buildMock('#f59e0b', 1.7) },
    { id: 'stemning', emoji: '😊', color: '#a78bfa', build: () => buildMock('#a78bfa', 3.1) },
  ]);

  let currentIdx = $state(0);
  let scale = $state(0);
  let emojiOpacity = $state(1);

  const currentDataset = $derived(datasets[currentIdx] ?? datasets[0]);
  const sectors = $derived(currentDataset.build());

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeInCubic(t: number): number {
    return t * t * t;
  }
  function linear(t: number): number {
    return t;
  }

  function tween(
    from: number,
    to: number,
    duration: number,
    easing: (t: number) => number,
    setter: (v: number) => void,
    isStopped: () => boolean
  ): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      function step(now: number) {
        if (isStopped()) {
          resolve();
          return;
        }
        const t = Math.min(1, (now - start) / duration);
        setter(from + (to - from) * easing(t));
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      }
      requestAnimationFrame(step);
    });
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  onMount(() => {
    if (!cycle) {
      scale = 1;
      emojiOpacity = 0;
      return;
    }

    let stopped = false;
    const isStopped = () => stopped;

    async function loop() {
      // Hold første emoji synlig et øyeblikk før første spredning
      await sleep(animateOnMount ? 600 : 0);
      if (stopped) return;

      while (!stopped) {
        // Spredning: segmentene vokser ut, emojien fader ut
        await Promise.all([
          tween(0, 1, 850, easeOutCubic, (v) => (scale = v), isStopped),
          tween(emojiOpacity, 0, 350, linear, (v) => (emojiOpacity = v), isStopped),
        ]);
        if (stopped) return;

        // Hvile på full størrelse
        await sleep(1800);
        if (stopped) return;

        // Sammentrekning
        await tween(1, 0, 500, easeInCubic, (v) => (scale = v), isStopped);
        if (stopped) return;

        // Bytt datasett mens hjulet er sammentrukket og emojien fortsatt usynlig
        currentIdx = (currentIdx + 1) % datasets.length;

        // Liten pause, så fader nytt emoji inn
        await sleep(120);
        if (stopped) return;
        await tween(0, 1, 380, linear, (v) => (emojiOpacity = v), isStopped);
        if (stopped) return;

        // Hvile med emoji synlig før neste spredning
        await sleep(700);
      }
    }

    loop();
    return () => {
      stopped = true;
    };
  });
</script>

<RadialSectorChart
  {sectors}
  totalSlots={daysInMonth}
  {size}
  animateOnMount={false}
  gapDeg={1.5}
  innerRadiusFraction={0}
  showTrack={false}
  {scale}
  centerEmoji={currentDataset.emoji}
  centerEmojiOpacity={emojiOpacity}
/>
