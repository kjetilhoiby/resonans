-- Rydder `running`-rader i background_jobs som ingen eier.
--
-- Målt i prod 4. september 2026 sto tre `batch:withings_backfill` i `running`
-- med `locked_by = NULL` og `started_at` 28 døgn tilbake. Batch-jobber settes
-- rett i `running` av `startBatchJob` og drives av en løkke i NETTLESEREN;
-- lukkes fanen, er det ingen som fortsetter. `executeJob` har ingen
-- `batch:*`-gren, så ingen worker kan overta dem heller.
--
-- Reaperen i `recoverStaleRunningJobs` fanger dette videre (se
-- $lib/domain/stale-jobs). Denne migrasjonen rydder radene som alt ligger der,
-- så tabellen ikke fortsetter å påstå at noe kjører fram til første sveip.
--
-- Idempotent: WHERE-en treffer ingenting når radene alt er ryddet, og
-- `updated_at`-grensa gjør at en batch som faktisk steppes akkurat nå står
-- urørt (`stepBatchJob` skriver `updated_at` for hvert steg).

UPDATE background_jobs
SET status = 'failed',
    error = COALESCE(
      NULLIF(error, ''),
      'Jobben sto i «running» uten eier og uten livstegn på 30 min. Batch-jobber drives av en løkke i nettleseren; denne ble forlatt. Start den på nytt for å fortsette.'
    ),
    finished_at = COALESCE(finished_at, NOW()),
    locked_at = NULL,
    locked_by = NULL,
    updated_at = NOW()
WHERE status = 'running'
  AND locked_by IS NULL
  AND (updated_at IS NULL OR updated_at < NOW() - INTERVAL '30 minutes');
