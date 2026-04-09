#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${TARGET_DB_URL:-}" ]]; then
  echo "TARGET_DB_URL is required (e.g., postgres://user:pass@localhost:5432/dbname)" >&2
  exit 1
fi

SCHEMA_FILE="${1:-./schema.sql}"
DUMP_FILE="${2:-./data.sql}"
SKIP_EXTENSIONS="${SKIP_EXTENSIONS:-1}"

if [[ ! -f "${SCHEMA_FILE}" ]]; then
  echo "Schema file not found: ${SCHEMA_FILE}" >&2
  exit 1
fi

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Data file not found: ${DUMP_FILE}" >&2
  exit 1
fi

schema_source="${SCHEMA_FILE}"
cleanup_schema=""

if [[ "${SKIP_EXTENSIONS}" == "1" ]]; then
  temp_schema="$(mktemp)"
  cleanup_schema="${temp_schema}"
  grep -v -E '^(CREATE|COMMENT ON) EXTENSION' "${SCHEMA_FILE}" \
    | sed -E 's/"auth"\."uid"\(\)/NULL::uuid/g' \
    | sed -E 's/DEFAULT[[:space:]]+"extensions"\."uuid_generate_v4"\(\)//g' \
    | sed -E 's/"supabase_functions"\."http_request"\([^)]*\)/NULL/g' \
    | grep -v -E 'EXECUTE FUNCTION (supabase_functions|NULL)' \
    | grep -v -E '^CREATE PUBLICATION|^ALTER PUBLICATION' \
    > "${temp_schema}"
  schema_source="${temp_schema}"
fi

echo "Importing ${schema_source} into ${TARGET_DB_URL}"
psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  create role authenticated;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  create role anon;
exception
  when duplicate_object then null;
end $$;
do $$
begin
  create role service_role;
exception
  when duplicate_object then null;
end $$;
SQL
psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1 <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key);
create table if not exists auth.audit_log_entries (id uuid primary key, instance_id uuid, payload jsonb, created_at timestamptz, ip_address text);
create table if not exists public.audit_log_entries (id uuid primary key, instance_id uuid, payload jsonb, created_at timestamptz, ip_address text);
create table if not exists auth.flow_state (id uuid primary key);
create table if not exists storage.objects (id uuid primary key);
alter table if exists auth.audit_log_entries add column if not exists instance_id uuid;
alter table if exists public.audit_log_entries add column if not exists instance_id uuid;
alter table if exists auth.audit_log_entries add column if not exists payload jsonb;
alter table if exists public.audit_log_entries add column if not exists payload jsonb;
alter table if exists auth.audit_log_entries add column if not exists created_at timestamptz;
alter table if exists public.audit_log_entries add column if not exists created_at timestamptz;
alter table if exists auth.audit_log_entries add column if not exists ip_address text;
alter table if exists public.audit_log_entries add column if not exists ip_address text;
alter table if exists auth.flow_state add column if not exists id uuid;
SQL
psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1 -f "${schema_source}"

if [[ -n "${cleanup_schema}" ]]; then
  rm -f "${cleanup_schema}"
fi

echo "Importing ${DUMP_FILE} into ${TARGET_DB_URL}"
echo "Attempting to disable triggers for circular FK constraints..."

if command -v rg >/dev/null 2>&1; then
  schemas=$(rg -N --no-line-number --only-matching -o '^COPY\s+[^.]+\.' "${DUMP_FILE}" \
    | sed -E 's/^COPY\s+//; s/"//g; s/\.$//' \
    | awk -F'.' '{print $1}' \
    | sort -u)
else
  schemas=$(grep -E '^COPY[[:space:]]+[^.]+' "${DUMP_FILE}" \
    | sed -E 's/^COPY[[:space:]]+//; s/"//g; s/\.$//' \
    | awk -F'.' '{print $1}' \
    | sort -u)
fi

for schema in ${schemas}; do
  if [[ "${schema}" != "public" ]]; then
    echo "Creating schema if missing: ${schema}"
    psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1 -c "create schema if not exists \"${schema}\";"
  fi
done

{
  echo "SET session_replication_role = replica;"
  cat "${DUMP_FILE}"
  echo "SET session_replication_role = origin;"
} | psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=1

echo "Done."
