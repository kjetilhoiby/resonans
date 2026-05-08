// Egenfrekvens Domain — Selvinnsikt: humør, tanker, følelser, handlinger, refleksjon

export type EgenfrekvensMetric = 'balance' | 'thoughts' | 'feelings' | 'actions';

export const EGENFREKVENS_METRICS: Record<
  EgenfrekvensMetric,
  { label: string; range: [number, number]; direction: 'higher_better' | 'context' }
> = {
  balance: { label: 'Balanse', range: [-5, 5], direction: 'higher_better' },
  thoughts: { label: 'Tanker', range: [0, 5], direction: 'context' },
  feelings: { label: 'Følelser', range: [0, 5], direction: 'context' },
  actions: { label: 'Handlinger', range: [0, 5], direction: 'higher_better' }
};

/** Generelle triggere for at chat dreier seg om egenfrekvens */
export const EGENFREKVENS_TRIGGERS =
  /egenfrekvens|psykisk\s*helse|mental\s*helse|stress|følelser?|tanker|humør|innsjekk|sjekkin|overskudd|underskudd|reflek/i;

/** Strengere mønster for tema-navn — krever en kvalifikator (psykisk/mental/etc) for å unngå at "helse" alene matcher. */
export const EGENFREKVENS_THEME_NAME_TRIGGERS =
  /psykisk\s*helse|mental\s*helse|stress|følelser?|humør|stemning/i;

export const EGENFREKVENS_PARENT_THEME_NAME = 'Egenfrekvens';

/** Anker-labels for handlings-pyramiden. Vises som hjelpetekst under slideren. */
export const ACTION_PYRAMID_LABELS: Record<number, string> = {
  0: 'Scroller endeløst / passiv konsum',
  1: 'Litt tilstede, men dragning mot lett distraksjon',
  2: 'Ordner småting (rydder en ting, går en runde)',
  3: 'Gjør oppvasken / tar i et tak hjemme',
  4: 'Gjør noe litt krevende (trening, prosjektarbeid)',
  5: 'Tar sosialt eller emosjonelt krevende oppgaver'
};

export const BALANCE_LABELS: Record<number, string> = {
  [-5]: 'Veldig tomt',
  [-3]: 'Underskudd',
  0: 'Nøytralt',
  3: 'Overskudd',
  5: 'Strålende fullt'
};

export interface EgenfrekvensCheckinValues {
  balance: number;
  thoughts: number;
  feelings: number;
  actions: number;
}

export const EGENFREKVENS_THRESHOLDS = {
  /** Trigger refleksjons-step hvis utslag */
  reflectIf(data: EgenfrekvensCheckinValues): boolean {
    return (
      data.balance <= -3 ||
      data.thoughts <= 1 ||
      data.thoughts >= 4 ||
      data.feelings <= 1 ||
      data.feelings >= 4 ||
      data.actions <= 1
    );
  }
};

export function isEgenfrekvensTrigger(input: string): boolean {
  return EGENFREKVENS_TRIGGERS.test(input);
}

export function isEgenfrekvensThemeName(input: { name: string; parentTheme?: string | null }): boolean {
  if (input.parentTheme === EGENFREKVENS_PARENT_THEME_NAME) return true;
  return EGENFREKVENS_THEME_NAME_TRIGGERS.test(input.name);
}

export const EGENFREKVENS_DOMAIN_PROMPT = `
**EGENFREKVENS DOMAIN FOCUS:**
- Bruker utforsker selvinnsikt: humør, tanker, følelser, handlinger, overskudd/underskudd
- Tilby kort sjekkin-flyt (egenfrekvens_checkin) før dyp samtale når det er naturlig
- Hvis utslag i sjekkin: kort, varm refleksjon — ett spørsmål av gangen, aldri lange monologer
- Bruk varm, ikke-klinisk tone. Aldri "diagnose"-språk
`;

export function isValidEgenfrekvensMetric(value: string): value is EgenfrekvensMetric {
  return value in EGENFREKVENS_METRICS;
}
