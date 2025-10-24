import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Mock responses for testing uten OpenAI
const mockResponses = [
	"Det høres ut som et viktig mål! Kan du fortelle meg mer om hvorfor dette er viktig for deg?",
	"Flott! La oss bryte dette ned i konkrete, målbare delmål. Hva tenker du er første skritt?",
	"Det er et godt utgangspunkt. Hvor ofte tenker du det er realistisk å jobbe med dette?",
	"Perfekt! Jeg vil foreslå at vi setter opp noen konkrete målsetninger basert på dette.",
	"Bra! Husk at små, konsistente steg gir bedre resultater enn store sporadiske innsatser."
];

let responseIndex = 0;

export const GET: RequestHandler = async () => {
	return json({ 
		status: 'ok',
		message: 'Chat API is ready. POST a message to /api/chat to get a response.'
	});
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { message } = await request.json();

		if (!message || typeof message !== 'string') {
			return json({ error: 'Invalid message' }, { status: 400 });
		}

		// Mock response - cycle through responses
		const responseMessage = mockResponses[responseIndex % mockResponses.length];
		responseIndex++;

		// Simulate API delay
		await new Promise(resolve => setTimeout(resolve, 500));

		return json({ message: responseMessage });
	} catch (error) {
		console.error('Error in chat API:', error);
		return json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	}
};
