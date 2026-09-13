-- Trust Foundation Supabase prerequisite migration V1
--
-- This migration was added after the original Gate as an explicit historical
-- prerequisite. Its version is intentionally ordered after initial_schema and
-- before semantic_verification_v1 for deterministic clean installs. Existing
-- historical migration files remain byte-for-byte unchanged.

create table public.task_contract_versions (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in ('DRAFT', 'LOCKED', 'SUPERSEDED', 'CANCELLED')),
  contract_json jsonb not null check (jsonb_typeof(contract_json) = 'object'),
  contract_sha256 text not null check (contract_sha256 ~ '^[a-f0-9]{64}$'),
  created_by text not null,
  created_at timestamptz not null,
  locked_at timestamptz,
  superseded_at timestamptz,
  unique (task_id, version)
);

create index idx_task_contract_versions_task
  on public.task_contract_versions(task_id, version desc);
create unique index idx_task_contract_one_locked
  on public.task_contract_versions(task_id) where status = 'LOCKED';

alter table public.job_runs
  add column task_contract_version_id uuid references public.task_contract_versions(id);

create table public.permission_leases (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  task_contract_version_id uuid not null references public.task_contract_versions(id),
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  agent_id uuid not null references public.agents(id),
  worker_id uuid not null references public.worker_nodes(id),
  version integer not null check (version > 0),
  status text not null check (status in (
    'PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'VIOLATED', 'COMPLETED'
  )),
  scope_json jsonb not null check (jsonb_typeof(scope_json) = 'object'),
  starts_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null,
  created_by text not null,
  check (
    (status = 'PENDING' and starts_at is null and expires_at is null)
    or (status <> 'PENDING' and starts_at is not null and expires_at is not null)
  ),
  unique (job_run_id, version)
);

create index idx_permission_leases_job
  on public.permission_leases(job_run_id, version desc);
create unique index idx_permission_leases_one_active
  on public.permission_leases(job_run_id) where status = 'ACTIVE';
create unique index idx_permission_leases_one_live
  on public.permission_leases(job_run_id) where status in ('PENDING', 'ACTIVE');
create unique index idx_permission_lease_contract_version
  on public.permission_leases(task_id, task_contract_version_id, version);

