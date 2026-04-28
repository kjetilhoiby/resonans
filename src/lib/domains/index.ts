// Domains Layer — Domain-spesifikke semantikker, valideringer og hjelperfunksjoner

export * from './health/index';
export * from './economics/index';
export * from './food/index';

export type DomainType = 'health' | 'economics' | 'food';

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
  }
};

export function resolveDomainFromInput(input: string): DomainType | null {
  const text = input.toLowerCase();

  if (/sovn|søvn|vekt|steg|trening|workout|withings|helse|gym|fitness|puls|mood|humør|screen.?time|skjermtid/.test(text)) {
    return 'health';
  }

  if (/okonomi|økonomi|forbruk|saldo|bank|transaksjon|lonn|lønn|sparebank|inntekt|utgift|konto/.test(text)) {
    return 'economics';
  }

  if (/mat|middag|frokost|lunsj|matpakke|oppskrift|recipe|pantry|fryser|kjøleskap|kjoleskap|skap|handleliste|kjokken|kjøkken|måltid|maltid|ukemeny|meny/.test(text)) {
    return 'food';
  }

  return null;
}
