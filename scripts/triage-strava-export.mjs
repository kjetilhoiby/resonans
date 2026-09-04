#!/usr/bin/env node
/**
 * Triage av en Strava-eksport, kjørt FØR én fil er konvertert.
 *
 *   node scripts/triage-strava-export.mjs <activities.csv> [--pr 10000:3120] [--limit 40]
 *
 * `--pr` er brukerens egen referanse som `meter:sekunder`. Den er en PARAMETER
 * og ikke en konstant her av samme grunn som i domenemodulen: et hardkodet
 * tempo arver stille feilen i den kroppen det en gang ble satt for.
 *
 * Reglene bor i `$lib/domain/health/import-triage.ts` og er testet der. Dette
 * skriptet gjør bare to ting: leser CSV-en og skriver rapporten.
 */

import { readFileSync } from 'node:fs';

// Skriptet kjøres med node, uten Vites $lib-alias — derfor relativ import.
const {
	triageReport
} = await import('../src/lib/domain/health/import-triage.ts').catch(async () => {
	throw new Error(
		'Kunne ikke importere import-triage.ts. Kjør med tsx: ' +
			'npx tsx scripts/triage-strava-export.mjs <fil>'
	);
});

/**
 * Strava eksporterer aktivitetstypen på brukerens SPRÅK, ikke som en api-verdi.
 * Kartet er derfor mot norsk tekst, og en ukjent type sendes videre uendret —
 * `workoutSportFamily` gir da `other`, og de sport-avhengige aksene holder
 * kjeft framfor å dømme mot et gulv vi ikke har.
 */
const SPORT_BY_NORWEGIAN = {
	Løpetur: 'running',
	'Virtuelt løp': 'running',
	Sykkeltur: 'cycling',
	'El-sykkeltur': 'e_bike',
	Gåtur: 'walking',
	Fottur: 'hiking',
	Langrenn: 'skiing',
	Svømming: 'swimming'
};

function parseArgs(argv) {
	const args = { file: null, pr: null, limit: 40 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--pr') {
			const [meters, seconds] = (argv[++i] ?? '').split(':').map(Number);
			if (!Number.isFinite(meters) || !Number.isFinite(seconds)) {
				throw new Error('--pr tar meter:sekunder, f.eks. --pr 10000:3120');
			}
			args.pr = { distanceMeters: meters, seconds };
		} else if (a === '--limit') {
			args.limit = Number(argv[++i]);
		} else if (!args.file) {
			args.file = a;
		}
	}
	if (!args.file) throw new Error('Oppgi CSV-fila fra Strava-eksporten.');
	return args;
}

/** Minimal CSV-parser: Strava siterer felt med komma og doble anførselstegn. */
function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
			continue;
		}
		if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\n') {
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
		} else if (c !== '\r') field += c;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

function num(value) {
	if (value == null) return null;
	const n = Number(String(value).replace(',', '.').trim());
	return Number.isFinite(n) ? n : null;
}

const { file, pr, limit } = parseArgs(process.argv.slice(2));
const rows = parseCsv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
const header = rows[0];

/**
 * **Overskriftene er IKKE unike.** «Totaltid» og «Distanse» står to ganger:
 * den første er en visningsstreng (minutter, km), den andre er råverdien
 * (sekunder, meter). Et oppslag på navn gir én av dem, og hvilken avhenger av
 * parseren — derfor slås kolonnene opp på INDEKS, og den SISTE forekomsten er
 * den vi vil ha.
 */
function lastIndexOfColumn(name) {
	return header.lastIndexOf(name);
}
const IDX = {
	id: header.indexOf('Aktivitets-ID'),
	date: header.indexOf('Aktivitetsdato'),
	name: header.indexOf('Aktivitetsnavn'),
	type: header.indexOf('Aktivitetstype'),
	elapsed: lastIndexOfColumn('Totaltid'),
	moving: lastIndexOfColumn('Bevegelsestid'),
	distance: lastIndexOfColumn('Distanse')
};
for (const [key, index] of Object.entries(IDX)) {
	if (index < 0) throw new Error(`Fant ikke kolonnen for «${key}» i eksporten.`);
}

const candidates = rows.slice(1).filter((r) => r.length > IDX.distance).map((r) => ({
	id: r[IDX.id],
	date: r[IDX.date],
	name: r[IDX.name] || null,
	sportType: SPORT_BY_NORWEGIAN[r[IDX.type]] ?? r[IDX.type],
	distanceMeters: num(r[IDX.distance]),
	elapsedSeconds: num(r[IDX.elapsed]),
	movingSeconds: num(r[IDX.moving])
}));

const report = triageReport(candidates, pr ? { paceReference: pr } : {});

console.log(`\n${report.checked} aktiviteter lest fra ${file}`);
console.log(
	report.paceReference
		? `Tempo-referanse: ${report.paceReference.distanceMeters} m på ${report.paceReference.seconds} s`
		: 'Ingen tempo-referanse oppgitt — for-rask-aksen er AV (--pr meter:sekunder)'
);

console.log('\nPer akse (funn / kunne dømmes):');
for (const axis of ['for-rask', 'for-langsom', 'for-kort', 'for-lang']) {
	console.log(`  ${axis.padEnd(12)} ${String(report.byAxis[axis]).padStart(4)} / ${report.coverage[axis]}`);
}

// For-rask-aksen listes for seg. Den er den eneste som er PERMANENT — en
// distanserekord er «min over alt» — så den skal ikke ligge nede i en liste
// sortert på hvor kort en GPS-stump var.
const fast = report.flagged.filter((f) => f.findings.some((x) => x.axis === 'for-rask'));
if (fast.length > 0) {
	console.log(`\nfor-rask (${fast.length}) — disse blir distanserekorder:\n`);
	for (const { candidate, findings } of fast) {
		const f = findings.find((x) => x.axis === 'for-rask');
		console.log(`  ${candidate.date.padEnd(22)} ${candidate.id}  ${f.reason}`);
		console.log(`  ${' '.repeat(22)} ${candidate.name ?? ''}`);
	}
}

console.log(`\n${report.flagged.length} med minst ett funn. Verste ${Math.min(limit, report.flagged.length)}:\n`);
for (const { candidate, findings, worst } of report.flagged.slice(0, limit)) {
	// Datoen skrives HELT ut. Strava eksporterer den som norsk tekst
	// («29. juni 2026»), ikke som ISO — et kutt på ti tegn ga «29. juni 2»,
	// altså et årstall som ser ut som et avkortet klokkeslett.
	console.log(
		`[${worst.toFixed(2)}] ${candidate.date.padEnd(22)} ${candidate.id}  ${candidate.name ?? ''}`
	);
	for (const f of findings) {
		console.log(`        ${f.axis}: ${f.reason}`);
	}
}
console.log();