create table public.evidence_ledger_entries (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  entry_type text not null check (entry_type in (
    'CONTRACT_LOCKED', 'PERMISSION_GRANTED', 'JOB_CLAIMED', 'HEARTBEAT_RECORDED',
    'EXECUTION_STARTED', 'REPOSITORY_CLONE_STARTED', 'REPOSITORY_CLONE_COMPLETED',
    'REMOTE_METADATA_CAPTURED', 'FILE_MANIFEST_CREATED',
    'ARTIFACT_CREATED', 'ARTIFACT_UPLOADED', 'ARTIFACT_HASH_VERIFIED',
    'REMOTE_COMMIT_VERIFIED', 'REPOSITORY_VERIFIED', 'SOURCE_PACKAGE_CREATED',
    'SOURCE_PACKAGE_VERIFIED', 'SOURCE_PACKAGE_UPLOADED', 'SOURCE_MANIFEST_VERIFIED',
    'NETWORK_POLICY_UPDATED', 'DEPENDENCY_INSTALL_STARTED',
    'DEPENDENCY_INSTALL_COMPLETED', 'BUILD_STARTED', 'BUILD_COMPLETED',
    'TEST_STARTED', 'TEST_FAILED', 'SOURCE_INTEGRITY_VERIFIED',
    'MANAGED_SANDBOX_REQUESTED', 'MANAGED_SANDBOX_CREATED',
    'MANAGED_SANDBOX_POLICY_VERIFIED', 'MANAGED_SANDBOX_STARTED',
    'NETWORK_PROBE_COMPLETED', 'MANAGED_SANDBOX_STOP_REQUESTED',
    'MANAGED_SANDBOX_STOPPED', 'MANAGED_SANDBOX_CLEANUP_VERIFIED',
    'TIMEOUT_TRIGGERED', 'STALE_RESULT_REJECTED', 'VERIFICATION_PASSED',
    'VERIFICATION_FAILED', 'PERMISSION_VIOLATION', 'WORKSPACE_CLEANED',
    'RECEIPT_CREATED'
  )),
  source_record_type text not null,
  source_record_id text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  previous_entry_sha256 text check (
    previous_entry_sha256 is null or previous_entry_sha256 ~ '^[a-f0-9]{64}$'
  ),
  entry_sha256 text not null check (entry_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  unique (job_run_id, sequence_number),
  unique (job_run_id, entry_sha256)
);

create index idx_evidence_ledger_job
  on public.evidence_ledger_entries(job_run_id, sequence_number);

create table public.job_receipts (
  id uuid primary key,
  receipt_public_id text not null unique,
  task_id uuid not null references public.tasks(id) on delete cascade,
  job_run_id uuid not null references public.job_runs(id) on delete cascade,
  task_contract_version_id uuid not null references public.task_contract_versions(id),
  permission_lease_id uuid not null references public.permission_leases(id),
  result text not null constraint job_receipts_result_check check (result in (
    'VERIFIED', 'PARTIALLY_VERIFIED', 'FAILED', 'UNVERIFIED', 'DISPUTED',
    'PERMISSION_VIOLATION', 'INVALID_EVIDENCE_CHAIN'
  )),
  receipt_json jsonb not null check (jsonb_typeof(receipt_json) = 'object'),
  receipt_sha256 text not null check (receipt_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_chain_sha256 text not null check (evidence_chain_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  invalidated_at timestamptz,
  invalidation_reason text,
  unique (job_run_id)
);

create or replace function private.enforce_task_contract_immutable_content()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if old.status <> 'DRAFT' and (
    new.id is distinct from old.id
    or new.contract_json is distinct from old.contract_json
    or new.contract_sha256 is distinct from old.contract_sha256
    or new.version is distinct from old.version
    or new.task_id is distinct from old.task_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.locked_at is distinct from old.locked_at
  ) then
    raise exception 'Locked Task Contract content is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_task_contract_status()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (old.status = 'DRAFT' and new.status not in ('DRAFT', 'LOCKED', 'CANCELLED'))
    or (old.status = 'LOCKED' and new.status not in ('LOCKED', 'SUPERSEDED', 'CANCELLED'))
    or (old.status = 'SUPERSEDED' and new.status <> 'SUPERSEDED')
    or (old.status = 'CANCELLED' and new.status <> 'CANCELLED')
  then
    raise exception 'Task Contract status transition is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_contract_locked_content_immutable
before update on public.task_contract_versions
for each row execute function private.enforce_task_contract_immutable_content();

create trigger trg_contract_status_guard
before update of status on public.task_contract_versions
for each row execute function private.enforce_task_contract_status();

create trigger trg_contract_no_delete
before delete on public.task_contract_versions
for each row execute function private.reject_row_mutation();

create or replace function private.enforce_job_contract_binding()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.task_contract_version_id is not null and not exists (
    select 1
    from public.task_contract_versions contract
    where contract.id = new.task_contract_version_id
      and contract.task_id = new.task_id
      and contract.status in ('LOCKED', 'SUPERSEDED')
  ) then
    raise exception 'Job Run Task Contract binding is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_job_contract_binding_insert
before insert on public.job_runs
for each row execute function private.enforce_job_contract_binding();

create trigger trg_job_contract_binding_update
before update of task_contract_version_id, task_id on public.job_runs
for each row execute function private.enforce_job_contract_binding();

create or replace function private.enforce_permission_lease_binding()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.job_runs run
    where run.id = new.job_run_id
      and run.task_id = new.task_id
      and run.worker_id = new.worker_id
      and run.agent_id = new.agent_id
      and run.task_contract_version_id = new.task_contract_version_id
  ) then
    raise exception 'Permission Lease binding is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_permission_lease_immutable_content()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.task_id is distinct from old.task_id
    or new.task_contract_version_id is distinct from old.task_contract_version_id
    or new.job_run_id is distinct from old.job_run_id
    or new.agent_id is distinct from old.agent_id
    or new.worker_id is distinct from old.worker_id
    or new.version is distinct from old.version
    or new.scope_json is distinct from old.scope_json
    or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by
    or (old.status <> 'PENDING' and (
      new.starts_at is distinct from old.starts_at
      or new.expires_at is distinct from old.expires_at
    ))
    or (old.status in ('COMPLETED', 'EXPIRED', 'REVOKED', 'VIOLATED') and (
      new.revoked_at is distinct from old.revoked_at
      or new.revoke_reason is distinct from old.revoke_reason
    ))
  then
    raise exception 'Permission Lease binding and scope are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_permission_lease_status()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (old.status = 'PENDING' and new.status not in (
      'PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED', 'VIOLATED'
    ))
    or (old.status = 'ACTIVE' and new.status not in (
      'ACTIVE', 'COMPLETED', 'EXPIRED', 'REVOKED', 'VIOLATED'
    ))
    or (old.status in ('COMPLETED', 'EXPIRED', 'REVOKED', 'VIOLATED')
      and new.status <> old.status)
  then
    raise exception 'Permission Lease status transition is invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_permission_lease_dates()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.status <> 'PENDING' and (
    new.starts_at is null
    or new.expires_at is null
    or new.expires_at <= new.starts_at
  ) then
    raise exception 'Permission Lease effective dates are invalid' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_permission_binding_insert
before insert on public.permission_leases
for each row execute function private.enforce_permission_lease_binding();

create trigger trg_permission_binding_immutable
before update on public.permission_leases
for each row execute function private.enforce_permission_lease_immutable_content();

