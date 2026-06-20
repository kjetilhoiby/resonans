/// <reference lib="webworker" />
import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const APP_CACHE = `resonans-app-${version}`;
const DASHBOARD_CACHE = `resonans-dashboard-${version}`;
const STATIC_ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(APP_CACHE).then((cache) => cache.addAll(STATIC_ASSETS))
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== APP_CACHE && key !== DASHBOARD_CACHE)
					.map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

function isDashboardRequest(url: URL): boolean {
	return /\/api\/tema\/[^/]+\/dashboard\/(health|economics)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Let browser/network handle SvelteKit module graph assets.
	// Cache-first here can serve mixed app/chunk versions after deploy and break hydration.
	if (url.pathname.startsWith('/_app/immutable/')) return;

	if (isDashboardRequest(url)) {
		event.respondWith(staleWhileRevalidateDashboard(request));
		return;
	}

	if (STATIC_ASSETS.includes(url.pathname)) {
		event.respondWith(cacheFirst(request));
	}
});

type PushPayload = {
	title?: string;
	body?: string;
	url?: string;
	tag?: string;
	actions?: Array<{ action: string; title: string }>;
	data?: Record<string, unknown>;
};

self.addEventListener('push', (event) => {
	const payload = (() => {
		try {
			return event.data?.json() as PushPayload | undefined;
		} catch {
			return { body: event.data?.text() } as PushPayload;
		}
	})();

	const title = payload?.title ?? 'Resonans';
	const body = payload?.body ?? 'Ny oppdatering';
	const url = payload?.url ?? '/';

	const options: NotificationOptions = {
		body,
		icon: '/icons/icon-192.svg',
		badge: '/icons/icon-192.svg',
		tag: payload?.tag ?? 'resonans-push',
		data: { url, ...(payload?.data ?? {}) }
	};
	if (payload?.actions?.length) {
		(options as NotificationOptions & { actions: unknown[] }).actions = payload.actions;
	}

	event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const data = (event.notification.data ?? {}) as { url?: string; claimCycleId?: string };
	const targetUrl = data.url ?? '/';

	// «Legg i min dag»: flytt syklusens husarbeid fra chores-view til dagslista.
	// Cookie-auth følger med same-origin fetch fra service worker.
	if (event.action === 'claim-day' && data.claimCycleId) {
		event.waitUntil(
			fetch('/api/apps/ping/claim-day', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cycleId: data.claimCycleId })
			}).catch(() => {})
		);
		return;
	}

	event.waitUntil(
		(async () => {
			const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of allClients) {
				const windowClient = client as WindowClient;
				if ('focus' in windowClient) {
					await windowClient.focus();
					windowClient.navigate(targetUrl);
					return;
				}
			}
			await self.clients.openWindow(targetUrl);
		})()
	);
});

async function cacheFirst(request: Request): Promise<Response> {
	const cache = await caches.open(APP_CACHE);
	const cached = await cache.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		cache.put(request, response.clone());
	}
	return response;
}

async function staleWhileRevalidateDashboard(request: Request): Promise<Response> {
	const cache = await caches.open(DASHBOARD_CACHE);
	const cached = await cache.match(request);

	const networkPromise = fetch(request)
		.then((response) => {
			if (response.ok) {
				cache.put(request, response.clone());
			}
			return response;
		})
		.catch(() => null);

	if (cached) {
		void networkPromise;
		return cached;
	}

	const network = await networkPromise;
	if (network) return network;

	return new Response(JSON.stringify({ error: 'Offline og ingen cached dashboarddata.' }), {
		status: 503,
		headers: { 'Content-Type': 'application/json' }
	});
}
