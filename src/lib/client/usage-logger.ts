// Brukslogging fra klienten — fire-and-forget, skal aldri forstyrre appen.
// Hendelser køes og sendes batchet; oppmerksomhetstid telles i bolker mens
// fanen er synlig og brukeren ikke er idle.

type UsageEventType = 'page_view' | 'app_resume' | 'attention' | 'interaction';

interface QueuedEvent {
	type: UsageEventType;
	path: string;
	at: string;
	metadata?: Record<string, unknown>;
}

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_THRESHOLD = 20;
// Throttle for app_resume så tab-bytte ikke spammer loggen
const RESUME_THROTTLE_MS = 30 * 60 * 1000;
const ATTENTION_TICK_MS = 5_000;
// Synlig fane uten interaksjon lenger enn dette regnes ikke som oppmerksomhet
const IDLE_LIMIT_MS = 60_000;

let queue: QueuedEvent[] = [];
let currentPath = '';
let attentionMs = 0;
let lastInteractionAt = 0;
let lastResumeAt = 0;
let initialized = false;

// Playwright setter navigator.webdriver — hold testkjøringer ute av bruksdataene
function isTestRun(): boolean {
	return typeof navigator !== 'undefined' && navigator.webdriver;
}

function enqueue(type: UsageEventType, path: string, metadata?: Record<string, unknown>) {
	if (isTestRun()) return;
	queue.push({ type, path, at: new Date().toISOString(), ...(metadata ? { metadata } : {}) });
	if (queue.length >= FLUSH_THRESHOLD) flush();
}

function flush() {
	if (queue.length === 0) return;
	const payload = JSON.stringify({ events: queue });
	queue = [];
	try {
		// sendBeacon er det eneste som er pålitelig når siden er på vei bort
		if (document.visibilityState === 'hidden' && navigator.sendBeacon) {
			navigator.sendBeacon('/api/usage', new Blob([payload], { type: 'application/json' }));
			return;
		}
		void fetch('/api/usage', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: payload,
			keepalive: true
		}).catch(() => {});
	} catch {
		// Stille — logging er best effort
	}
}

// Krediterer oppsamlet oppmerksomhetstid til siden vi forlater
function flushAttention() {
	if (attentionMs > 0 && currentPath) {
		enqueue('attention', currentPath, { durationMs: attentionMs });
	}
	attentionMs = 0;
}

function deriveLabel(el: Element): string {
	const track = el.getAttribute('data-track');
	if (track) return track;
	const aria = el.getAttribute('aria-label');
	if (aria) return aria;
	if (el instanceof HTMLInputElement) {
		return `input[${el.type}]${el.name ? `:${el.name}` : ''}`;
	}
	const text = el.textContent?.replace(/\s+/g, ' ').trim();
	if (text) return text.slice(0, 60);
	return `<${el.tagName.toLowerCase()}>`;
}

export function trackPageView(path: string) {
	flushAttention();
	currentPath = path;
	lastInteractionAt = Date.now();
	enqueue('page_view', path);
}

export function initUsageTracking() {
	if (initialized || isTestRun()) return;
	initialized = true;
	lastInteractionAt = Date.now();
	lastResumeAt = Date.now();

	// Oppmerksomhetstid: tell bolker mens fanen er synlig og brukeren er aktiv
	setInterval(() => {
		if (document.visibilityState !== 'visible') return;
		if (Date.now() - lastInteractionAt > IDLE_LIMIT_MS) return;
		attentionMs += ATTENTION_TICK_MS;
	}, ATTENTION_TICK_MS);

	// Idle-markører — oppdaterer bare tidsstempelet, logger ingenting
	for (const type of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
		document.addEventListener(type, () => {
			lastInteractionAt = Date.now();
		}, { capture: true, passive: true });
	}

	// Klikk på interaktive elementer logges med utledet label.
	// Sett data-track="..." på viktige kontroller for stabile navn.
	document.addEventListener('click', (event) => {
		const target = event.target instanceof Element
			? event.target.closest('[data-track], button, a, [role="button"], input, label, summary')
			: null;
		if (!target || !currentPath) return;
		enqueue('interaction', currentPath, {
			label: deriveLabel(target),
			tag: target.tagName.toLowerCase()
		});
	}, { capture: true });

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			flushAttention();
			flush();
			return;
		}
		const now = Date.now();
		lastInteractionAt = now;
		if (now - lastResumeAt >= RESUME_THROTTLE_MS) {
			lastResumeAt = now;
			enqueue('app_resume', location.pathname);
		}
	});

	window.addEventListener('pagehide', () => {
		flushAttention();
		flush();
	});

	setInterval(flush, FLUSH_INTERVAL_MS);
}