create trigger trg_permission_status_guard
before update of status on public.permission_leases
for each row execute function private.enforce_permission_lease_status();

create trigger trg_permission_dates_insert
before insert on public.permission_leases
for each row execute function private.enforce_permission_lease_dates();

create trigger trg_permission_dates_update
before update of status, starts_at, expires_at on public.permission_leases
for each row execute function private.enforce_permission_lease_dates();

create trigger trg_permission_no_delete
before delete on public.permission_leases
for each row execute function private.reject_row_mutation();

create trigger trg_evidence_ledger_no_update
before update on public.evidence_ledger_entries
for each row execute function private.reject_row_mutation();

create trigger trg_evidence_ledger_no_delete
before delete on public.evidence_ledger_entries
for each row execute function private.reject_row_mutation();

create or replace function private.enforce_job_receipt_immutable_content()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.receipt_public_id is distinct from old.receipt_public_id
    or new.task_id is distinct from old.task_id
    or new.task_contract_version_id is distinct from old.task_contract_version_id
    or new.permission_lease_id is distinct from old.permission_lease_id
    or new.created_at is distinct from old.created_at
    or new.receipt_json is distinct from old.receipt_json
    or new.receipt_sha256 is distinct from old.receipt_sha256
    or new.evidence_chain_sha256 is distinct from old.evidence_chain_sha256
    or new.result is distinct from old.result
    or new.job_run_id is distinct from old.job_run_id
  then
    raise exception 'Verified Job Receipt content is immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function private.enforce_job_receipt_invalidation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (old.invalidated_at is not null and (
      new.invalidated_at is null
      or new.invalidated_at is distinct from old.invalidated_at
      or new.invalidation_reason is distinct from old.invalidation_reason
    ))
    or (old.invalidated_at is null and new.invalidated_at is null
      and new.invalidation_reason is distinct from old.invalidation_reason)
  then
    raise exception 'Receipt invalidation is one-way' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger trg_receipt_immutable_content
before update on public.job_receipts
for each row execute function private.enforce_job_receipt_immutable_content();

create trigger trg_receipt_no_delete
before delete on public.job_receipts
for each row execute function private.reject_row_mutation();

create trigger trg_receipt_invalidation_guard
before update of invalidated_at, invalidation_reason on public.job_receipts
for each row execute function private.enforce_job_receipt_invalidation();

revoke all on public.task_contract_versions, public.permission_leases,
  public.evidence_ledger_entries, public.job_receipts
from public, anon, authenticated;

grant all on public.task_contract_versions, public.permission_leases,
  public.evidence_ledger_entries, public.job_receipts
to service_role;

grant select on public.task_contract_versions, public.permission_leases,
  public.evidence_ledger_entries, public.job_receipts
to authenticated;

alter table public.task_contract_versions enable row level security;
alter table public.permission_leases enable row level security;
alter table public.evidence_ledger_entries enable row level security;
alter table public.job_receipts enable row level security;

create policy task_contract_versions_participant_select
on public.task_contract_versions for select to authenticated
using ((select private.can_access_task(task_id)));

create policy permission_leases_participant_select
on public.permission_leases for select to authenticated
using ((select private.can_access_task(task_id)));

create policy evidence_ledger_entries_participant_select
on public.evidence_ledger_entries for select to authenticated
using ((select private.can_access_task(task_id)));

create policy job_receipts_participant_select
on public.job_receipts for select to authenticated
using ((select private.can_access_task(task_id)));

revoke all on function private.enforce_task_contract_immutable_content()
  from public, anon, authenticated;
revoke all on function private.enforce_task_contract_status()
  from public, anon, authenticated;
revoke all on function private.enforce_job_contract_binding()
  from public, anon, authenticated;
revoke all on function private.enforce_permission_lease_binding()
  from public, anon, authenticated;
revoke all on function private.enforce_permission_lease_immutable_content()
  from public, anon, authenticated;
revoke all on function private.enforce_permission_lease_status()
  from public, anon, authenticated;
revoke all on function private.enforce_permission_lease_dates()
  from public, anon, authenticated;
revoke all on function private.enforce_job_receipt_immutable_content()
  from public, anon, authenticated;
revoke all on function private.enforce_job_receipt_invalidation()
  from public, anon, authenticated;

grant execute on function private.enforce_task_contract_immutable_content()
  to service_role;
grant execute on function private.enforce_task_contract_status()
  to service_role;
grant execute on function private.enforce_job_contract_binding()
  to service_role;
grant execute on function private.enforce_permission_lease_binding()
  to service_role;
grant execute on function private.enforce_permission_lease_immutable_content()
  to service_role;
grant execute on function private.enforce_permission_lease_status()
  to service_role;
grant execute on function private.enforce_permission_lease_dates()
  to service_role;
grant execute on function private.enforce_job_receipt_immutable_content()
  to service_role;
grant execute on function private.enforce_job_receipt_invalidation()
  to service_role;
