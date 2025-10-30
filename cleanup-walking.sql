-- Delete walking workouts from sensor_events
DELETE FROM sensor_events 
WHERE data_type = 'workout' 
AND (
  data->>'sportType' = 'walking' 
  OR data->>'sportType' = 'indoor_walking'
  OR data->>'sportType' = 'no_activity'
);
