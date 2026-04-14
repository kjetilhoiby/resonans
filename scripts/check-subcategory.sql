-- Temporary SQL to populate subcategory field
-- This will set all subcategories to NULL for now; they will be populated
-- on next sync when classifications change or new transactions arrive.

-- Just verify the column exists
SELECT COUNT(*) as total_events, 
       COUNT(resolved_subcategory) as with_subcategory
FROM categorized_events;
