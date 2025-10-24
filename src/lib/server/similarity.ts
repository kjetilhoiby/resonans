/**
 * Enkel tekstlikhet-sjekker for å finne duplikater av mål og oppgaver
 */

/**
 * Beregn Levenshtein distance mellom to strenger (edit distance)
 */
function levenshteinDistance(str1: string, str2: string): number {
	const s1 = str1.toLowerCase();
	const s2 = str2.toLowerCase();
	
	const matrix: number[][] = [];

	for (let i = 0; i <= s2.length; i++) {
		matrix[i] = [i];
	}

	for (let j = 0; j <= s1.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= s2.length; i++) {
		for (let j = 1; j <= s1.length; j++) {
			if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j - 1] + 1, // substitution
					matrix[i][j - 1] + 1,     // insertion
					matrix[i - 1][j] + 1      // deletion
				);
			}
		}
	}

	return matrix[s2.length][s1.length];
}

/**
 * Beregn similarity score (0-100%) mellom to strenger
 */
export function calculateSimilarity(str1: string, str2: string): number {
	const maxLength = Math.max(str1.length, str2.length);
	if (maxLength === 0) return 100;
	
	const distance = levenshteinDistance(str1, str2);
	return ((maxLength - distance) / maxLength) * 100;
}

/**
 * Sjekk om to strenger er semantisk like (ordrekkefølge-uavhengig)
 */
export function areSemanticallySimilar(str1: string, str2: string, threshold = 70): boolean {
	// Direkte likhet
	const directSimilarity = calculateSimilarity(str1, str2);
	if (directSimilarity >= threshold) return true;

	// Sjekk ordinnhold (for å fange opp forskjell i ordrekkefølge)
	const words1 = str1.toLowerCase().split(/\s+/).sort();
	const words2 = str2.toLowerCase().split(/\s+/).sort();
	
	const wordSimilarity = calculateSimilarity(words1.join(' '), words2.join(' '));
	if (wordSimilarity >= threshold) return true;

	// Sjekk nøkkelord-overlapp
	const uniqueWords1 = new Set(words1.filter(w => w.length > 3)); // Ignorer korte ord
	const uniqueWords2 = new Set(words2.filter(w => w.length > 3));
	
	const intersection = new Set([...uniqueWords1].filter(x => uniqueWords2.has(x)));
	const union = new Set([...uniqueWords1, ...uniqueWords2]);
	
	if (union.size === 0) return false;
	
	const jaccardSimilarity = (intersection.size / union.size) * 100;
	return jaccardSimilarity >= (threshold * 0.8); // Litt lavere threshold for Jaccard
}

/**
 * Finn lignende strenger i en liste
 */
export function findSimilar<T>(
	query: string,
	items: T[],
	getText: (item: T) => string,
	threshold = 70
): Array<{ item: T; similarity: number }> {
	return items
		.map(item => ({
			item,
			similarity: calculateSimilarity(query, getText(item))
		}))
		.filter(({ similarity }) => similarity >= threshold)
		.sort((a, b) => b.similarity - a.similarity);
}
