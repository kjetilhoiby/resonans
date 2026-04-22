import { SignalService } from '$lib/server/services/signal-service';

export async function runDomainSignalProducers(now: Date = new Date()) {
	return SignalService.runProducers(now);
}

export async function getDomainSignalObservability(signalType: string, hours = 24 * 7) {
	return SignalService.getObservability(signalType, hours);
}
