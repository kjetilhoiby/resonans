import { describe, expect, it } from 'vitest';
import {
	getGoogleChatWebhooksForRoutes,
	normalizeGoogleChatChannels,
	resolveRoutesForNotification,
	routeTargetsPwa
} from './notification-channels';

const chatChannel = { id: 'default', name: 'Standard', webhook: 'https://chat.googleapis.com/v1/spaces/x' };

describe('resolveRoutesForNotification', () => {
	it('bruker pwa som default når ingen ruting er lagret', () => {
		const routes = resolveRoutesForNotification({}, 'dayPlanning');
		expect(routes).toEqual(['pwa']);
	});

	it('inkluderer både pwa og chat som default når chat-kanal finnes', () => {
		const user = { notificationSettings: { notificationChannels: { googleChat: [chatChannel] } } };
		const routes = resolveRoutesForNotification(user, 'dayClose');
		expect(routes).toContain('pwa');
		expect(routes).toContain('chat:default');
	});

	it('daglig check-in defaulter uten pwa', () => {
		const user = { notificationSettings: { notificationChannels: { googleChat: [chatChannel] } } };
		expect(resolveRoutesForNotification(user, 'dailyCheckIn')).toEqual(['chat:default']);
	});

	it('lagret ruting uten pwa overstyrer default — pwa forsvinner', () => {
		// Dette er grunnen til at PWA-avkrysningen i settings alltid må rendres:
		// et skjema-submit uten pwa-checkbox lagrer ruting uten 'pwa', og da
		// sendes ingen push selv om abonnementene lever.
		const user = {
			notificationSettings: {
				notificationChannels: {
					googleChat: [chatChannel],
					routing: { dayPlanning: ['chat:default'] }
				}
			}
		};
		const routes = resolveRoutesForNotification(user, 'dayPlanning');
		expect(routes).toEqual(['chat:default']);
		expect(routeTargetsPwa(routes)).toBe(false);
	});

	it('lagret ruting med pwa beholder pwa uansett enhet', () => {
		const user = {
			notificationSettings: {
				notificationChannels: {
					googleChat: [chatChannel],
					routing: { digestDay: ['pwa', 'chat:default'] }
				}
			}
		};
		expect(routeTargetsPwa(resolveRoutesForNotification(user, 'digestDay'))).toBe(true);
	});

	it('filtrerer bort chat-ruter til kanaler som ikke finnes lenger', () => {
		const user = {
			notificationSettings: {
				notificationChannels: {
					googleChat: [chatChannel],
					routing: { dayClose: ['pwa', 'chat:slettet-kanal'] }
				}
			}
		};
		expect(resolveRoutesForNotification(user, 'dayClose')).toEqual(['pwa']);
	});
});

describe('normalizeGoogleChatChannels', () => {
	it('faller tilbake på legacy googleChatWebhook som default-kanal', () => {
		const channels = normalizeGoogleChatChannels({ googleChatWebhook: 'https://chat.googleapis.com/v1/spaces/y' });
		expect(channels).toHaveLength(1);
		expect(channels[0].id).toBe('default');
	});

	it('hopper over kanaler uten webhook', () => {
		const channels = normalizeGoogleChatChannels({
			notificationSettings: { notificationChannels: { googleChat: [{ id: 'tom', name: 'Tom', webhook: '' }] } }
		});
		expect(channels).toEqual([]);
	});
});

describe('getGoogleChatWebhooksForRoutes', () => {
	it('henter webhook for chat-ruter og ignorerer pwa', () => {
		const user = { notificationSettings: { notificationChannels: { googleChat: [chatChannel] } } };
		expect(getGoogleChatWebhooksForRoutes(user, ['pwa', 'chat:default'])).toEqual([chatChannel.webhook]);
	});
});
