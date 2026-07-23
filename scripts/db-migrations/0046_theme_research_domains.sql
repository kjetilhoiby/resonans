-- Per-tema foretrukne/ekskluderte kilder for websøk (web_search / research).
-- { "include": ["visitnorway.no", ...], "exclude": ["pinterest.com", ...] }
-- Brukes til å styre Tavily include_domains/exclude_domains for dette temaet.

ALTER TABLE themes
	ADD COLUMN IF NOT EXISTS research_domains jsonb;
