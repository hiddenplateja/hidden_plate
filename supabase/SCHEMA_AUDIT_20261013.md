# Read-only schema audit — 2026-10-13

Project `ezhnntopskzlhllljbdv`, PostgreSQL 17.6. Initial capture was read-only;
the separately approved permission correction below was then applied/tested.
The dashboard shows three deployed functions (`send-push`, `delete-account`,
`retry-account-deletion`). The payment verifier is not deployed; payment settings
are disabled and the deferred verification-budget table is absent.

All 33 public application tables have RLS enabled. The database has three public
enums, 102 non-extension public functions and one controlled public-profile view.
Safe metadata confirms the insert push webhook and one active per-minute push
retry job; no webhook arguments, cron commands, credentials or private rows were
read/exported. The schema-only recovery CSV and capture limitations are in
[baseline/README.md](baseline/README.md).

## Cutover permission finding

The initial audit found both `anon` and `authenticated` held `TRUNCATE`, `TRIGGER`, `REFERENCES`
and PostgreSQL 17's `MAINTAIN` on `restaurants` and `notifications`. `anon` also
held an unnecessary notifications `DELETE` grant. These came from broad initial
grants not fully removed by earlier targeted migrations. `authenticated` DELETE
on notifications/reviews/push tokens is intentional and constrained by policies;
notification UPDATE remains column-limited to `is_read`.

RLS does not protect whole-table operations such as TRUNCATE, per
[PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
This does NOT mean PostgREST exposes a public TRUNCATE endpoint; it is a
least-privilege gap to remove before cutover. No destructive operation was tested
live and no real data was deleted.

Migration `20261013000027_nonpayment_privilege_cleanup.sql` was applied with user
approval on 2026-10-13. It only removes those administrative privileges from ordinary roles
on existing public tables, removes anonymous inbox deletion and narrows matching
`postgres` public-table defaults. It preserves reads, RLS/policies, RPC execution,
owner inbox/read-state/review/token actions and server/admin functionality.
Managed `supabase_admin` defaults are not modified. Future migrations still need
explicit grants/revokes and an audit; this is not a complete security certification.

Rollback-only tests passed new-table default checks and owner inbox read/mark-read/
delete, other-user deletion denial, body-update denial and anonymous deletion
denial. They used two synthetic accounts with notifications disabled; all fixtures
and queued requests rolled back. No real table was truncated or real data deleted.

The final read-only audit passed across all public tables: administrative table/
column grants are absent for ordinary roles, RLS remains enabled, owner inbox
actions remain column-limited, review/token DELETE and admin RPC EXECUTE grants
remain, trusted server grants are unchanged, payments remain disabled and no
fixtures remain. This checks grants, not end-to-end admin/device workflows.
All 269 staged app-service/auth tests also passed. No user was assigned admin,
and no UI, payment, webhook, function deployment or Appwrite routing changed.
Isolated local PostgreSQL restore verification subsequently passed on 2026-10-13:
all 1,470 snapshot statements, 102 function definitions and 19 non-payment SQL
suites. See `baseline/restore-test-20261013.json`. Managed Auth is simulated;
hosted-service restore and physical-device regression remain outstanding.
