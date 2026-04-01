// Health Domain — Helse-spesifikke semantikker og metrikktyper

export type HealthMetric = 
  | 'weight' 
  | 'sleepDuration' 
  | 'steps' 
  | 'distance' 
  | 'workoutCount' 
  | 'heartrate' 
  | 'mood' 
  | 'screenTime';

export const HEALTH_METRICS: Record<HealthMetric, { label: string; unit: string; direction: 'lower_better' | 'higher_better' }> = {
  weight: { label: 'Vekt', unit: 'kg', direction: 'lower_better' },
  sleepDuration: { label: 'Søvn', unit: 'timer', direction: 'higher_better' },
  steps: { label: 'Steg', unit: 'steg', direction: 'higher_better' },
  distance: { label: 'Løpedistanse', unit: 'km', direction: 'higher_better' },
  workoutCount: { label: 'Treningsøkter', unit: 'økter', direction: 'higher_better' },
  heartrate: { label: 'Puls', unit: 'bpm', direction: 'lower_better' },
  mood: { label: 'Humør', unit: 'score', direction: 'higher_better' },
  screenTime: { label: 'Skjermtid', unit: 'minutter', direction: 'lower_better' }
};

export const HEALTH_METRIC_TRIGGERS: Record<HealthMetric, RegExp> = {
  weight: /vekt|kg|weight/i,
  sleepDuration: /sovn|søvn|sleep|timer|hours/i,
  steps: /steg|steps|skritt|gange|walking/i,
  distance: /distanse|distance|km|Running|løping|running/i,
  workoutCount: /workout|treningsøkt|training|gym|exercise|trening/i,
  heartrate: /puls|heart rate|hjerterytme|heartrate|hrv|bpm/i,
  mood: /humør|mood|feeling|følelse|emotion|emosjon/i,
  screenTime: /skjermtid|screen time|skjerm|tíme på mobil/i
};

// Query helper for sensor data
export function buildHealthQueryParams(metric: HealthMetric, timeframe: 'latest' | 'week' | 'month' | 'year' | 'month_summary' | 'year_summary') {
  const queryType = timeframe === 'latest' ? 'latest' : (timeframe.includes('summary') ? 'period_summary' : 'trend');
  const period = timeframe === 'latest' ? 'week' : (timeframe === 'month_summary' ? undefined : timeframe === 'year_summary' ? undefined : (timeframe === 'month' ? 'month' : timeframe === 'year' ? 'year' : 'week'));
  
  return {
    queryType,
    period,
    metric: mapWidgetMetricToSensorMetric(metric),
    limit: timeframe === 'latest' ? 1 : (timeframe === 'month' ? 4 : timeframe === 'year' ? 12 : 2)
  };
}

function mapWidgetMetricToSensorMetric(metric: HealthMetric): 'weight' | 'steps' | 'sleep' | 'intense_minutes' | 'heartrate' | 'workouts' | 'all' {
  const mapping: Record<HealthMetric, 'weight' | 'steps' | 'sleep' | 'intense_minutes' | 'heartrate' | 'workouts' | 'all'> = {
    weight: 'weight',
    sleepDuration: 'sleep',
    steps: 'steps',
    distance: 'workouts', // distance comes from workout data
    workoutCount: 'workouts',
    heartrate: 'heartrate',
    mood: 'all', // mood requires custom recording
    screenTime: 'all' // screenTime requires custom recording
  };
  return mapping[metric];
}

// System prompt hints for health domain
export const HEALTH_DOMAIN_PROMPT = `
**HEALTH DOMAIN FOCUS:**
- Bruker spør om helse-metrikker (vekt, søvn, steg, treningsøkter, etc.)
- Hent ALLTID live sensor-data med query_sensor_data før du svarer
- Fokuser på trender, ikke isolerte målinger
- Foreslå widget hvis bruker vil følge metrikk over tid
- Bruk helse-temaet for kontekst (hukommelse av tidligere helse-mål)
`;

// Validation rules
export function isValidHealthMetric(value: string): value is HealthMetric {
  return value in HEALTH_METRICS;
}

export function detectHealthMetric(input: string): HealthMetric | null {
  for (const [metric, pattern] of Object.entries(HEALTH_METRIC_TRIGGERS)) {
    if (pattern.test(input)) {
      return metric as HealthMetric;
    }
  }
  return null;
}
