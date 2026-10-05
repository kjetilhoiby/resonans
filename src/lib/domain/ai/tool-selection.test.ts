import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
	evaluateToolSelection,
	LOAD_TOOLS_NAME,
	parseToolGroups,
	recentThreadSignals,
	resolveToolSelectionMode,
	selectToolGroups,
	TOOL_GROUP_MAP,
	TOOL_GROUPS,
	toolNamesForGroups,
	type ToolSelectionInput
} from './tool-selection';

const ROUTE = resolve(process.cwd(), 'src/routes/api/chat/+server.ts');

/**
 * Navnene i chat-ruta sin `tools`-liste, lest fra kildefila. Fire former:
 * literal (`function: { name: 'x'`), og tre der navnet står i verktøymodulen
 * (`openAiFunctionDefinition(xTool)`, `name: xTool.name` og en bar
 * `xToolDefinition`).
 */
function routeToolNames(): string[] {
	const src = readFileSync(ROUTE, 'utf8');
	const start = src.indexOf('const tools = [');
	const end = src.indexOf('\n];\n', start);
	expect(start).toBeGreaterThan(-1);
	const block = src.slice(start, end);
	const names = [...block.matchAll(/function: \{\s*name: '([a-z_]+)'/g)].map((m) => m[1]);
	const idents = [
		...[...block.matchAll(/openAiFunctionDefinition\((\w+)\)/g)].map((m) => m[1]),
		...[...block.matchAll(/function: \{\s*name: (\w+)\.name/g)].map((m) => m[1]),
		...[...block.matchAll(/^\s*(\w+ToolDefinition),?$/gm)].map((m) => m[1])
	];
	for (const ident of idents) {
		const imp = new RegExp(`import \\{[^}]*\\b${ident}\\b[^}]*\\} from '\\$lib/([^']+)'`).exec(src);
		expect(imp, `fant ikke importen av ${ident}`).not.toBeNull();
		const base = resolve(process.cwd(), 'src/lib', imp![1]);
		const file = [`${base}.ts`, `${base}/index.ts`].find((f) => existsSync(f));
		expect(file, `fant ikke modulen for ${ident}`).toBeDefined();
		const name = /name: '([a-z_]+)'/.exec(readFileSync(file!, 'utf8'));
		expect(name, `fant ikke navnet i ${file}`).not.toBeNull();
		names.push(name![1]);
	}
	return names;
}

const empty: ToolSelectionInput = {
	routedDomains: ['general'],
	routedSkills: ['general_chat'],
	themeKind: null,
	recentToolNames: [],
	recentDomains: [],
	hasImage: false
};

describe('verktøykartet', () => {
	it('dekker nøyaktig verktøyene i chat-ruta — et verktøy uten gruppe ville forsvunnet med kuttet', () => {
		const inRoute = routeToolNames();
		expect(new Set(inRoute).size).toBe(inRoute.length);
		expect([...inRoute].sort()).toEqual(Object.keys(TOOL_GROUP_MAP).sort());
	});

	it('gir hvert verktøy minst én gruppe', () => {
		for (const [name, groups] of Object.entries(TOOL_GROUP_MAP)) {
			expect(groups.length, name).toBeGreaterThan(0);
		}
	});

	it('kaller ikke sikkerhetsnettet noe et ekte verktøy heter', () => {
		expect(Object.hasOwn(TOOL_GROUP_MAP, LOAD_TOOLS_NAME)).toBe(false);
		expect(LOAD_TOOLS_NAME).toMatch(/^[a-z_]+$/);
	});
});

describe('selectToolGroups', () => {
	it('gir bare kjernen når ingen signaler finnes', () => {
		expect(selectToolGroups(empty).groups).toEqual(['kjerne']);
	});

	it('tar med rutingens domener og ferdigheter', () => {
		const sel = selectToolGroups({
			...empty,
			routedDomains: ['health', 'economics'],
			routedSkills: ['widget_creation']
		});
		expect(sel.groups).toEqual(['kjerne', 'helse', 'okonomi', 'widget']);
	});

	it('tar med temaet samtalen ligger på — «hva tenker du om dette?» på Trening er et helsespørsmål', () => {
		const sel = selectToolGroups({ ...empty, themeKind: 'training' });
		expect(sel.groups).toContain('helse');
		expect(sel.sources.theme).toEqual(['helse']);
	});

	it('gir ernæringstemaet både helse og mat', () => {
		expect(selectToolGroups({ ...empty, themeKind: 'nutrition' }).groups).toEqual(['kjerne', 'helse', 'mat']);
	});

	it('følger tråden — «og i fjor?» etter et treningsoppslag får treningsverktøyene', () => {
		const sel = selectToolGroups({ ...empty, recentToolNames: ['query_training'] });
		expect(sel.groups).toContain('helse');
		expect(sel.sources.recent).toEqual(['helse']);
	});

	it('følger tråden også gjennom forrige svars domener', () => {
		expect(selectToolGroups({ ...empty, recentDomains: ['economics'] }).groups).toContain('okonomi');
	});

	it('lar ikke et kjerneverktøy i tråden telle som et signal', () => {
		expect(selectToolGroups({ ...empty, recentToolNames: ['web_search'] }).sources.recent).toEqual([]);
	});

	it('tar med bildeverktøyene når et bilde er vedlagt', () => {
		const sel = selectToolGroups({ ...empty, hasImage: true });
		expect(sel.groups).toEqual(['kjerne', 'bilde']);
	});

	it('sender alle gruppene for en fangst — brukeren har ikke sagt hva det er', () => {
		expect(selectToolGroups({ ...empty, capture: true }).groups).toEqual([...TOOL_GROUPS]);
	});

	it('ignorerer ukjente domener og verktøynavn', () => {
		const sel = selectToolGroups({ ...empty, routedDomains: ['tull'], recentToolNames: ['finnes_ikke'] });
		expect(sel.groups).toEqual(['kjerne']);
	});
});

describe('toolNamesForGroups', () => {
	const all = Object.keys(TOOL_GROUP_MAP);

	it('gir kjernen og gruppene, og ikke mer', () => {
		const names = toolNamesForGroups(all, ['kjerne', 'okonomi']);
		expect(names.has('web_search')).toBe(true);
		expect(names.has('query_economics')).toBe(true);
		expect(names.has('query_training')).toBe(false);
	});

	it('gir et verktøy i flere grupper når én av dem er valgt', () => {
		expect(toolNamesForGroups(all, ['mat']).has('query_nutrition')).toBe(true);
		expect(toolNamesForGroups(all, ['helse']).has('query_nutrition')).toBe(true);
	});

	it('holder et ukjent verktøy INNE — et nytt verktøy uten gruppe skal ikke forsvinne stille', () => {
		expect(toolNamesForGroups([...all, 'nytt_verktoy'], ['kjerne']).has('nytt_verktoy')).toBe(true);
	});

	it('kutter mesteparten av lista for en dagboksmelding', () => {
		const names = toolNamesForGroups(all, ['kjerne']);
		expect(names.size).toBeLessThan(all.length / 2);
	});
});

describe('evaluateToolSelection', () => {
	it('regner kalte verktøy utenfor utvalget som bom', () => {
		const selected = new Set(['web_search', 'query_training']);
		expect(evaluateToolSelection(selected, ['query_training', 'query_economics', 'query_economics'])).toEqual({
			called: ['query_training', 'query_economics'],
			missed: ['query_economics']
		});
	});

	it('teller ikke sikkerhetsnettet som et kall', () => {
		expect(evaluateToolSelection(new Set(), [LOAD_TOOLS_NAME])).toEqual({ called: [], missed: [] });
	});
});

describe('recentThreadSignals', () => {
	it('leser verktøy og domener fra de to siste svarene', () => {
		const history = [
			{ role: 'assistant', metadata: { toolsCalled: ['query_economics'] } },
			{ role: 'user', metadata: null },
			{ role: 'assistant', metadata: { toolsCalled: ['query_training'], routingDecision: { domains: ['health'] } } },
			{ role: 'user', metadata: null },
			{ role: 'assistant', metadata: { routingDecision: { domains: ['food', 'general'] } } },
			{ role: 'user', metadata: null }
		];
		expect(recentThreadSignals(history)).toEqual({ toolNames: ['query_training'], domains: ['health', 'food'] });
	});

	it('tåler metadata i alle former, og slipper bare kjente navn gjennom', () => {
		const history = [
			{ role: 'assistant', metadata: 'tull' },
			{ role: 'assistant', metadata: { toolsCalled: ['finnes_ikke', 42, 'log_nutrition'], routingDecision: 'x' } }
		];
		expect(recentThreadSignals(history)).toEqual({ toolNames: ['log_nutrition'], domains: [] });
	});
});

describe('parseToolGroups', () => {
	it('slipper bare kjente grupper gjennom, og aldri kjernen', () => {
		expect(parseToolGroups(['helse', 'tull', 'kjerne', 'okonomi'])).toEqual(['helse', 'okonomi']);
		expect(parseToolGroups('helse')).toEqual([]);
	});
});

describe('resolveToolSelectionMode', () => {
	it('måler i skygge som standard', () => {
		expect(resolveToolSelectionMode(undefined)).toBe('shadow');
		expect(resolveToolSelectionMode('tull')).toBe('shadow');
		expect(resolveToolSelectionMode(' ON ')).toBe('on');
		expect(resolveToolSelectionMode('off')).toBe('off');
	});
});

describe('kildefilen finnes', () => {
	it('peker på chat-ruta', () => {
		expect(existsSync(ROUTE)).toBe(true);
		expect(dirname(ROUTE)).toMatch(/api[/\\]chat$/);
	});
});
