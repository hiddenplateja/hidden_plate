# Public schema recovery candidate

Captured read-only on 2026-10-13 from Supabase test project
`ezhnntopskzlhllljbdv` (PostgreSQL 17.6). This is schema metadata, NOT a complete
database/data backup or a hosted restore. The isolated local restore test below
passed; hosted Supabase/managed-service testing is still pending. No live DDL, role assignment, deletion,
push, payment activation, deployment or app cutover ran during capture.

`schema-snapshot-20261013.csv` contains 1,470 ordered DDL rows: 33 tables, three
enums, 158 constraints, 28 independent indexes, 102 functions, one view, 58
policies, 26 safe triggers, RLS settings and current table/column/function grants.
Counts and UTF-8 DDL byte totals matched the live metadata summary. An initial
capture was corrected to create the public-profile view BEFORE functions that
use its composite return type; only the corrected capture belongs here.

This snapshot predates the separately approved/tested permission cleanup in
migration 27. It is preserved unchanged with its original checksum. Apply ONLY
that post-snapshot correction during a disposable restore, not historical 1-25
or deferred payment migration 26. The live project no longer has the unnecessary
grants captured in this snapshot.

`export_schema.sql` is a SELECT-only generator; SQL-editor warnings triggered
because its strings contain CREATE statements, not because it creates objects.
The downloaded CSV preserves full DDL, including multiline bodies. A credential
pattern guard found no blocked definitions; literal webhook headers were never
read/exported. Schema names are not a promise that every function is secure.

## Deliberately excluded

- All application rows, Auth users/sessions/identities, uploaded files and R2 data.
- Credentials, Vault rows/decrypted values, role passwords or grants on external
  managed schemas. Function bodies refer to Vault secret NAMES, never values.
- The credential-bearing `notifications_send_push` webhook trigger and any
  triggers with arguments; cron command bodies and scheduled jobs.
- Managed Supabase schemas/extensions, default privileges, column collations,
  owner changes, extension-member functions and schema-level privileges.

Preflight found no public sequences, identity columns, domains, partitions or
non-default column collations/trigger modes. The public view has no function
dependency. Four functions return its row type, hence phase 45 for the view.
The snapshot requires a matching Supabase-managed environment and execution as
`postgres`; it is not a standalone plain PostgreSQL bootstrap.

## Hosted restore preparation, NOT performed

1. Use a separately approved DISPOSABLE Supabase project with no application
   objects, no real accounts/data and no push/webhook/cron activity. Never run
   this snapshot against the existing project or production.
2. Enable required managed extensions separately (`pgcrypto`, `pg_net`, Vault;
   `pg_cron` only when scheduling is explicitly authorized). Restore SQL by joining
   CSV `ddl` fields in their captured order; do not naively split CSV by commas or
   SQL by semicolons (bodies contain both).
3. Review the captured grants first: they preserve known unnecessary privileges
   on restaurants/notifications. Apply the approved permission correction to the
   disposable restore before marking it safe for app use.
4. Seed ONLY reviewed configuration defaults, with payment settings disabled.
   No admin/user is auto-created. Reapply environment-specific Auth/email/OAuth,
   R2/Worker and deployed-function configuration with separately entered secrets.
5. Recreate authenticated push webhook and retries separately, with approval;
   don't restore literal headers or cron SQL from a raw project dump.
6. Run rollback SQL contract tests and permission audits, compare the object
   manifest, and verify physical-device auth/storage/push/navigation before cutover.

This is a CURRENT-STATE snapshot through applied migration 25. Do NOT replay
migrations 1-25 over it; they include non-idempotent creates and historical state.
Migration 26 is unapplied/deferred payment work. A verified rebuild/migration
history strategy and full data backup remain separate tasks.

Supabase's [backup/restore documentation](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
is the preferred full-project recovery procedure when CLI/database access is
available. No local `psql`, Docker or Supabase CLI executable was available for
a disposable restore test in this capture.

## Isolated local restore passed — 2026-10-13

`test_restore.mjs` verifies the CSV checksum/counts/bytes and restores all 1,470
statements into a fresh in-memory PostgreSQL engine. It validates all 102 function
definitions with body checks enabled after dependencies exist, applies only the
post-snapshot permission correction (27), seeds safe config defaults, compares
the 33-table/102-function/58-policy/26-safe-trigger graph, then runs 19 non-payment
SQL contract/audit suites. All passed; no synthetic accounts remained; payments
stayed disabled. See `restore-test-20261013.json` for exact results/limitations.

The reproducible engine is PGlite 0.3.14 (PostgreSQL 17.5), matching the live
project's PostgreSQL 17 major version (live patch 17.6). A preliminary PostgreSQL
18.6 run also passed the 19 suites. No application dependency or live project was
changed; the engine is loaded from the trusted npm registry into Deno's cache.
The process receives local read permission only, no network/env/write permission.
Its database is memory-only and accepts no remote URL or credential.

Run from the repository root:

```powershell
npx deno run --no-config --no-lock --node-modules-dir=none --allow-read supabase/baseline/test_restore.mjs
```

The test supplies minimal Auth users/identities/uid/jwt doubles. It does NOT
simulate GoTrue, actual JWT validation, SMTP/OAuth, Vault values, pg_net/webhook/
cron HTTP, Edge deployment, R2 or phone behavior. There is only one connection,
so concurrency stress is not covered. The credential-bearing webhook remains
excluded. Local schema/contract validation does not certify a complete hosted
restore or make the app ready for cutover.

Reference: official [PGlite setup](https://pglite.dev/docs/) and
[API](https://pglite.dev/docs/api). Keep the pinned engine version for reproducible
tests; do not enable deferred payment migration 26 or native checkout.
