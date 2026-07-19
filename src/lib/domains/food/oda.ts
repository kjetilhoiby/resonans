// Oda-hjelpere — bygger søkelenker og kopierbar tekst fra handlelister.
// Oda har ingen offentlig bestillings-API; koblingen er søkelenker per vare
// slik at handlekurven kan fylles raskt manuelt.

export type ShoppingListItemLike = {
	name: string;
	quantity?: number | null;
	unit?: string | null;
	checked?: boolean;
};

/**
 * Normalisert varenavn for dedup og kvitteringsmatching: lowercase, trimmet,
 * uten MENGDE-parenteser. Kun parenteser som inneholder sifre strippes —
 * «kjøttdeig (400 g)» → «kjøttdeig», men «melk (laktosefri)» og
 * «paprika (rød)» beholder kvalifikatoren og forblir distinkte varer.
 */
export function normalizeIngredientName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\([^)]*\d[^)]*\)/g, ' ') // kun mengde-parenteser («(400 g)», «(2 stk)»)
		.replace(/\s+/g, ' ')
		.trim();
}

/** Rens et ingrediensnavn for Oda-søk: fjern mengder/parenteser som gir null treff. */
export function cleanIngredientNameForSearch(name: string): string {
	return normalizeIngredientName(name)
		.replace(/\b\d+([.,]\d+)?\s*(g|kg|dl|l|ml|stk|pk|boks|pose|ss|ts)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Klikkbar Oda-søkelenke for en vare. */
export function odaSearchUrl(name: string): string {
	const q = cleanIngredientNameForSearch(name);
	return `https://oda.com/no/search/?q=${encodeURIComponent(q)}`;
}

/** Handleliste som klartekst for utklippstavla — én vare per linje. */
export function shoppingListToPlainText(items: ShoppingListItemLike[]): string {
	return items
		.filter((item) => !item.checked)
		.map((item) => {
			const qty =
				item.quantity != null && item.unit
					? `${formatQuantity(item.quantity)} ${item.unit} `
					: item.quantity != null
						? `${formatQuantity(item.quantity)} `
						: '';
			return `- ${qty}${item.name}`;
		})
		.join('\n');
}

function formatQuantity(qty: number): string {
	return Number.isInteger(qty) ? String(qty) : qty.toFixed(1).replace('.', ',');
}
