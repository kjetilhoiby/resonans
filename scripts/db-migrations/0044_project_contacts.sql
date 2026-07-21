-- Prosjekt-kontakter for kommunikasjons-/arrangement-prosjekter (parentTheme='Hjem').
-- Prosjekter som handler om å purre, samle kontaktinfo og ta telefoner/mailer bruker
-- denne i stedet for kappliste. followUpAt driver purre-nudgen.

CREATE TABLE IF NOT EXISTS project_contacts (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
	name text NOT NULL,
	role text,
	phone text,
	email text,
	status text NOT NULL DEFAULT 'todo',
	notes text,
	follow_up_at text,
	last_contacted_at timestamp,
	sort_order integer NOT NULL DEFAULT 0,
	created_at timestamp NOT NULL DEFAULT now(),
	updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_contacts_theme_idx ON project_contacts (theme_id);
CREATE INDEX IF NOT EXISTS project_contacts_user_followup_idx ON project_contacts (user_id, follow_up_at);
