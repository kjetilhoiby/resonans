// Egenfrekvens Domain — Selvinnsikt: handlinger, følelser, tanker, balanse, refleksjon

export type EgenfrekvensMetric = 'balance' | 'thoughts' | 'feelings' | 'actions';

export const EGENFREKVENS_METRICS: Record<
  EgenfrekvensMetric,
  { label: string; range: [number, number]; direction: 'higher_better' | 'context' }
> = {
  balance: { label: 'Balanse', range: [-5, 5], direction: 'higher_better' },
  actions: { label: 'Handlinger', range: [1, 5], direction: 'higher_better' },
  feelings: { label: 'Følelser', range: [1, 5], direction: 'context' },
  thoughts: { label: 'Tanker', range: [1, 5], direction: 'context' }
};

export const EGENFREKVENS_TRIGGERS =
  /egenfrekvens|psykisk\s*helse|mental\s*helse|stress|følelser?|tanker|humør|innsjekk|sjekkin|overskudd|underskudd|reflek/i;

export const EGENFREKVENS_THEME_NAME_TRIGGERS =
  /psykisk\s*helse|mental\s*helse|stress|følelser?|humør|stemning/i;

export const EGENFREKVENS_PARENT_THEME_NAME = 'Egenfrekvens';

// ── Signal type ──────────────────────────────────────────────────────────

export type SignalOption = { value: string; label: string };

export interface PyramidLevel {
  title: string;
  description: string;
  signals: SignalOption[];
}

export interface PyramidOptionGroup {
  label: string;
  isActive: boolean;
  options: SignalOption[];
}

// ── Handlinger ───────────────────────────────────────────────────────────

export const ACTIONS_PYRAMID: Record<number, PyramidLevel> = {
  1: {
    title: 'Tilbaketrekning',
    description: 'Kroppen søker rask lindring eller stenger ned',
    signals: [
      { value: 'scroller', label: 'Scroller' },
      { value: 'utsetter', label: 'Utsetter' },
      { value: 'unnviker', label: 'Unnviker' },
      { value: 'overspiser', label: 'Overspiser' },
      { value: 'smaspiser', label: 'Småspiser' },
      { value: 'trekker_meg_unna', label: 'Trekker meg unna' },
      { value: 'toyer_leggetid', label: 'Tøyer leggetid' },
      { value: 'kommer_ikke_i_gang', label: 'Kommer ikke i gang' },
      { value: 'numner', label: 'Numner seg' },
      { value: 'kroppen_gir_opp', label: 'Kroppen gir opp' },
      { value: 'blir_statisk', label: 'Blir statisk' },
      { value: 'dropper_bevegelse', label: 'Dropper bevegelse' },
    ]
  },
  2: {
    title: 'Friksjon',
    description: 'Energien kommer ut feil',
    signals: [
      { value: 'snapper', label: 'Snapper' },
      { value: 'klager', label: 'Klager' },
      { value: 'viser_irritasjon', label: 'Viser irritasjon' },
      { value: 'gar_i_las', label: 'Går i lås' },
      { value: 'skynder_pa_andre', label: 'Skynder på andre' },
      { value: 'kritiserer', label: 'Kritiserer' },
      { value: 'mister_filter', label: 'Mister filter' },
      { value: 'badeball', label: 'Badeball' },
      { value: 'overkompenserer', label: 'Overkompenserer' },
      { value: 'tar_i_for_hardt', label: 'Tar i for hardt' },
    ]
  },
  3: {
    title: 'Vedlikehold',
    description: 'Holder hverdagen i gang',
    signals: [
      { value: 'gjor_det_nodvendige', label: 'Gjør det nødvendige' },
      { value: 'holder_dagen_i_gang', label: 'Holder dagen i gang' },
      { value: 'folger_rutiner', label: 'Følger rutiner' },
      { value: 'ordner_smating', label: 'Ordner småting' },
      { value: 'gar_pa_autopilot', label: 'Går på autopilot' },
      { value: 'kommer_seg_ut', label: 'Kommer seg ut' },
      { value: 'rydder_litt', label: 'Rydder litt' },
      { value: 'tar_unna_hauger', label: 'Tar unna hauger' },
      { value: 'lager_matpakker', label: 'Lager matpakker' },
      { value: 'tar_en_ting', label: 'Tar én ting' },
      { value: 'lett_aktivitet', label: 'Elsykler / lett tur' },
    ]
  },
  4: {
    title: 'Innsats',
    description: 'Gjør noe som koster litt men bygger retning',
    signals: [
      { value: 'tar_tak', label: 'Tar tak' },
      { value: 'trener_barekraftig', label: 'Trener bærekraftig' },
      { value: 'fullforer_noe', label: 'Fullfører noe' },
      { value: 'fokuserer', label: 'Fokuserer' },
      { value: 'holder_kontakt', label: 'Holder kontakt' },
      { value: 'strekker_seg', label: 'Strekker seg' },
      { value: 'rydder_ferdig', label: 'Rydder ferdig' },
      { value: 'tar_unna_klesvask', label: 'Tar unna klesvask' },
      { value: 'starter_for_det_haster', label: 'Starter før det haster' },
      { value: 'tar_vanskelig_beskjed', label: 'Tar vanskelig beskjed' },
    ]
  },
  5: {
    title: 'Overskudd',
    description: 'Tar initiativ som gir noe tilbake',
    signals: [
      { value: 'tar_initiativ', label: 'Tar initiativ' },
      { value: 'utfordrer', label: 'Utfordrer seg' },
      { value: 'skaper', label: 'Skaper' },
      { value: 'gir_av_seg', label: 'Gir av seg selv' },
      { value: 'gir_full_oppmerksomhet', label: 'Gir full oppmerksomhet' },
      { value: 'leder_an', label: 'Leder an' },
      { value: 'star_i_det', label: 'Står i det' },
      { value: 'trener_ambisiost', label: 'Trener ambisiøst' },
      { value: 'lager_system', label: 'Lager system' },
      { value: 'organiserer', label: 'Organiserer' },
      { value: 'forenkler', label: 'Forenkler' },
      { value: 'bygger_rutine', label: 'Bygger rutine' },
    ]
  }
};

