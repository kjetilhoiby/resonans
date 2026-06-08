import 'dotenv/config';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

export type ReviewVerdict = 'oppdater' | 'regresjon' | 'identisk' | 'ny-baseline' | 'skipped';

export interface VisualReviewResult {
	pixelDiffRatio: number;
	verdict: ReviewVerdict;
	details: string;
	baselineUpdated: boolean;
}

function loadPng(filePath: string): PNG {
	return PNG.sync.read(fs.readFileSync(filePath));
}

function resizeCanvas(png: PNG, targetWidth: number, targetHeight: number): PNG {
	if (png.width === targetWidth && png.height === targetHeight) return png;
	const resized = new PNG({ width: targetWidth, height: targetHeight, fill: true });
	PNG.bitblt(png, resized, 0, 0, Math.min(png.width, targetWidth), Math.min(png.height, targetHeight), 0, 0);
	return resized;
}

function createDiffImage(baseline: PNG, current: PNG): { diffPng: PNG; diffCount: number; totalPixels: number } {
	const width = Math.max(baseline.width, current.width);
	const height = Math.max(baseline.height, current.height);
	const baseResized = resizeCanvas(baseline, width, height);
	const currResized = resizeCanvas(current, width, height);
	const diffPng = new PNG({ width, height });

	const diffCount = pixelmatch(
		baseResized.data, currResized.data, diffPng.data, width, height,
		{ threshold: 0.1, diffColor: [255, 0, 0], alpha: 0.3 }
	);
	return { diffPng, diffCount, totalPixels: width * height };
}

function pngToBase64(png: PNG): string {
	return PNG.sync.write(png).toString('base64');
}

