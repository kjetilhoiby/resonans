// Domains Layer — Domain-spesifikke semantikker, valideringer og hjelperfunksjoner

export * from './health/index';
export * from './economics/index';
export * from './food/index';
export * from './family/index';
export * from './family/family-tree';
export * from './egenfrekvens/index';
export * from './home/index';
export * from './jobb/index';

import { FAMILY_DOMAIN_TRIGGER } from './family/index';
import { HOME_DOMAIN_TRIGGER } from './home/index';
import { JOBB_DOMAIN_TRIGGER } from './jobb/index';

export type DomainType = 'health' | 'economics' | 'food' | 'family' | 'self' | 'home' | 'jobb';

export interface DomainMetadata {
  type: DomainType;
  label: string;
  description: string;
  systemPromptHint: string;
}

export const DOMAIN_METADATA: Record<DomainType, DomainMetadata> = {
  health: {
    type: 'health',
    label: 'Helse',
    description: 'Helse-metrikker som søvn, vekt, øvelse og treningsøkter',
    systemPromptHint: 'Brukeren fokuser på helse-data. Hent live sensor-data. Foreslå helse-widgets.'
  },
  economics: {
    type: 'economics',
    label: 'Økonomi',
    description: 'Økonomi-data som forbruk, saldo og transaksjoner',
    systemPromptHint: 'Brukeren fokuser på økonomi-data. Hent live bank-data. Foreslå forbruk-widgets med kategorifilter.'
  },
  food: {
    type: 'food',
    label: 'Mat',
    description: 'Middagsplaner, oppskrifter, handlelister og oversikt over skap/fryser',
    systemPromptHint: 'Brukeren fokuser på mat: ukemeny, oppskrifter, pantry. Bruk query_food, manage_meal_plan, manage_pantry, generate_shopping_list. Foreslå konkret oppskrift og handleliste.'
  },
  family: {
    type: 'family',
    label: 'Familie',
    description: 'Familie og nære relasjoner — barn, partner, foreldre, svigerfamilie og venner',
    systemPromptHint: 'Brukeren fokuser på familie/relasjoner. Bruk query_family og manage_person. Lagre observasjoner som memory med personId. Foreslå mål og oppgaver knyttet til en person.'
  },
  self: {
    type: 'self',
    label: 'Selv',
    description: 'Selvinnsikt: identitet, verdier, indre tilstand, refleksjon. Egenfrekvens-sjekkin (humør, tanker, følelser, handlinger) er ett verktøy under dette domenet.',
    systemPromptHint: 'Brukeren utforsker seg selv — identitet, verdier, indre tilstand. Tilby egenfrekvens-sjekkin når det handler om humør/energi/stress. Bruk varm, ikke-klinisk tone.'
  },
  home: {
    type: 'home',
    label: 'Hus og hjem',
    description: 'Hus-prosjekter, husarbeids-rutiner, sesong-oppgaver og hjem-apparater',
    systemPromptHint: 'Brukeren fokuserer på hjem og bolig. Bruk query_home og manage_project (domain=home). Foreslå sjekkliste for sesong-oppgaver eller rutiner. Bruk apparat-sensor-data ved spørsmål om vask/oppvask.'
  },
  jobb: {
    type: 'jobb',
    label: 'Jobb & Karriere',
    description: 'Prosjekter, oppgaver, prioritering, fokustimer og karriereutvikling',
    systemPromptHint: 'Brukeren fokuserer på jobb og karriere. Bruk manage_project (domain=jobb) og create_task. Hjelp med å bryte ned og prioritere oppgaver. Foreslå fokustimer for konsentrert arbeid.'
  }
};

export function resolveDomainFromInput(input: string): DomainType | null {
  const text = input.toLowerCase();

  if (FAMILY_DOMAIN_TRIGGER.test(text)) {
    return 'family';
  }

  if (HOME_DOMAIN_TRIGGER.test(text)) {
    return 'home';
  }

  if (JOBB_DOMAIN_TRIGGER.test(text)) {
    return 'jobb';
  }

  if (/sovn|søvn|vekt|steg|trening|workout|withings|helse|gym|fitness|puls|mood|humør|screen.?time|skjermtid/.test(text)) {
    return 'health';
  }

  if (/okonomi|økonomi|forbruk|saldo|bank|transaksjon|lonn|lønn|sparebank|inntekt|utgift|konto/.test(text)) {
    return 'economics';
  }

  if (/mat|middag|frokost|lunsj|matpakke|oppskrift|recipe|pantry|fryser|kjøleskap|kjoleskap|skap|handleliste|kjokken|kjøkken|måltid|maltid|ukemeny|meny/.test(text)) {
    return 'food';
  }

  if (/egenfrekvens|psykisk\s*helse|mental\s*helse|stress|overskudd|underskudd|innsjekk|sjekkin|reflek|identitet|verdier|selvfølelse|selvbilde|hvem er jeg|formål|meningsfull/.test(text)) {
    return 'self';
  }

  return null;
}