// ── Følelser ─────────────────────────────────────────────────────────────

export const FEELINGS_PYRAMID: Record<number, PyramidLevel> = {
  1: {
    title: 'Oversvømmelse',
    description: 'Følelsene tar over / lite filter',
    signals: [
      { value: 'rasende', label: 'Rasende' },
      { value: 'haplos', label: 'Håpløs' },
      { value: 'desperat', label: 'Desperat' },
      { value: 'apatisk', label: 'Apatisk' },
      { value: 'panisk', label: 'Panisk' },
      { value: 'nummen', label: 'Nummen' },
      { value: 'ute_av_meg', label: 'Ute av meg' },
      { value: 'overgiret', label: 'Overgiret' },
      { value: 'virkelighetsfjern', label: 'Virkelighetsfjern' },
      { value: 'mistenksom', label: 'Mistenksom' },
    ]
  },
  2: {
    title: 'Tyngde',
    description: 'Det er tungt men du er tilstede',
    signals: [
      { value: 'trist', label: 'Trist' },
      { value: 'skuffet', label: 'Skuffet' },
      { value: 'overveldet', label: 'Overveldet' },
      { value: 'ensom', label: 'Ensom' },
      { value: 'likegyldig', label: 'Likegyldig' },
      { value: 'tung', label: 'Tung' },
      { value: 'frustrert', label: 'Frustrert' },
      { value: 'kort_lunte', label: 'Kort lunte' },
      { value: 'ubalansert', label: 'Ubalansert' },
      { value: 'sarbar', label: 'Sårbar' },
      { value: 'stresset', label: 'Stresset' },
    ]
  },
  3: {
    title: 'Jevnt',
    description: 'Ikke sterke følelser / stabilt',
    signals: [
      { value: 'ok', label: 'OK' },
      { value: 'greit', label: 'Greit' },
      { value: 'flat', label: 'Flat' },
      { value: 'noytral', label: 'Nøytral' },
      { value: 'stabil', label: 'Stabil' },
      { value: 'avventende', label: 'Avventende' },
    ]
  },
  4: {
    title: 'Varme',
    description: 'Positive følelser som gir energi',
    signals: [
      { value: 'glad', label: 'Glad' },
      { value: 'tilfreds', label: 'Tilfreds' },
      { value: 'takknemlig', label: 'Takknemlig' },
      { value: 'trygg', label: 'Trygg' },
      { value: 'nysgjerrig', label: 'Nysgjerrig' },
      { value: 'lettet', label: 'Lettet' },
      { value: 'stolt', label: 'Stolt' },
    ]
  },
  5: {
    title: 'Forankring',
    description: 'Dype bærende følelser',
    signals: [
      { value: 'balansert', label: 'Balansert' },
      { value: 'robust', label: 'Robust' },
      { value: 'empatisk', label: 'Empatisk' },
      { value: 'kjaerlig', label: 'Kjærlig' },
      { value: 'inspirert', label: 'Inspirert' },
      { value: 'sterk', label: 'Sterk' },
    ]
  }
};

