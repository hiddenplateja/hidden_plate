// LOCAL MEMORY ONLY. No URL/client/credential/production database is accepted.
// PGlite supplies PostgreSQL; minimal managed Auth boundaries are test doubles.
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

const directory = new URL("./", import.meta.url);
const text = path => Deno.readTextFile(new URL(path, directory));
function assert(value, message) { if (!value) throw new Error(message); }
function csv(raw) {
  const records = []; let record = [], field = "", quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      if (quoted && raw[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { record.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      record.push(field); if (record.some(Boolean)) records.push(record); record = []; field = "";
    } else field += char;
  }
  assert(!quoted, "Unterminated CSV quote");
  if (field || record.length) { record.push(field); records.push(record); }
  const headers = records.shift();
  return records.map(record => {
    assert(record.length === headers.length, "CSV column count mismatch");
    return Object.fromEntries(headers.map((header, index) => [header, record[index]]));
  });
}
// Test escaped quotes, commas and multiline fields before trusting schema CSV.
assert(csv('a,b\r\n1,"two,\n""quotes"""\r\n')[0].b === 'two,\n"quotes"', "CSV parser self-test failed");
const manifest = JSON.parse(await text("manifest.json"));
const bytes = await Deno.readFile(new URL(manifest.file, directory));
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
assert(hash === manifest.sha256, "Snapshot checksum mismatch");
const rows = csv(new TextDecoder().decode(bytes));
assert(rows.length === manifest.rows, "Snapshot row count mismatch");
let previous = -1;
for (const row of rows) {
  assert(Number(row.phase) >= previous, "Unordered snapshot"); previous = Number(row.phase);
  assert(!row.ddl.includes("-- BLOCKED:"), "Blocked credential definition present");
}
for (const [kind, expected] of Object.entries(manifest.objects)) {
  const group = rows.filter(row => row.kind === kind);
  assert(group.length === expected.count && group.reduce((sum, row) => sum + new TextEncoder().encode(row.ddl).length, 0) === expected.ddlBytes, `Manifest mismatch: ${kind}`);
}

const db = new PGlite();
const passed = []; const failed = [];
try {
  await db.waitReady;
  console.log(JSON.stringify({ stage: "local_engine", postgres: (await db.query("select version()" )).rows[0].version }));
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema vault; create schema net;
    create table auth.users(
      id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,
      encrypted_password text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',
      created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id)on delete cascade,
      provider_id text,provider text,identity_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),last_sign_in_at timestamptz);
    create function auth.uid()returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    create function auth.jwt()returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');$$;
    grant usage on schema public,auth,extensions to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.jwt()to anon,authenticated,service_role;
    grant all on auth.users,auth.identities to service_role;
    -- Reproduce app-owned public-table defaults so migration 27 tests its scope.
    alter default privileges for role postgres in schema public grant all on tables to anon,authenticated,service_role;
  `);
  for (const row of rows) {
    try { await db.exec(row.ddl); }
    catch (error) {
      // Object labels/PG code only, no entire SQL payload or credentials in errors.
      throw new Error(`Restore failed at phase ${row.phase}, ${row.kind} ${row.object_name}: ${error.code ?? "unknown"} ${error.message}`);
    }
  }
  console.log(JSON.stringify({ stage: "snapshot_restored", statements: rows.length }));
  // Creation order temporarily disabled body checks. Now all dependencies exist:
  // recompile every captured function with PostgreSQL's checks enabled.
  await db.exec("set check_function_bodies=true;");
  for (const row of rows.filter(row => row.kind === "function")) {
    try { await db.exec(row.ddl); }
    catch (error) { throw new Error(`Function validation failed: ${row.object_name}: ${error.code ?? "unknown"} ${error.message}`); }
  }
  console.log(JSON.stringify({ stage: "function_definitions_validated", functions: 102 }));
  await db.exec(await text("../migrations/20261013000027_nonpayment_privilege_cleanup.sql"));
  await db.exec(`insert into public.app_config(id)values(true);insert into public.app_control(id,maintenance)values(true,false);
    insert into public.moderation_config(id,review_report_threshold)values(true,3);insert into public.purchase_settings(id)values(true);`);
  const counts = (await db.query(`select
    (select count(*)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relkind='r')as tables,
    (select count(*)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.prokind='f')as functions,
    (select count(*)from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')as policies,
    (select count(*)from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and(n.nspname='public'or(n.nspname='auth'and c.relname='users')))as safe_triggers`)).rows[0];
  assert(Number(counts.tables) === 33 && Number(counts.functions) === 102 && Number(counts.policies) === 58 && Number(counts.safe_triggers) === 26, "Restored object graph mismatch");
  console.log(JSON.stringify({ stage: "graph_verified", ...counts }));
  await db.exec(await text("../migrations/20261020000028_welcome_emails.sql"));
  const suites = [
    "welcome_emails",
    "nonpayment_privilege_cleanup", "nonpayment_privilege_cleanup_audit",
    "auth_signup_completion", "profiles_admin", "moderation_claims", "claim_lifecycle", "restaurant_admin",
    "pagination_media_cleanup", "owner_contracts", "community_contracts",
    "profile_feeds", "profile_feeds_audit", "account_deletion", "account_deletion_audit",
    "saved_block_collection_permissions", "saved_block_collection_audit",
    "account_guards_member_paging", "account_guards_member_paging_audit",
    "remote_configuration", "remote_configuration_audit",
  ];
  for (const suite of suites) {
    // pg_temp helpers do not survive a real pooled Dashboard connection. Explicit
    // drops isolate suites in this single-connection local engine.
    await db.exec("rollback; reset role; discard temp;");
    try {
      await db.exec(await text(`../tests/${suite}.sql`));
      await db.exec("rollback; reset role;"); passed.push(suite); console.log(`PASS ${suite}`);
    } catch (error) {
      await db.exec("rollback; reset role;"); failed.push({ suite, code: error.code, message: error.message });
      console.log(`FAIL ${suite}: ${error.code ?? "unknown"} ${error.message}`);
    }
  }
  const fixtures = (await db.query("select count(*)as accounts from auth.users")).rows[0];
  assert(Number(fixtures.accounts) === 0, "Local synthetic accounts remain");
  assert((await db.query("select enabled from public.purchase_settings where id=true")).rows[0].enabled === false, "Payments were enabled");
  console.log(JSON.stringify({ stage: "local_restore_result", passed, failed, fixtures: 0, paymentsEnabled: false,
    limitations: ["Managed Auth is simulated", "No network/Vault/webhook/cron execution", "Single connection; no concurrent transaction test", "No hosted Supabase/device/storage/push proof"] }));
  if (failed.length) Deno.exitCode = 1;
} finally { await db.close(); }
