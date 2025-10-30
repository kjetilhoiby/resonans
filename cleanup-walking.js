import { db } from './src/lib/db/index';
import { sensorEvents } from './src/lib/db/schema';
import { sql } from 'drizzle-orm';

async function cleanupWalking() {
	console.log('🗑️  Deleting walking workouts...');
	
	const result = await db.delete(sensorEvents)
		.where(
			sql`${sensorEvents.dataType} = 'workout' AND (
				${sensorEvents.data}->>'sportType' = 'walking' 
				OR ${sensorEvents.data}->>'sportType' = 'indoor_walking'
				OR ${sensorEvents.data}->>'sportType' = 'no_activity'
			)`
		);
	
	console.log('✅ Deleted walking workouts');
	process.exit(0);
}

cleanupWalking().catch(console.error);
