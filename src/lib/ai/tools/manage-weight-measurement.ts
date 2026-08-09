/**
 * «Slett målingen fra 10. august 2018» — i chatten.
 *
 * ## Hvorfor slettingen ikke tar en dato
 *
 * Det opplagte designet er `slett(dato)`. Det er også det farlige: en modell som
 * mistolker «i går» eller plukker feil årstall sletter da en ekte veiing, og en
 * sensorrad kan ikke angres fra flaten.
 *
 * Derfor to steg, der steg to krever noe steg én ga: `find` returnerer målingene på
 * datoen med hver sin `id`, og `delete` tar **bare en id**. En modell som ikke har
 * slått opp har ingen gyldig id å sende, og en oppdiktet uuid treffer ingen rad. Det
 * gjør bekreftelsesdialogen til en konsekvens av datamodellen framfor en instruksjon
 * modellen kan overse — den kan ikke slette noe den ikke nettopp har sett.
 *
 * Samme idé som `propose_widget` før `create_widget`, men håndhevet av id-en i stedet
 * for av prompten.
 *
 * ## Hvorfor id-en alene ikke holder
 *
 * Begge chat-løkkene kjører opptil fem **verktøyrunder i samme svar**, laget nettopp
 * for «oppslag → beslutning → endring». Id-kravet hindrer derfor blind sletting, men
 * ikke ubekreftet sletting: modellen kan kalle `find` i runde 1 og `delete` i runde 2,
 * og brukeren ser aldri spørsmålet.
 *
 * Det eneste signalet en modell ikke kan produsere selv, er at brukeren har sagt noe
 * i mellomtiden. Derfor injiserer kallstedet hvilke id-er som ble funnet i *denne*
 * runden, og `delete` nekter på dem. Slettingen må komme fra et senere svar — som
 * betyr at brukeren rakk å svare. `foundThisTurn` settes av kallstedet ETTER
 * modellens argumenter, så den kan ikke overstyres fra en verktøyparameter.
 *
 * ## Hvorfor flere målinger per dag betyr noe
 *
 * Folk veier seg morgen og kveld. «Slett 10. august» er derfor tvetydig i seg selv, og
 * å slette alle på datoen ville fjernet en riktig måling sammen med den gale. `find`
 * returnerer dem alle og lar modellen spørre hvilken.
 */

import { z } from 'zod';
import { findWeightOutliers, describeOutlier } from '$lib/domain/health/weight-outliers';
import {
	deleteWeightMeasurement,
	listWeightMeasurements,
	SOURCE_CLEANUP_NOTE
} from '$lib/server/health/weight-measurement-store';

/**
 * Sant når id-en ble funnet i samme verktøyrunde som slettingen forsøkes i.
 *
 * Da har brukeren ikke rukket å si noe mellom oppslaget og slettingen, og
 * bekreftelsen ville vært modellens egen antakelse framfor et svar.
 */
export function needsUserConfirmation(
	id: string,
	foundThisTurn: readonly string[] | undefined
): boolean {
	return Boolean(foundThisTurn?.includes(id));
}

/**
 * Svaret som sendes i stedet for å slette.
 *
 * Formulert som en instruksjon til modellen om hva den skal gjøre nå — et bart
 * «avvist» ville fått den til å prøve igjen med samme argumenter.
 */
export const CONFIRMATION_REQUIRED = {
	ok: false,
	error: 'Brukeren har ikke bekreftet denne slettingen ennå.',
	hint: 'Du fant målingen i dette svaret. Si hva du fant — dato, vekt og kilde — og spør om den skal slettes. Kall delete med samme id FØRST etter at brukeren har svart ja.'
} as const;

export const manageWeightMeasurementTool = {
	name: 'manage_weight_measurement',
	description: `Finn og slett ENKELTE vektmålinger. For veiinger som målte noe annet enn brukeren — et barn på vekta, en bag, en sensorglipp.

Bruk denne når brukeren vil fjerne, slette eller rette en vektmåling, eller spør om en måling som ser feil ut. For vekttrend og milepæler: query_weight.

action='find' (gjør ALLTID denne først):
- Med date: målingene på den datoen, hver med en id.
- Uten date: målingene som avviker mest fra sine naboer — de mistenkelige.

action='delete': krever id fra et find-svar i DENNE samtalen.

ARBEIDSFLYT — følg den:
1. Kall find. 2. Si hva du fant («10. august 2018 har én måling på 40,2 kg») og spør om den skal slettes. 3. Kall delete med id-en først når brukeren har sagt ja.

Aldri kall delete uten at brukeren har bekreftet nettopp den målingen. Sletting kan ikke angres fra flaten.
Finner find flere målinger på datoen, LIST dem med vekt og klokkeslett og spør hvilken — ikke slett alle.
Finner find ingenting, si det. Ikke gjett en id; en oppdiktet id treffer ingen rad.
Etter sletting: videreformidle merknaden om at kilden også må ryddes.`,

	parameters: z.object({
		userId: z.string().describe('User ID'),
		action: z.enum(['find', 'delete']),
		date: z
			.string()
			.optional()
			.describe('YYYY-MM-DD. Kun for find. Utelates for å få de mistenkelige målingene.'),
		id: z
			.string()
			.optional()
			.describe('Målingens id, fra et find-svar. Påkrevd for delete.')
	}),

	execute: async (args: {
		userId: string;
		action: 'find' | 'delete';
		date?: string;
		id?: string;
		/** Injiseres av kallstedet — id-er funnet i denne verktøyrunden. Ikke en modellparameter. */
		foundThisTurn?: readonly string[];
	}) => {
		if (args.action === 'delete') {
			if (!args.id) {
				return {
					ok: false,
					error: 'delete krever id. Kall find først og bruk id-en derfra.'
				};
			}

			if (needsUserConfirmation(args.id, args.foundThisTurn)) {
				return CONFIRMATION_REQUIRED;
			}

			const result = await deleteWeightMeasurement(args.userId, args.id);
			if (!result.ok) {
				return {
					ok: false,
					error: result.detail,
					// Uten dette hintet prøver modellen gjerne samme id på nytt.
					hint:
						result.reason === 'not_found'
							? 'Id-en finnes ikke. Kall find på nytt — målingen kan allerede være slettet.'
							: 'Id-en peker på en annen type måling. Kall find for å få en vektmåling.'
				};
			}

			return {
				ok: true,
				slettet: result.deleted,
				merknad: SOURCE_CLEANUP_NOTE
			};
		}

		const all = await listWeightMeasurements(args.userId);

		if (args.date) {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
				return { ok: false, error: 'date må være YYYY-MM-DD' };
			}
			const onDate = all.filter((row) => row.date === args.date);
			return {
				ok: true,
				dato: args.date,
				antall: onDate.length,
				maalinger: onDate,
				// Tvetydigheten skal være synlig i svaret, ikke bare i beskrivelsen.
				merknad:
					onDate.length > 1
						? 'Flere målinger denne dagen. Spør brukeren hvilken før du sletter — ikke slett alle.'
						: onDate.length === 0
							? 'Ingen vektmåling på denne datoen.'
							: undefined
			};
		}

		const outliers = findWeightOutliers(all);
		return {
			ok: true,
			antall: outliers.length,
			maalinger: outliers.map((outlier) => ({
				...outlier,
				// Setningen kommer ferdig, så chatten sier det samme som flaten.
				forklaring: describeOutlier(outlier)
			})),
			merknad:
				outliers.length === 0
					? 'Ingen målinger avviker nok til å være mistenkelige. Spør brukeren om en dato hvis hen vet hvilken måling det gjelder.'
					: undefined
		};
	}
};
