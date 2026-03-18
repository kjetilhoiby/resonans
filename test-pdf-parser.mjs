import { extractText } from './node_modules/unpdf/dist/index.mjs';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const DIR = '/Users/kjetilh/Downloads/documents_08495918032026/';
const files = (await readdir(DIR)).filter(f => f.endsWith('.pdf')).slice(0, 3);

for (const file of files) {
	const buf = await readFile(join(DIR, file));
	try {
		const { text } = await extractText(new Uint8Array(buf), { mergePages: true });

		// Extract the key balance lines
		const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
		const balanceLines = lines.filter(l =>
			l.match(/Saldo frå kontoutskrift/i) ||
			l.match(/Overført til neste side/i) ||
			l.match(/Utgående saldo/i) ||
			l.match(/i perioden/i) ||
			l.match(/konto \d{4}/i)
		);

		console.log(`\n=== ${file} ===`);
		for (const l of balanceLines) console.log(' ', l);
	} catch (err) {
		console.error(`Feil: ${file}: ${err.message}`);
	}
}
