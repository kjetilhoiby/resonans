import { PDFParse } from './node_modules/pdf-parse/dist/pdf-parse/esm/index.js';
import { readFile } from 'fs/promises';

const buf = await readFile('/Users/kjetilh/Downloads/documents_08495918032026/428242443182005252_Kontoutskrift.pdf');
const parser = new PDFParse({ data: buf });

console.log('=== getTable ===');
const result = await parser.getTable();
await parser.destroy();

for (const page of result.pages) {
  for (const table of page.tables) {
    console.log('\n--- Table ---');
    for (const row of table) {
      console.log(JSON.stringify(row));
    }
  }
}
