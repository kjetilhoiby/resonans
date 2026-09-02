/**
 * Ringbuffer over prosessens egne logglinjer, lesbar over API.
 *
 * Finnes fordi containerens stdout bare bor i Coolify: `[chat-perf]`,
 * `[cron-dispatch]`, `[job-worker]` og `[500]`-linjene var usynlige for alt
 * som ikke har Coolify-tilgang — inkludert Claude-økter som skal følge opp en
 * deploy. `GET /api/admin/logs` (admin-gatet) leser bufferet.
 *
 * Egenskaper å kjenne til:
 * - **Per instans.** Ved rullende oppdatering svarer den instansen Traefik
 *   ruter til; `instanceStartedAt` i svaret sier hvem du snakker med.
 * - **Flyktig.** En restart tømmer bufferet — dette er et vindu, ikke et arkiv.
 *   Historikk med krav på seg bor i `cron_executions`/`usage_events`.
 * - Console-metodene wrappes ÉN gang (globalThis-vakt: vite re-evaluerer
 *   moduler i dev, og stablede wrappere ville doblet hver linje).
 */

export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export type LogLine = {
	ts: string;
	level: LogLevel;
	text: string;
};

export const LOG_BUFFER_CAPACITY = 2000;
const MAX_LINE_LENGTH = 4000;

/** Ren: argumentene slik console fikk dem → én linje. Testet. */
export function formatLogArgs(args: unknown[]): string {
	const parts = args.map((arg) => {
		if (typeof arg === 'string') return arg;
		if (arg instanceof Error) {
			return arg.stack ?? `${arg.name}: ${arg.message}`;
		}
		try {
			return JSON.stringify(arg);
		} catch {
			return String(arg);
		}
	});
	const line = parts.join(' ');
	return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…[kuttet]` : line;
}

/** Ren ringbuffer — indeksbasert så push er O(1) uansett kapasitet. Testet. */
export function createRingBuffer<T>(capacity: number) {
	const items: T[] = [];
	let head = 0;
	let total = 0;
	return {
		push(item: T) {
			if (items.length < capacity) {
				items.push(item);
			} else {
				items[head] = item;
				head = (head + 1) % capacity;
			}
			total += 1;
		},
		/** Eldst først. */
		list(): T[] {
			return [...items.slice(head), ...items.slice(0, head)];
		},
		totalPushed(): number {
			return total;
		}
	};
}

type CaptureState = {
	buffer: ReturnType<typeof createRingBuffer<LogLine>>;
	startedAt: string;
};

const GLOBAL_KEY = '__resonansLogCapture';

function getState(): CaptureState | undefined {
	return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as CaptureState | undefined;
}

export function installConsoleCapture(): void {
	if (getState()) return;

	const state: CaptureState = {
		buffer: createRingBuffer<LogLine>(LOG_BUFFER_CAPACITY),
		startedAt: new Date().toISOString()
	};
	(globalThis as Record<string, unknown>)[GLOBAL_KEY] = state;

	for (const level of ['log', 'info', 'warn', 'error'] as const) {
		const original = console[level].bind(console);
		console[level] = (...args: unknown[]) => {
			try {
				state.buffer.push({ ts: new Date().toISOString(), level, text: formatLogArgs(args) });
			} catch {
				// Bufferet skal aldri kunne velte selve loggingen.
			}
			original(...args);
		};
	}
}

export type ReadCapturedLogsOptions = {
	/** Case-insensitiv delstreng (ikke regex — admin-input skal ikke kunne ReDoS-e prosessen). */
	grep?: string;
	level?: LogLevel;
	limit?: number;
};

export function readCapturedLogs(opts: ReadCapturedLogsOptions = {}): {
	installed: boolean;
	instanceStartedAt: string | null;
	totalCaptured: number;
	matched: number;
	lines: LogLine[];
} {
	const state = getState();
	if (!state) {
		return { installed: false, instanceStartedAt: null, totalCaptured: 0, matched: 0, lines: [] };
	}

	const needle = opts.grep?.toLowerCase();
	let lines = state.buffer.list();
	if (opts.level) lines = lines.filter((l) => l.level === opts.level);
	if (needle) lines = lines.filter((l) => l.text.toLowerCase().includes(needle));

	const matched = lines.length;
	const limit = Math.max(1, Math.min(opts.limit ?? 200, LOG_BUFFER_CAPACITY));
	// Siste N — det ferske er det man feilsøker.
	if (lines.length > limit) lines = lines.slice(lines.length - limit);

	return {
		installed: true,
		instanceStartedAt: state.startedAt,
		totalCaptured: state.buffer.totalPushed(),
		matched,
		lines
	};
}
