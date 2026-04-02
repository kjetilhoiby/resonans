// Domains Layer — Domain-spesifikke semantikker, valideringer og hjelperfunksjoner

export * from './health/index';
export * from './economics/index';

export type DomainType = 'health' | 'economics';

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
  
  return null;
}
