// Economics Domain — Økonomi-spesifikke semantikker og kategorier

export type EconomicsMetric = 'amount' | 'balance';

export type SpendingCategory = 
  | 'dagligvare'
  | 'mat'
  | 'bolig'
  | 'transport'
  | 'helse'
  | 'abonnement'
  | 'underholdning'
  | 'shopping'
  | 'barn'
  | 'forsikring'
  | 'sparing'
  | 'overføring'
  | 'lønn'
  | 'annet';

export const SPENDING_CATEGORIES: Record<SpendingCategory, { label: string; emoji: string }> = {
  dagligvare: { label: 'Dagligvare', emoji: '🛒' },
  mat: { label: 'Mat & Restaurant', emoji: '🍽️' },
  bolig: { label: 'Bolig & Leiligst', emoji: '🏠' },
  transport: { label: 'Transport', emoji: '🚗' },
  helse: { label: 'Helse & Wellness', emoji: '💪' },
  abonnement: { label: 'Abonnement', emoji: '🔄' },
  underholdning: { label: 'Underholdning', emoji: '🎬' },
  shopping: { label: 'Shopping', emoji: '👕' },
  barn: { label: 'Barn', emoji: '👶' },
  forsikring: { label: 'Forsikring', emoji: '🛡️' },
  sparing: { label: 'Sparing', emoji: '💰' },
  overføring: { label: 'Overføringer', emoji: '↔️' },
  lønn: { label: 'Lønn', emoji: '💵' },
  annet: { label: 'Annet', emoji: '📦' }
};

export const SPENDING_CATEGORY_TRIGGERS: Record<SpendingCategory, RegExp> = {
  dagligvare: /dagligvare|kiwi|coop|extra|narvesen/i,
  mat: /mat|spise|restaurant|pizza|burger|kafe|kaffe|frokost|lunch|middag/i,
  bolig: /bolig|husleie|leiligst|leie|boliglan|tomt|hus/i,
  transport: /transport|kjørte|kjøring|bensin|diesel|tog|buss|taxi|parkering|bilkoster/i,
  helse: /helse|lege|tannlege|apotek|yoga|gym|fitness|trening|massage|behandling/i,
  abonnement: /abonnement|spotify|netflix|hbo|nrk.no|streaming|tjeneste|medlemskap/i,
  underholdning: /underholdning|kino|teater|konsert|billett|event|show|byo/i,
  shopping: /shopping|klær|tøy|sko|kjøp|amazon|ebay|butikk|fashion|dress/i,
  barn: /barn|barna|barnepass|barnehage|skole|leker|utstyr|babysitter/i,
  forsikring: /forsikring|innbo|fritid|reise|aktivitet|dekning/i,
  sparing: /sparing|spare|konto|investering|sparekonto/i,
  overføring: /overføring|betaling|vipps|transfer|til|fra konto/i,
  lønn: /lønn|lønning|inntekt|salary|income/i,
  annet: /annet|diverse|sjøl/i
};

export const ECONOMICS_METRICS: Record<EconomicsMetric, { label: string; unit: string; direction: 'lower_better' | 'higher_better' }> = {
  amount: { label: 'Forbruk', unit: 'kr', direction: 'lower_better' },
  balance: { label: 'Saldo', unit: 'kr', direction: 'higher_better' }
};

// Query helper for economic data
export function buildEconomicsQueryParams(metric: EconomicsMetric, timeframe: 'current' | 'month' | 'year' | 'latest') {
  if (metric === 'balance') {
    return {
      queryType: 'balance' as const,
      sortBy: 'date' as const
    };
  }

  // For amount (spending)
  return {
    queryType: 'spending_summary' as const,
    payPeriod: timeframe === 'current' ? 'current' : undefined,
    month: timeframe === 'month' ? getCurrentMonthString() : undefined,
    limit: 50
  };
}

function getCurrentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// System prompt hints for economics domain
export const ECONOMICS_DOMAIN_PROMPT = `
**ECONOMICS DOMAIN FOCUS:**
- Bruker spør om økonomi, forbruk, konto-saldo, utgifter eller inntekt
- Hent ALLTID live bank-data med query_economics før du svarer
- Fokuser på spending patterns og budsjett-progress
- Foreslå forbruk-widget hvis bruker vil spore utgifter per kategori
- Bruk økonomi-temaet for kontekst (hukommelse av tidligere økonomi-mål)
- Gyldig kategori-filter for amount-widget: dagligvare, mat, bolig, transport, helse, abonnement, underholdning, shopping, barn, forsikring, sparing, overføring, lønn, annet
`;

// Validation rules
export function isValidSpendingCategory(value: string): value is SpendingCategory {
  return value in SPENDING_CATEGORIES;
}

export function detectSpendingCategory(input: string): SpendingCategory | null {
  for (const [category, pattern] of Object.entries(SPENDING_CATEGORY_TRIGGERS)) {
    if (pattern.test(input)) {
      return category as SpendingCategory;
    }
  }
  return null;
}

export const ALL_VALID_CATEGORIES = Object.keys(SPENDING_CATEGORIES) as SpendingCategory[];
