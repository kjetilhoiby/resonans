// DOMMatrix polyfill — must come before pdf-parse/pdfjs-dist loads
if (typeof globalThis.DOMMatrix === 'undefined') {
	globalThis.DOMMatrix = class DOMMatrix {
		a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
		m11 = 1; m12 = 0; m21 = 0; m22 = 1; m41 = 0; m42 = 0;
		constructor(init) {
			if (Array.isArray(init) && init.length >= 6) {
				[this.a, this.b, this.c, this.d, this.e, this.f] = init;
				this.m11 = this.a; this.m12 = this.b;
				this.m21 = this.c; this.m22 = this.d;
				this.m41 = this.e; this.m42 = this.f;
			}
		}
	};
}

import { PDFParse } from './node_modules/pdf-parse/dist/pdf-parse/esm/index.js';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

const DIR = '/Users/kjetilh/Downloads/documents_08495918032026/';
const files = (await readdir(DIR)).filter(f => f.endsWith('.pdf')).slice(0, 3);

for (const file of files) {
	const buf = await readFile(join(DIR, file));
	const parser = new PDFParse({ data: buf });
	try {
		const result = await parser.getText();
		const text = result.text;

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
	} finally {
		await parser.destroy();
	}
}
