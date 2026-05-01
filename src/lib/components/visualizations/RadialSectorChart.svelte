<script module lang="ts">
  export interface SectorDef {
    /** 0–1: høyde på primærarken (f.eks. løste oppgaver) */
    radius: number;
    color: string;
    opacity: number;
    /** 0–1: valgfri bakgrunnsark i samme vinkel (f.eks. planlagte oppgaver) */
    bgRadius?: number;
    bgColor?: string;
    /** Kort tekst som vises midt i sektoren */
    label?: string;
  }
</script>

<script lang="ts">
  interface Props {
    sectors: SectorDef[];
    /** Totalt antall sporplasser rundt ringen (kan være ≥ sectors.length) */
    totalSlots: number;
    /** Indre radius som andel av maxR (lager donut-hull) */
    innerRadiusFraction?: number;
    /** Gap mellom sektorer i grader */
    gapDeg?: number;
    /** SVG viewBox-størrelse */
    size?: number;
    animateOnMount?: boolean;
    showLabels?: boolean;
    /** Vis subtil sporring for alle plasser (grå bakgrunn) */
    showTrack?: boolean;
    centerLabel?: string;
    centerSublabel?: string;
  }

  let {
    sectors,
    totalSlots,
    innerRadiusFraction = 0.35,
    gapDeg = 2,
    size = 200,
    animateOnMount = true,
    showLabels = true,
    showTrack = true,
    centerLabel,
    centerSublabel,
  }: Props = $props();

  function toRad(deg: number) {
    return (deg * Math.PI) / 180;
  }

  function buildArc(
    cx: number,
    cy: number,
    innerR: number,
    outerR: number,
    startDeg: number,
    endDeg: number
  ): string {
    const s = toRad(startDeg);
    const e = toRad(endDeg);
    const x1 = cx + outerR * Math.cos(s), y1 = cy + outerR * Math.sin(s);
    const x2 = cx + outerR * Math.cos(e), y2 = cy + outerR * Math.sin(e);
    const large = endDeg - startDeg > 180 ? 1 : 0;

    if (innerR <= 0) {
      // Kakeskive — rett linje fra senter til kant og tilbake
      return (
        `M${cx.toFixed(2)} ${cy.toFixed(2)} ` +
        `L${x1.toFixed(2)} ${y1.toFixed(2)} ` +
        `A${outerR} ${outerR} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`
      );
    }

    const x3 = cx + innerR * Math.cos(e), y3 = cy + innerR * Math.sin(e);
    const x4 = cx + innerR * Math.cos(s), y4 = cy + innerR * Math.sin(s);
    return (
      `M${x1.toFixed(2)} ${y1.toFixed(2)} ` +
      `A${outerR} ${outerR} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
      `L${x3.toFixed(2)} ${y3.toFixed(2)} ` +
      `A${innerR} ${innerR} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}Z`
    );
  }

  const geom = $derived.by(() => {
    const c = size / 2;
    const maxR = size / 2 * 0.96;
    const innerR = maxR * innerRadiusFraction;
    const slotDeg = 360 / totalSlots;

    const track = Array.from({ length: totalSlots }, (_, i) => {
      const start = -90 + i * slotDeg;
      const end = start + slotDeg - gapDeg;
      return buildArc(c, c, innerR, maxR, start, end);
    });

    const arcs = sectors.map((s, i) => {
      const start = -90 + i * slotDeg;
      const end = start + slotDeg - gapDeg;

      const bgOuterR = s.bgRadius != null
        ? innerR + (maxR - innerR) * Math.max(0.05, Math.min(1, s.bgRadius))
        : null;

      const outerR = innerR + (maxR - innerR) * Math.max(0.05, Math.min(1, s.radius));
      const midDeg = start + (slotDeg - gapDeg) / 2;
      const labelR = (innerR + outerR) / 2;

      return {
        bgD: bgOuterR != null ? buildArc(c, c, innerR, bgOuterR, start, end) : null,
        bgColor: s.bgColor ?? 'rgba(255,255,255,0.18)',
        d: buildArc(c, c, innerR, outerR, start, end),
        color: s.color,
        opacity: s.opacity,
        label: s.label,
        lx: c + labelR * Math.cos(toRad(midDeg)),
        ly: c + labelR * Math.sin(toRad(midDeg)),
        fontSize: Math.min(10, (slotDeg - gapDeg) * 0.6),
      };
    });

    return { c, innerR, track, arcs };
  });

  let mounted = $state(false);
  $effect(() => {
    if (animateOnMount) {
      requestAnimationFrame(() => { mounted = true; });
    } else {
      mounted = true;
    }
  });
</script>

<svg viewBox="0 0 {size} {size}" width="100%" style="max-width:{size}px; display:block;">
  <!-- Sporlag -->
  {#if showTrack}
    {#each geom.track as d}
      <path {d} fill="rgba(255,255,255,0.06)" />
    {/each}
  {/if}

  <!-- Bakgrunnsarker (f.eks. planlagte oppgaver) -->
  {#each geom.arcs as arc, i}
    {#if arc.bgD}
      <path
        d={arc.bgD}
        fill={arc.bgColor}
        opacity={mounted ? arc.opacity : 0}
        style="transition: opacity {0.25 + i * 0.015}s ease"
      />
    {/if}
  {/each}

  <!-- Primærarker (f.eks. løste oppgaver) -->
  {#each geom.arcs as arc, i}
    {#if arc.opacity > 0}
      <path
        d={arc.d}
        fill={arc.color}
        opacity={mounted ? arc.opacity : 0}
        style="transition: opacity {0.25 + i * 0.015}s ease"
      />
    {/if}
    {#if showLabels && arc.label && arc.fontSize >= 5}
      <text
        x={arc.lx}
        y={arc.ly}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={arc.fontSize}
        fill="rgba(255,255,255,0.85)"
        pointer-events="none"
        opacity={mounted ? arc.opacity : 0}
        style="transition: opacity {0.25 + i * 0.015}s ease"
      >{arc.label}</text>
    {/if}
  {/each}

  <!-- Sentertekst — skalert relativt til size -->
  {#if centerLabel}
    {@const fs = size * 0.12}
    {@const sub = size * 0.062}
    {@const offset = centerSublabel ? fs * 0.38 : 0}
    <text
      x={geom.c}
      y={geom.c - offset}
      text-anchor="middle"
      dominant-baseline="middle"
      font-size={fs}
      font-weight="600"
      fill="white"
    >{centerLabel}</text>
    {#if centerSublabel}
      <text
        x={geom.c}
        y={geom.c + offset + sub * 0.5}
        text-anchor="middle"
        dominant-baseline="middle"
        font-size={sub}
        fill="rgba(255,255,255,0.45)"
      >{centerSublabel}</text>
    {/if}
  {/if}
</svg>
