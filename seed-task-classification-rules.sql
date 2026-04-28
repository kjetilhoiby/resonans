-- Seed default task classification rules
-- These replace the hardcoded TASK_MATCH_RULES from activities.ts

INSERT INTO task_classification_rules (category, keywords, priority, active, description, created_at, updated_at)
VALUES 
  (
    'workout',
    ARRAY['trening', 'løp', 'km', 'workout', 'exercise'],
    2,
    true,
    'Matches workout and exercise activities',
    NOW(),
    NOW()
  ),
  (
    'relationship',
    ARRAY['deit', 'date', 'parforhold', 'relationship'],
    2,
    true,
    'Matches relationship and dating activities',
    NOW(),
    NOW()
  ),
  (
    'mental',
    ARRAY['stemning', 'mood', 'mental', 'følelse'],
    2,
    true,
    'Matches mental health and mood tracking',
    NOW(),
    NOW()
  ),
  (
    'food',
    ARRAY['middag', 'frokost', 'lunsj', 'matpakke', 'fisk', 'kjøtt', 'pasta', 'suppe', 'salat', 'oppskrift', 'meny', 'måltid', 'grøt', 'pizza', 'taco', 'risotto', 'lasagne', 'gryte', 'wok', 'kylling', 'laks'],
    3,
    true,
    'Matches food and meal planning activities',
    NOW(),
    NOW()
  )
ON CONFLICT DO NOTHING;