// ── Tanker ───────────────────────────────────────────────────────────────

export const THOUGHTS_PYRAMID: Record<number, PyramidLevel> = {
  1: {
    title: 'Kaos',
    description: 'Tankene styrer deg / ikke omvendt',
    signals: [
      { value: 'kverner', label: 'Kverner' },
      { value: 'katastroferer', label: 'Katastroferer' },
      { value: 'spinner_ut', label: 'Spinner ut' },
      { value: 'mister_oversikt', label: 'Mister oversikt' },
      { value: 'klarer_ikke_stoppe', label: 'Klarer ikke stoppe' },
      { value: 'alt_haster', label: 'Alt haster' },
      { value: 'kobler_ut', label: 'Kobler ut' },
    ]
  },
  2: {
    title: 'Grums',
    description: 'Tankene er tunge og gjentakende',
    signals: [
      { value: 'grubler', label: 'Grubler' },
      { value: 'bekymrer', label: 'Bekymrer' },
      { value: 'selvkritiserer', label: 'Selvkritiserer' },
      { value: 'sammenligner', label: 'Sammenligner' },
      { value: 'noler', label: 'Nøler' },
      { value: 'leter_etter_feil', label: 'Leter etter feil' },
      { value: 'hjernetake', label: 'Hjernetåke' },
      { value: 'prosederer', label: 'Prosederer' },
      { value: 'forsvarer_meg', label: 'Forsvarer meg' },
    ]
  },
  3: {
    title: 'Sortering',
    description: 'Tankene er i gang med å rydde',
    signals: [
      { value: 'sorterer', label: 'Sorterer' },
      { value: 'avklarer', label: 'Avklarer' },
      { value: 'prosesserer', label: 'Prosesserer' },
      { value: 'vurderer', label: 'Vurderer' },
      { value: 'navngir', label: 'Navngir' },
      { value: 'ser_monster', label: 'Ser mønster' },
      { value: 'prioriterer', label: 'Prioriterer' },
    ]
  },
  4: {
    title: 'Klarhet',
    description: 'Du tenker med retning',
    signals: [
      { value: 'reflekterer', label: 'Reflekterer' },
      { value: 'fokuserer_tanker', label: 'Fokuserer' },
      { value: 'kobler', label: 'Kobler' },
      { value: 'utforsker', label: 'Utforsker' },
      { value: 'forstar', label: 'Forstår' },
      { value: 'loser', label: 'Løser' },
    ]
  },
  5: {
    title: 'Horisont',
    description: 'Du ser fremover med ro',
    signals: [
      { value: 'planlegger', label: 'Planlegger' },
      { value: 'forbereder', label: 'Forbereder' },
      { value: 'ser_neste_steg', label: 'Ser neste steg' },
      { value: 'visualiserer', label: 'Visualiserer' },
      { value: 'samler_tradene', label: 'Samler trådene' },
      { value: 'ser_helhet', label: 'Ser helhet' },
    ]
  }
};

