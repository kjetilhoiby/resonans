<script lang="ts">
  import RadialSectorChart, { type SectorDef } from './RadialSectorChart.svelte';

  /**
   * Status for ett domene for inneværende måned.
   * monthPct 0–1: andel av månedlige mål nådd hittil
   * trend: retning siste 7 dager
   */
  export interface DomainStatus {
    id: string;
    label: string;
    color: string;
    monthPct: number;
    trend: 'up' | 'flat' | 'down';
  }

  interface Props {
    domains: DomainStatus[];
    size?: number;
    animateOnMount?: boolean;
    /** Overstyrer senteretiketten (standard: snitt-% av domener) */
    centerLabel?: string;
    centerSublabel?: string;
    showLabels?: boolean;
  }

  let { domains, size = 200, animateOnMount = true, centerLabel, centerSublabel = 'snitt', showLabels = true }: Props = $props();

  /** Høyere opasitet = positiv trend */
  const TREND_OPACITY: Record<DomainStatus['trend'], number> = {
    up: 1,
    flat: 0.7,
    down: 0.45,
  };

  const sectors = $derived<SectorDef[]>(
    domains.map((d) => ({
      radius: Math.max(0.08, Math.min(1, d.monthPct)),
      color: d.color,
      opacity: TREND_OPACITY[d.trend],
      label: d.label,
    }))
  );

  const avgPct = $derived(
    domains.length
      ? Math.round(
          (domains.reduce((s, d) => s + d.monthPct, 0) / domains.length) * 100
        )
      : 0
  );

  const derivedCenter = $derived(`${avgPct}%`);
</script>

<RadialSectorChart
  {sectors}
  totalSlots={domains.length}
  {size}
  {animateOnMount}
  {showLabels}
  gapDeg={5}
  innerRadiusFraction={0.38}
  centerLabel={centerLabel ?? derivedCenter}
  {centerSublabel}
/>
