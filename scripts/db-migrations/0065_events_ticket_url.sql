-- Lenke til billetten hos utstederen (Ticketmaster, Cosmopolite, …).
--
-- Et skjermbilde er et øyeblikksbilde: blir arrangementet flyttet, sier bildet
-- fortsatt den gamle datoen. Billettsidene krever som regel ikke innlogging, så
-- lenka er den levende utgaven ved siden av den lagrede.
ALTER TABLE events ADD COLUMN IF NOT EXISTS ticket_url text;
