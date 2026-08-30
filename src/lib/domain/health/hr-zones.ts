/**
 * Pulssoner — ÉN modell, delt av serveren og Ekko.
 *
 * ## Hvorfor HRR og ikke %makspuls
 *
 * Fram til august 2026 fantes det to sonemodeller i systemet, og de var uenige.
 * Serveren regnet HRR (Karvonen) i `computeHrZoneDistribution`; Ekkos
 * `HeartRateZones` regnet ren %makspuls. Med maks 180 og hvile 50 ga det:
 *
 * | Sone | %makspuls (Ekko) | HRR (server) |
 * |---|---|---|
 * | Z2 «Rolig» | 108–125 | 128–140 |
 * | Z3 «Moderat» | 126–143 | 141–153 |
 *
 * Puls 135 var altså Z3 i appen og Z2 på nettet — samme minutt, to svar. Hele
 * mellomområdet lå én sone for høyt i appen, og det er nettopp der «rolig» bor:
 * en genuint rolig løpetur ble meldt som moderat, og en sonecoach bygget på den
 * modellen ville bedt brukeren gå ned i gange for å nå «sone 2».
 *
 * HRR vant fordi den tar hensyn til hvilepulsen, og fordi den alt var modellen
 * effort-skåringen og VDOT-proxyen hviler på. Ett bytte, ikke tre.
 *
 * ## Hvorfor båndene er HELTALL, ikke brøker
 *
 * Klassifiseringen skjer mot avrundede bpm-grenser, ikke mot `hrr >= 0.6`.
 * Grunnen er at båndet SIES høyt («Sone 2 i dag. 128 til 140») og vises på
 * flaten. Regnet coachen på brøker mens flaten viste avrundede tall, kunne puls
 * 128 være «under sonen» i det ene laget og «i sonen» i det andre — et avvik på
 * en halv slag som er usynlig i koden og synlig for brukeren. Nå er båndet
 * autoriteten begge steder.
 *
 * Konsekvens: sonefordelingen kan flytte seg inntil ett slag på grensene mot det
 * som ble beregnet før. Det er under en prosent av tiden i en sone, og prisen
 * for at appen og nettet endelig sier det samme.
 */

/** Antall soner i modellen. Femsonersmodellen er standarden alt hviler på. */
export const HR_ZONE_COUNT = 5;

export type HrZoneNumber = 1 | 2 | 3 | 4 | 5;

export const HR_ZONE_NUMBERS: readonly HrZoneNumber[] = [1, 2, 3, 4, 5];

/**
 * Nedre HRR-andel per sone. Z1 starter på hvilepulsen (0), ikke på 50 % — en
 * puls under Z2 er ikke «ingen sone», den er restitusjon.
 */
export const HR_ZONE_LOWER_FRACTIONS: Record<HrZoneNumber, number> = {
  1: 0,
  2: 0.6,
  3: 0.7,
  4: 0.8,
  5: 0.9,
};

/**
 * Norske navn. De samme ordene brukes i Ekko, så en talt setning og et kort på
 * nettet aldri kaller den samme sonen to ting.
 */
export const HR_ZONE_LABELS: Record<HrZoneNumber, string> = {
  1: "Restitusjon",
  2: "Rolig",
  3: "Moderat",
  4: "Terskel",
  5: "Maksimal",
};

/** Hva sonen er TIL — brukes i forklarende tekst, ikke som etikett. */
export const HR_ZONE_PURPOSES: Record<HrZoneNumber, string> = {
  1: "aktiv restitusjon",
  2: "rolig utholdenhet — grunnmuren",
  3: "moderat aerobt arbeid",
  4: "terskelarbeid",
  5: "maksimalt arbeid",
};

export interface HeartRateBaselineInput {
  restHr: number;
  maxHr: number;
}

