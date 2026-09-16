#!/usr/bin/env bash
#
# Compares a live database against the schema these migrations produce.
#
# `verify-schema.sh` proves the migrations build a database that behaves. It
# cannot prove the live database is that database: something created by hand, or
# by the platform, exists there and in no file here, and nothing in CI will ever
# mention it. That is not hypothetical — the `ensure_rls` event trigger ran in
# production for weeks while no migration created it, so a deployment rebuilt
# from this repository would have come up without it.
#
# Needs a connection string for the live database:
#
#   LIVE_DATABASE_URL=postgres://... scripts/compare-live-schema.sh
#
# Objects owned by extensions are left out on both sides: where an extension
# installs its functions is a platform decision, not drift.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$here"

: "${LIVE_DATABASE_URL:?set LIVE_DATABASE_URL to the live database}"

inventory() {
  psql "$1" -tAq <<'SQL'
select 'function  ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       || case when p.prosecdef then '  [definer]' else '' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  left join pg_depend d
    on d.objid = p.oid and d.deptype = 'e'
 where n.nspname = 'public' and d.objid is null
union all
select 'evttrigger ' || evtname || ' on ' || evtevent from pg_event_trigger
union all
select 'table     ' || c.relname
       || case when c.relrowsecurity then '  [rls]' else '  [NO RLS]' end
       || case when c.relforcerowsecurity then ' [forced]' else '' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p')
union all
select 'policy    ' || schemaname || '.' || tablename || ': ' || policyname
  from pg_policies where schemaname = 'public'
order by 1;
SQL
}

echo "→ building the schema these migrations describe"
build_log="$(mktemp)"
if ! scripts/verify-schema.sh >"$build_log" 2>&1; then
  cat "$build_log" >&2
  echo "the migrations do not verify; nothing to compare against" >&2
  exit 1
fi
: "${DATABASE_URL:?verify-schema.sh needs DATABASE_URL too, pointing at a scratch database}"

echo "→ comparing"
if diff -u \
  <(inventory "$DATABASE_URL"   | sed 's/[[:space:]]*$//') \
  <(inventory "$LIVE_DATABASE_URL" | sed 's/[[:space:]]*$//') \
  --label "from migrations" --label "live"
then
  echo "✓ the live database is what these migrations describe"
else
  echo
  echo "✗ they differ. A '+' line exists live and in no migration; a '-' line is"
  echo "  in the migrations and missing live."
  exit 1
fi
