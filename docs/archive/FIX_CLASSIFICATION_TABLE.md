# Quick Fix: Classification Overrides Table Missing

## Problem
The `classification_overrides` table doesn't exist in production database, causing 500 errors.

## Solution

Run this SQL against your production database:

```bash
# If you have psql installed and can connect to Neon:
psql $PRODUCTION_DATABASE_URL -f fix-classification-overrides-table.sql
```

**OR** use the Neon web console:

1. Go to https://console.neon.tech
2. Select your project
3. Go to "SQL Editor"
4. Copy and paste the contents of `fix-classification-overrides-table.sql`
5. Click "Run"

**OR** temporarily set your production DATABASE_URL locally:

```bash
# In .env - temporarily point to production
DATABASE_URL=your-neon-production-url-here

# Push schema (will create missing tables)
npm run db:push

# IMPORTANT: Revert .env to local database after!
```

## What it does

The SQL file safely creates the `classification_overrides` table with:
- All required columns
- Foreign key to users table
- Unique constraint on (user_id, domain, fingerprint)
- Lookup index for queries

It uses `IF NOT EXISTS` checks so it's safe to run multiple times.
