<script lang="ts">
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
  }

  let { year, month, days, size = 200, animateOnMount = true }: Props = $props();

  const daysInMonth = $derived(new Date(year, month, 0).getDate());

  const maxPlanned = $derived(
    Math.max(1, ...days.map((d) => d?.planned ?? 0))
  );

  const sectors = $derived<SectorDef[]>(
    Array.from({ length: daysInMonth }, (_, i) => {
      const day = days[i];
      const visible = day?.isPast || day?.isToday;

      if (!visible || !day.planned) {
        return { radius: 0, color: 'transparent', opacity: 0 };
      }

      const bgRadius = day.planned / maxPlanned;
      const radius = day.completed / maxPlanned;
      const opacity = day.isToday ? 1 : 0.85;

      return {
        bgRadius,
        bgColor: day.isToday ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.14)',
        radius: Math.max(0, radius),
        color: '#5fa080',
        opacity,
      };
    })
  );
</script>

<RadialSectorChart
  {sectors}
  totalSlots={daysInMonth}
  {size}
  {animateOnMount}
  gapDeg={1.5}
  innerRadiusFraction={0}
  showTrack={false}
/>
