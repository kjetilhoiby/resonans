/**
 * Bygger et Postgres array-literal (`{"a","b"}`) av en JS-liste.
 *
 * ## Hvorfor dette ikke overlates til driveren
 *
 * `pgClient.unsafe(query, params)` sender parametrene gjennom postgres-js sin
 * `handleValue`, og der utledes typen med `inferType`. For en **Array**
 * returnerer den skalar-OID-en til FØRSTE element (`types.js`), ikke array-OID-en
 * — så en liste med strenger blir type 0, og serializeren for 0 gjør `'' + x`.
 * Resultatet er strengen `a,b`, som ikke er et gyldig array-literal: Postgres
 * krever `{a,b}`. `UNNEST($1::text[])` feiler derfor på «malformed array
 * literal».
 *
 * Verre er varianten der første element er et `Date`: da blir typen 1184, og
 * drizzles transparente date-serializer returnerer Arrayen **urørt**. Den når
 * `bytes.js` sin `str()`, som kaller `Buffer.byteLength(Array)` og kaster
 * «The "string" argument must be of type string … Received an instance of Array».
 *
 * Begge er samme rot: driveren gjetter typen av ett element. Vi slutter å la
 * den gjette — parameteren sendes som en ferdig streng.
 *
 * NB: dette rammet bare postgres-js. Under den (nå fjernede) neon-http-stien
 * serialiseres parametere av en annen driver, så koden virket fram til
 * containeren tok over 30. august 2026 — derfor lå feilen latent i årevis.
 * Regelen gjelder uansett: `inferType` gjetter på elementtypen, og gjettet
 * er postgres-js' eget. Se
 * `docs/changelog/2026-09-03-array-parametere-til-postgres.md`.
 */

/**
 * Alle ikke-null-elementer siteres, også tall.
 *
 * Postgres godtar siterte elementer for enhver elementtype — `'{"1","2"}'::int[]`
 * er `{1,2}` — så vi slipper å avgjøre PER ELEMENT om sitering trengs. Den
 * avgjørelsen er hele feilkilden i håndskrevne array-literaler: et komma eller
 * et anførselstegn i en bankbeskrivelse («KIWI 123, OSLO») deler elementet i to,
 * stille. `NULL` må derimot stå usitert — `"NULL"` er strengen NULL.
 */
export function toPgArrayLiteral(values: readonly (string | number | null | undefined)[]): string {
	const parts = values.map((value) => {
		if (value === null || value === undefined) return 'NULL';
		const text = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
		return `"${text}"`;
	});
	return `{${parts.join(',')}}`;
}