export interface HrZoneBand {
  zone: HrZoneNumber;
  label: string;
  /** Nedre grense i bpm, inklusiv. */
  lowerBpm: number;
  /**
   * Øvre grense i bpm, inklusiv — altså siste slag som fortsatt er i sonen.
   * For Z5 er den makspulsen; en høyere måling klassifiseres fortsatt som Z5.
   */
  upperBpm: number;
}

/**
 * Minste troverdige pulsreserve. Under dette er hvile- eller makspulsen feil, og
 * soner regnet av dem ville vært oppdiktet presisjon. Samme terskel som
 * `computeHrZoneDistribution` alltid har brukt.
 */
export const MIN_HR_RESERVE = 30;

/** Er baselinen god nok til å regne soner av? */
export function isUsableHrBaseline(baseline: HeartRateBaselineInput): boolean {
  const { restHr, maxHr } = baseline;
  if (!Number.isFinite(restHr) || !Number.isFinite(maxHr)) return false;
  return maxHr - restHr >= MIN_HR_RESERVE;
}

/**
 * Nedre bpm-grense for en sone, avrundet. Eksportert fordi den er definisjonen
 * `hrZoneBands` og `zoneForHeartRate` begge hviler på — regnes den to steder,
 * driver de fra hverandre.
 */
export function zoneLowerBpm(
  zone: HrZoneNumber,
  baseline: HeartRateBaselineInput,
): number {
  const reserve = baseline.maxHr - baseline.restHr;
  return Math.round(baseline.restHr + HR_ZONE_LOWER_FRACTIONS[zone] * reserve);
}

/**
 * Alle fem båndene i bpm. `null` når baselinen ikke holder — en tom liste ville
 * sett ut som «ingen soner finnes», og et gjettet bånd er verre enn ingen.
 */
export function hrZoneBands(
  baseline: HeartRateBaselineInput,
): HrZoneBand[] | null {
  if (!isUsableHrBaseline(baseline)) return null;

  return HR_ZONE_NUMBERS.map((zone) => {
    const lowerBpm = zoneLowerBpm(zone, baseline);
    const upperBpm =
      zone === 5
        ? Math.round(baseline.maxHr)
        : zoneLowerBpm((zone + 1) as HrZoneNumber, baseline) - 1;
    return { zone, label: HR_ZONE_LABELS[zone], lowerBpm, upperBpm };
  });
}

/** Båndet for én sone, eller `null` når baselinen ikke holder. */
export function hrZoneBand(
  zone: HrZoneNumber,
  baseline: HeartRateBaselineInput,
): HrZoneBand | null {
  return hrZoneBands(baseline)?.find((b) => b.zone === zone) ?? null;
}

/**
 * Sonen en puls hører til. Klassifiserer mot de avrundede båndene, så svaret er
 * det samme som brukeren ser og hører. `null` uten brukbar baseline eller puls.
 */
export function zoneForHeartRate(
  bpm: number,
  baseline: HeartRateBaselineInput,
): HrZoneNumber | null {
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  if (!isUsableHrBaseline(baseline)) return null;

  for (const zone of [5, 4, 3, 2] as HrZoneNumber[]) {
    if (bpm >= zoneLowerBpm(zone, baseline)) return zone;
  }
  return 1;
}

/**
 * Andel av HRR som en puls representerer, klippet til 0–1.
 *
 * Beholdt ved siden av `zoneForHeartRate` fordi TRIMP og %VO2max-proxyen trenger
 * den kontinuerlige verdien, ikke sonenummeret.
 */
export function heartRateReserveFraction(
  bpm: number,
  baseline: HeartRateBaselineInput,
): number {
  const reserve = baseline.maxHr - baseline.restHr;
  if (reserve <= 0) return 0;
  return Math.max(0, Math.min(1, (bpm - baseline.restHr) / reserve));
}

/**
 * «128 til 140» — båndet som tale. Ingen «bpm»: en talecoach som leser
 * enheten hver gang blir masete, og tallparet er utvetydig i sammenhengen.
 */
export function spokenBand(band: HrZoneBand): string {
  return `${band.lowerBpm} til ${band.upperBpm}`;
}