function getGitContext(): string {
	try {
		const stat = execSync('git diff --stat HEAD 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
		const names = execSync('git diff --name-only HEAD 2>/dev/null', { encoding: 'utf-8', timeout: 5000 });
		const diff = execSync('git diff HEAD -- "src/lib/components" "src/routes" "src/app.css" 2>/dev/null | head -200', { encoding: 'utf-8', timeout: 5000 });
		return `Endrede filer:\n${names}\n${stat}\nRelevant diff (utdrag):\n${diff}`.slice(0, 3000);
	} catch {
		return '';
	}
}

async function askVisionModel(
	baselineB64: string,
	currentB64: string,
	diffB64: string,
	pageName: string,
	codeContext: string
): Promise<{ verdict: 'oppdater' | 'regresjon'; details: string }> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey || apiKey === 'test-key') {
		throw new Error('OPENAI_API_KEY mangler');
	}

	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: 'gpt-4o',
			max_tokens: 600,
			temperature: 0.2,
			messages: [
				{
					role: 'system',
					content: `Du er visuell QA for en norsk mobilapp (mørkt tema, 390×844).

Du får tre bilder av en side:
• BASELINE — forrige godkjente versjon
• NÅVÆRENDE — etter kodeendring
• DIFF — røde piksler viser hva som endret seg

Du får også git-diffen med kodeendringene.

Din jobb: vurder om den visuelle endringen er VELLYKKET eller en REGRESJON.

VELLYKKET (verdict: "oppdater") betyr:
- Endringen matcher intensjonen i kodeendringene
- Ingen uønskede sideeffekter (ødelagt layout, manglende innhold, overlapp)
- Bare dynamiske data (tid, tall) endret seg — dette er alltid OK

REGRESJON (verdict: "regresjon") betyr:
- Noe ser feil ut som IKKE er forklart av kodeendringene
- Layout er ødelagt, elementer mangler, feil farger, overlapp
- Viktig innhold er borte eller uleselig

Svar KUN med JSON:
{
  "verdict": "oppdater" | "regresjon",
  "details": "2-3 setninger: hva endret seg og hvorfor du vurderer det slik",
  "changedElements": ["kort liste over UI-elementer som endret seg"]
}`
				},
				{
					role: 'user',
					content: [
						{ type: 'text', text: `Side: ${pageName}\n\nKodeendringer:\n${codeContext || '(ingen git-diff tilgjengelig)'}` },
						{ type: 'text', text: 'BASELINE (før):' },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${baselineB64}`, detail: 'low' } },
						{ type: 'text', text: 'NÅVÆRENDE (etter):' },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${currentB64}`, detail: 'low' } },
						{ type: 'text', text: 'DIFF (rødt = endrede piksler):' },
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${diffB64}`, detail: 'low' } },
					]
				}
			]
		})
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`OpenAI ${response.status}: ${text.slice(0, 300)}`);
	}

	const json = await response.json() as { choices: Array<{ message: { content: string } }> };
	const content = json.choices[0]?.message?.content ?? '';

	const match = content.match(/\{[\s\S]*\}/);
	if (match) {
		const parsed = JSON.parse(match[0]);
		return {
			verdict: parsed.verdict === 'regresjon' ? 'regresjon' : 'oppdater',
			details: parsed.details ?? content,
		};
	}

	return { verdict: 'oppdater', details: content };
}

export interface VisualReviewOptions {
	/** Beskrivelse av hva som ble endret og hvorfor — brukes av LLM-en til å vurdere om endringen er vellykket. */
	changeDescription?: string;
}

export async function visualReview(
	page: Page,
	pageName: string,
	baselineDir: string,
	options: VisualReviewOptions = {}
): Promise<VisualReviewResult> {
	const screenshotBuffer = await page.screenshot({ fullPage: true });
	const currentPng = PNG.sync.read(screenshotBuffer);

	const baselinePath = path.join(baselineDir, `${pageName}.png`);

	if (!fs.existsSync(baselinePath)) {
		fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
		fs.writeFileSync(baselinePath, PNG.sync.write(currentPng));
		return { pixelDiffRatio: 0, verdict: 'ny-baseline', details: 'Første kjøring — baseline lagret.', baselineUpdated: true };
	}

	const baselinePng = loadPng(baselinePath);
	const { diffPng, diffCount, totalPixels } = createDiffImage(baselinePng, currentPng);
	const pixelDiffRatio = diffCount / totalPixels;

	if (pixelDiffRatio < 0.001) {
		return { pixelDiffRatio, verdict: 'identisk', details: 'Ingen visuell endring.', baselineUpdated: false };
	}

	// Lagre diff-bilder for manuell inspeksjon
	const diffDir = path.join(baselineDir, '..', '..', 'review-diffs');
	fs.mkdirSync(diffDir, { recursive: true });
	fs.writeFileSync(path.join(diffDir, `${pageName}-baseline.png`), fs.readFileSync(baselinePath));
	fs.writeFileSync(path.join(diffDir, `${pageName}-current.png`), screenshotBuffer);
	fs.writeFileSync(path.join(diffDir, `${pageName}-diff.png`), PNG.sync.write(diffPng));

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey || apiKey === 'test-key') {
		return { pixelDiffRatio, verdict: 'skipped', details: `${(pixelDiffRatio * 100).toFixed(1)}% diff — OPENAI_API_KEY mangler for LLM-vurdering. Se review-diffs/.`, baselineUpdated: false };
	}

	const baselineB64 = fs.readFileSync(baselinePath).toString('base64');
	const currentB64 = screenshotBuffer.toString('base64');
	const diffB64 = pngToBase64(diffPng);
	const gitDiff = getGitContext();
	const codeContext = options.changeDescription
		? `Beskrivelse av endringen:\n${options.changeDescription}\n\nGit-diff:\n${gitDiff}`
		: gitDiff;

	const review = await askVisionModel(baselineB64, currentB64, diffB64, pageName, codeContext);

	if (review.verdict === 'oppdater') {
		fs.writeFileSync(baselinePath, screenshotBuffer);
	}

	return {
		pixelDiffRatio,
		verdict: review.verdict,
		details: review.details,
		baselineUpdated: review.verdict === 'oppdater',
	};
}
