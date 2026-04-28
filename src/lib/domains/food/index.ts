// Food Domain — Mat-spesifikke semantikker for oppskrifter, måltidsplaner og pantry

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type FoodCategory = 'recipe' | 'mealPlan' | 'pantry' | 'shoppingList';

export type PantryLocation = 'pantry' | 'fridge' | 'freezer';

export const MEAL_TYPES: Record<MealType, { label: string; emoji: string }> = {
  breakfast: { label: 'Frokost', emoji: '🥣' },
  lunch: { label: 'Lunsj', emoji: '🥪' },
  dinner: { label: 'Middag', emoji: '🍽️' },
  snack: { label: 'Mellommåltid', emoji: '🍎' }
};

export const PANTRY_LOCATIONS: Record<PantryLocation, { label: string; emoji: string }> = {
  pantry: { label: 'Skap', emoji: '🥫' },
  fridge: { label: 'Kjøleskap', emoji: '❄️' },
  freezer: { label: 'Fryser', emoji: '🧊' }
};

export const MEAL_TYPE_TRIGGERS: Record<MealType, RegExp> = {
  breakfast: /frokost|breakfast|morgenmat|grøt/i,
  lunch: /lunsj|lunch|matpakke|lunch ?box/i,
  dinner: /middag|dinner|kveldsmat|aftensmat/i,
  snack: /snack|mellommåltid|frukt|kveldsmat|natt ?mat/i
};

export const FOOD_CATEGORY_TRIGGERS: Record<FoodCategory, RegExp> = {
  recipe: /oppskrift|recipe|matlaging|tilberede|stek|kok|bake/i,
  mealPlan: /ukemeny|middagsplan|meny|måltidsplan|matplan|ukens? meny/i,
  pantry: /pantry|skap|kjøleskap|kjoleskap|fryser|freezer|hva har jeg|i fryseren|i skapet/i,
  shoppingList: /handleliste|handle ?lis|innkjøp|innkjop|trenger å kjøpe|må handle/i
};

// Query helper for food data — bestemmer hvilken type spørring som skal gjøres
export function buildFoodQueryParams(category: FoodCategory, weekContext?: string) {
  switch (category) {
    case 'mealPlan':
      return { queryType: 'meal_plan' as const, weekContext };
    case 'pantry':
      return { queryType: 'pantry' as const };
    case 'recipe':
      return { queryType: 'recipes' as const, limit: 50 };
    case 'shoppingList':
      return { queryType: 'shopping_list' as const, weekContext };
  }
}

// System prompt hints for food domain
export const FOOD_DOMAIN_PROMPT = `
**FOOD DOMAIN FOCUS:**
- Bruker spør om mat, middag, ukemeny, oppskrifter eller skap-/fryserinnhold
- Bruk query_food for å lese eksisterende ukemeny, oppskrifter og pantry
- Bruk manage_recipe, manage_meal_plan, manage_pantry for å lagre endringer
- Bruk generate_shopping_list for å bygge handleliste fra ukemeny minus pantry
- Bruk analyze_meal_image hvis bruker laster opp matbilde og vil ha estimat av rett/næring
- Foreslå handleliste når ukemeny endres
- Vær konkret om porsjoner og tilberedningstid
- Når bruker beskriver enkel matplan ("fisk til middag"), foreslå oppskrift, sjekk pantry og bygg handleliste i samme svar
`;

// Validation rules
export function isValidMealType(value: string): value is MealType {
  return value in MEAL_TYPES;
}

export function isValidPantryLocation(value: string): value is PantryLocation {
  return value in PANTRY_LOCATIONS;
}

export function detectMealType(input: string): MealType | null {
  for (const [type, pattern] of Object.entries(MEAL_TYPE_TRIGGERS)) {
    if (pattern.test(input)) {
      return type as MealType;
    }
  }
  return null;
}

export function detectFoodCategory(input: string): FoodCategory | null {
  for (const [category, pattern] of Object.entries(FOOD_CATEGORY_TRIGGERS)) {
    if (pattern.test(input)) {
      return category as FoodCategory;
    }
  }
  return null;
}

export const ALL_MEAL_TYPES = Object.keys(MEAL_TYPES) as MealType[];
export const ALL_PANTRY_LOCATIONS = Object.keys(PANTRY_LOCATIONS) as PantryLocation[];