// ── Slider-labels (title — description) ─────────────────────────────────

function buildSliderLabels(pyramid: Record<number, PyramidLevel>): Record<number, string> {
  const labels: Record<number, string> = {};
  for (const [level, data] of Object.entries(pyramid)) {
    labels[Number(level)] = `${data.title} — ${data.description}`;
  }
  return labels;
}

export const ACTIONS_SLIDER_LABELS = buildSliderLabels(ACTIONS_PYRAMID);
export const FEELINGS_SLIDER_LABELS = buildSliderLabels(FEELINGS_PYRAMID);
export const THOUGHTS_SLIDER_LABELS = buildSliderLabels(THOUGHTS_PYRAMID);

export const BALANCE_LABELS: Record<number, string> = {
  [-5]: 'Veldig tomt',
  [-4]: 'Tappet',
  [-3]: 'Underskudd',
  [-2]: 'Sliten',
  [-1]: 'Litt tung',
  0: 'Nøytralt',
  1: 'Litt lettere',
  2: 'Grei dag',
  3: 'Overskudd',
  4: 'Energisk',
  5: 'Strålende fullt'
};

// ── Pyramid helpers ─────────────────────────────────────────────────────

export function getPyramidGroups(
  pyramid: Record<number, PyramidLevel>,
  activeLevel: number,
  extras?: SignalOption[]
): PyramidOptionGroup[] {
  const groups: PyramidOptionGroup[] = [];

  for (const [level, data] of Object.entries(pyramid)) {
    const lvl = Number(level);
    groups.push({
      label: `${data.title} — ${data.description}`,
      isActive: lvl === activeLevel,
      options: data.signals
    });
  }

  if (extras?.length) {
    groups.push({
      label: 'Fra din kontekst',
      isActive: false,
      options: extras
    });
  }

  return groups;
}

// ── Legacy exports (used by dashboard, checkin, etc.) ────────────────────

export const ACTION_PYRAMID_LABELS: Record<number, string> = ACTIONS_SLIDER_LABELS;
export const THOUGHTS_LABELS: Record<number, string> = buildSliderLabels(THOUGHTS_PYRAMID);
export const FEELINGS_LABELS: Record<number, string> = buildSliderLabels(FEELINGS_PYRAMID);

// ── Thresholds ──────────────────────────────────────────────────────────

export interface EgenfrekvensCheckinValues {
  balance: number;
  thoughts: number;
  feelings: number;
  actions: number;
}

export const EGENFREKVENS_THRESHOLDS = {
  reflectIf(data: EgenfrekvensCheckinValues): boolean {
    return (
      data.balance <= -3 ||
      data.actions <= 1 ||
      data.feelings <= 1 ||
      data.feelings >= 5 ||
      data.thoughts <= 1 ||
      data.thoughts >= 5
    );
  }
};

// ── Trigger helpers ─────────────────────────────────────────────────────

export function isEgenfrekvensTrigger(input: string): boolean {
  return EGENFREKVENS_TRIGGERS.test(input);
}

export function isEgenfrekvensThemeName(input: { name: string; parentTheme?: string | null }): boolean {
  if (input.parentTheme === EGENFREKVENS_PARENT_THEME_NAME) return true;
  return EGENFREKVENS_THEME_NAME_TRIGGERS.test(input.name);
}

export function isValidEgenfrekvensMetric(value: string): value is EgenfrekvensMetric {
  return value in EGENFREKVENS_METRICS;
}

export const EGENFREKVENS_DOMAIN_PROMPT = `
**EGENFREKVENS DOMAIN FOCUS:**
- Bruker utforsker selvinnsikt: handlinger, følelser, tanker, balanse
- Tilby kort sjekkin-flyt (egenfrekvens_checkin) før dyp samtale når det er naturlig
- Hvis utslag i sjekkin: kort, varm refleksjon — ett spørsmål av gangen, aldri lange monologer
- Bruk varm, ikke-klinisk tone. Aldri "diagnose"-språk
`;
