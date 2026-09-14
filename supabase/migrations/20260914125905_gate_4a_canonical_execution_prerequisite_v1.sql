-- Gate 4A-P - canonical verified-work orchestration and persistence prerequisite.
--
-- This migration creates no Work, Contract, Authority, Job, corpus entry, model
-- request, or Sandbox. It supersedes the Beta-only persistence commands with a
-- service-only boundary that derives every execution permission from one locked
-- Contract and one approved, immutable task-scoped Authority record.

create table public.verified_work_execution_envelopes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  assignment_id uuid not null references public.task_assignments(id) on delete restrict,
  job_run_id uuid not null unique references public.job_runs(id) on delete restrict,
  worker_id uuid not null references public.worker_nodes(id) on delete restrict,
  worker_lease_id uuid not null unique references public.worker_job_leases(id) on delete restrict,
  permission_lease_id uuid not null unique references public.permission_leases(id) on delete restrict,
  task_contract_version_id uuid not null references public.task_contract_versions(id) on delete restrict,
  contract_sha256 text not null check (contract_sha256 ~ '^[a-f0-9]{64}$'),
  authority_id uuid not null references public.workspace_authority_reviews(id) on delete restrict,
  authority_scope_sha256 text not null check (authority_scope_sha256 ~ '^[a-f0-9]{64}$'),
  source_repository text not null,
  source_commit text not null check (source_commit ~ '^[a-f0-9]{40}$'),
  source_tree text check (source_tree is null or source_tree ~ '^[a-f0-9]{40}$'),
  workflow_key text not null check (workflow_key in (
    'BETA_GATE_3_MANAGED_REMOTE_EXECUTION',
    'GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1'
  )),
  workflow_source text not null,
  permission_scope_json jsonb not null check (jsonb_typeof(permission_scope_json) = 'object'),
  execution_policy_snapshot jsonb not null check (jsonb_typeof(execution_policy_snapshot) = 'object'),
  envelope_json jsonb not null check (jsonb_typeof(envelope_json) = 'object'),
  envelope_canonical_text text not null,
  envelope_sha256 text not null check (envelope_sha256 ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (idempotency_key ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  unique (task_id, idempotency_key)
);

create index verified_work_execution_envelopes_task_idx
  on public.verified_work_execution_envelopes(task_id, created_at desc);

alter table public.verified_work_execution_envelopes enable row level security;

create policy verified_work_execution_envelopes_participant_select
on public.verified_work_execution_envelopes for select to authenticated
using ((select private.can_access_task(task_id)));

revoke all on table public.verified_work_execution_envelopes from public, anon, authenticated;
grant select on table public.verified_work_execution_envelopes to authenticated;
grant all on table public.verified_work_execution_envelopes to service_role;

create or replace function private.enforce_verified_work_execution_envelope_integrity()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.envelope_canonical_text::jsonb <> new.envelope_json
    or encode(extensions.digest(convert_to(new.envelope_canonical_text, 'UTF8'), 'sha256'), 'hex') <> new.envelope_sha256
    or new.envelope_json ->> 'taskId' <> new.task_id::text
    or new.envelope_json ->> 'assignmentId' <> new.assignment_id::text
    or new.envelope_json ->> 'jobRunId' <> new.job_run_id::text
    or new.envelope_json ->> 'workerId' <> new.worker_id::text
    or new.envelope_json ->> 'workerLeaseId' <> new.worker_lease_id::text
    or new.envelope_json ->> 'permissionLeaseId' <> new.permission_lease_id::text
    or new.envelope_json -> 'contract' ->> 'id' <> new.task_contract_version_id::text
    or new.envelope_json -> 'contract' ->> 'sha256' <> new.contract_sha256
    or new.envelope_json -> 'authority' ->> 'id' <> new.authority_id::text
    or new.envelope_json -> 'authority' ->> 'scopeSha256' <> new.authority_scope_sha256
    or new.envelope_json -> 'source' ->> 'repository' <> new.source_repository
    or new.envelope_json -> 'source' ->> 'commitSha' <> new.source_commit
    or nullif(new.envelope_json -> 'source' ->> 'treeSha', '') is distinct from new.source_tree
    or new.envelope_json ->> 'workflow' <> new.workflow_key
    or new.envelope_json ->> 'workflowSource' <> new.workflow_source
    or new.envelope_json -> 'permissionScope' <> new.permission_scope_json
  then
    raise exception 'CANONICAL_EXECUTION_ENVELOPE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger verified_work_execution_envelope_integrity
before insert on public.verified_work_execution_envelopes
for each row execute function private.enforce_verified_work_execution_envelope_integrity();

create trigger verified_work_execution_envelopes_append_only_update
before update on public.verified_work_execution_envelopes
for each row execute function private.reject_row_mutation();

create trigger verified_work_execution_envelopes_append_only_delete
before delete on public.verified_work_execution_envelopes
for each row execute function private.reject_row_mutation();

create trigger canonical_job_run_events_append_only_update
before update on public.job_run_events
for each row execute function private.reject_row_mutation();

create trigger canonical_job_run_events_append_only_delete
before delete on public.job_run_events
for each row execute function private.reject_row_mutation();

create or replace function private.verified_workflow_policy(p_workflow text)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog
as $$
  select case p_workflow
    when 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION' then jsonb_build_object(
      'workflow', p_workflow,
      'workflowSource', 'SERVER_REGISTRY:BETA_GATE_3_COMPATIBILITY_V1',
      'executorType', 'AI_GATEWAY',
      'independentVerificationRequired', true,
      'exactCommitRequired', true,
      'exactTreeRequired', false,
      'legacySourceResolution', true
    )
    when 'GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1' then jsonb_build_object(
      'workflow', p_workflow,
      'workflowSource', 'SERVER_REGISTRY:GATE_4A_EXTERNAL_REVIEW_EXPORT_BUNDLE_V1',
      'executorType', 'AI_GATEWAY',
      'independentVerificationRequired', true,
      'exactCommitRequired', true,
      'exactTreeRequired', true,
      'legacySourceResolution', false
    )
    else null
  end;
$$;

create or replace function public.prepare_verified_work_execution(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<prepare_execution>>
declare
  owner_auth_user_id uuid;
  owner_profile_id uuid;
  task_id uuid;
  contract_id uuid;
  authority_id uuid;
  target_task public.tasks%rowtype;
  target_contract public.task_contract_versions%rowtype;
  target_authority public.workspace_authority_reviews%rowtype;
  target_assignment public.task_assignments%rowtype;
  target_identity public.agent_identity_profiles%rowtype;
  existing_envelope public.verified_work_execution_envelopes%rowtype;
  existing_job public.job_runs%rowtype;
  source_document jsonb;
  source_repository text;
  source_commit text;
  source_tree text;
  workflow_key text;
  workflow_policy jsonb;
  contract_files jsonb;
  authority_files jsonb;
  contract_actions jsonb;
  authority_actions jsonb;
  contract_domains jsonb;
  authority_domains jsonb;
  contract_limits jsonb;
  authority_limits jsonb;
  permission_scope jsonb;
  execution_policy jsonb;
  envelope_document jsonb;
  envelope_canonical text;
  envelope_sha256 text;
  idempotency_key text;
  started_at timestamptz := clock_timestamp();
  job_run_id uuid := gen_random_uuid();
  worker_id uuid := gen_random_uuid();
  worker_lease_id uuid := gen_random_uuid();
  permission_lease_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'CANONICAL_EXECUTION_REQUEST_INVALID' using errcode = '22023';
  end if;
  begin
    owner_auth_user_id := (p_request ->> 'ownerAuthUserId')::uuid;
    task_id := (p_request ->> 'taskId')::uuid;
    contract_id := (p_request ->> 'contractId')::uuid;
    authority_id := (p_request ->> 'authorityId')::uuid;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'CANONICAL_EXECUTION_REQUEST_INVALID' using errcode = '22023';
  end;

  source_repository := coalesce(p_request ->> 'sourceRepository', '');
  source_commit := lower(coalesce(p_request ->> 'sourceCommit', ''));
  source_tree := nullif(lower(coalesce(p_request ->> 'sourceTree', '')), '');
  workflow_key := coalesce(p_request ->> 'workflow', '');
  workflow_policy := private.verified_workflow_policy(workflow_key);
  if workflow_policy is null then
    raise exception 'CANONICAL_WORKFLOW_UNSUPPORTED' using errcode = '22023';
  end if;
  if source_repository !~ '^https://github[.]com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+[.]git$'
    or source_commit !~ '^[a-f0-9]{40}$'
    or (source_tree is not null and source_tree !~ '^[a-f0-9]{40}$')
    or ((workflow_policy ->> 'exactTreeRequired')::boolean and source_tree is null)
  then
    raise exception 'CANONICAL_SOURCE_IDENTITY_INVALID' using errcode = '22023';
  end if;

  select task.* into target_task
  from public.tasks task
  where task.id = prepare_execution.task_id
  for update;
  if target_task.id is null then
    raise exception 'CANONICAL_WORK_NOT_FOUND' using errcode = 'P0002';
  end if;

  select profile.id into owner_profile_id
  from public.profiles profile
  join public.customer_profiles customer on customer.profile_id = profile.id
  where profile.auth_user_id = owner_auth_user_id
    and customer.id = target_task.customer_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null;
  if owner_profile_id is null then
    raise exception 'CANONICAL_EXECUTION_OWNER_MISMATCH' using errcode = '42501';
  end if;

  select contract.* into target_contract
  from public.task_contract_versions contract
  where contract.id = prepare_execution.contract_id
    and contract.task_id = prepare_execution.task_id
  for update;
  if target_contract.id is null then
    raise exception 'CANONICAL_CONTRACT_LINEAGE_MISMATCH' using errcode = '23514';
  end if;
  if target_contract.status <> 'LOCKED' then
    raise exception 'CANONICAL_CONTRACT_NOT_LOCKED' using errcode = '23514';
  end if;
  if target_contract.contract_sha256 <> p_request ->> 'contractSha256' then
    raise exception 'CANONICAL_CONTRACT_HASH_MISMATCH' using errcode = '23514';
  end if;

  select review.* into target_authority
  from public.workspace_authority_reviews review
  where review.id = prepare_execution.authority_id
  for update;
  if target_authority.id is null
    or target_authority.task_id <> prepare_execution.task_id
    or target_authority.task_contract_version_id <> prepare_execution.contract_id
    or target_authority.decision <> 'APPROVED'
  then
    raise exception 'CANONICAL_AUTHORITY_LINEAGE_MISMATCH' using errcode = '23514';
  end if;
  if target_authority.scope_sha256 <> p_request ->> 'authorityScopeSha256' then
    raise exception 'CANONICAL_AUTHORITY_HASH_MISMATCH' using errcode = '23514';
  end if;

  select assignment.* into target_assignment
  from public.task_assignments assignment
  where assignment.task_id = prepare_execution.task_id
  order by assignment.created_at desc, assignment.id desc
  limit 1
  for update;
  if target_assignment.id is null
    or target_assignment.agent_id <> target_authority.agent_id
    or (
      target_contract.contract_json ? 'assignedAgent'
      and target_assignment.agent_id::text <> target_contract.contract_json -> 'assignedAgent' ->> 'agentId'
    )
  then
    raise exception 'CANONICAL_ASSIGNMENT_LINEAGE_MISMATCH' using errcode = '23514';
  end if;

  select identity.* into target_identity
  from public.agent_identity_profiles identity
  where identity.agent_id = target_assignment.agent_id
    and (
      not target_contract.contract_json ? 'assignedAgent'
      or identity.revision = (target_contract.contract_json -> 'assignedAgent' ->> 'profileRevision')::integer
    )
  order by identity.revision desc
  limit 1;
  if target_identity.agent_id is null
    or target_identity.profile_document ->> 'status' <> 'ACTIVE'
    or (
      target_contract.contract_json ? 'assignedAgent'
      and (
        target_identity.profile_sha256 <> target_contract.contract_json -> 'assignedAgent' ->> 'profileSha256'
        or target_identity.revision <> (target_contract.contract_json -> 'assignedAgent' ->> 'profileRevision')::integer
      )
    )
  then
    raise exception 'CANONICAL_AGENT_IDENTITY_MISMATCH' using errcode = '23514';
  end if;

  if target_contract.contract_json ->> 'allowedWorkflow' <> workflow_key
    or not coalesce(target_authority.scope_json -> 'allowedWorkflows', '[]'::jsonb) @> jsonb_build_array(workflow_key)
  then
    raise exception 'CANONICAL_WORKFLOW_MISMATCH' using errcode = '23514';
  end if;

  if (workflow_policy ->> 'legacySourceResolution')::boolean then
    source_document := target_contract.contract_json -> 'sourceReference';
    if workflow_key <> 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION'
      or source_document ->> 'repository' <> source_repository
      or source_document ->> 'branch' <> target_task.target_branch
      or source_document ->> 'commitResolution' <> 'REQUIRED_BEFORE_PERMISSION_LEASE'
      or source_tree is not null
    then
      raise exception 'CANONICAL_LEGACY_SOURCE_MISMATCH' using errcode = '23514';
    end if;
  else
    source_document := coalesce(target_contract.contract_json -> 'sourceIdentity', target_contract.contract_json -> 'source');
    if jsonb_typeof(source_document) is distinct from 'object'
      or source_document ->> 'repository' <> source_repository
      or lower(coalesce(source_document ->> 'commitSha', source_document ->> 'commit', '')) <> source_commit
      or lower(coalesce(source_document ->> 'treeSha', source_document ->> 'tree', '')) <> source_tree
    then
      raise exception 'CANONICAL_SOURCE_MISMATCH' using errcode = '23514';
    end if;
    if not coalesce(target_authority.scope_json -> 'allowedCommitShas', '[]'::jsonb) @> jsonb_build_array(source_commit)
      or not coalesce(target_authority.scope_json -> 'allowedTreeShas', '[]'::jsonb) @> jsonb_build_array(source_tree)
    then
      raise exception 'CANONICAL_SOURCE_OUTSIDE_AUTHORITY' using errcode = '23514';
    end if;
  end if;
  if target_task.repository_label <> source_repository
    or not coalesce(target_authority.scope_json -> 'allowedRepositories', '[]'::jsonb) @> jsonb_build_array(source_repository)
  then
    raise exception 'CANONICAL_SOURCE_REPOSITORY_MISMATCH' using errcode = '23514';
  end if;

  contract_files := coalesce(
    target_contract.contract_json -> 'authorityPolicy' -> 'allowedFiles',
    target_contract.contract_json -> 'authorityPolicy' -> 'allowedPaths'
  );
  authority_files := target_authority.scope_json -> 'allowedFiles';
  contract_actions := target_contract.contract_json -> 'allowedActions';
  authority_actions := target_authority.scope_json -> 'allowedActions';
  contract_domains := coalesce(target_contract.contract_json -> 'authorityPolicy' -> 'allowedDomains', '[]'::jsonb);
  authority_domains := coalesce(target_authority.scope_json -> 'allowedDomains', '[]'::jsonb);
  if jsonb_typeof(contract_files) is distinct from 'array'
    or jsonb_array_length(contract_files) < 1
    or jsonb_typeof(authority_files) is distinct from 'array'
    or contract_files <> authority_files
    or jsonb_typeof(contract_actions) is distinct from 'array'
    or jsonb_typeof(authority_actions) is distinct from 'array'
    or contract_actions <> authority_actions
    or jsonb_typeof(contract_domains) is distinct from 'array'
    or jsonb_typeof(authority_domains) is distinct from 'array'
    or contract_domains <> authority_domains
    or exists (
      select 1 from jsonb_array_elements_text(contract_files) as file_scope(file_name)
      where file_name = '' or file_name like '/%' or file_name like '%\\%' or file_name ~ '(^|/)[.][.](/|$)'
    )
  then
    raise exception 'CANONICAL_AUTHORITY_SCOPE_MISMATCH' using errcode = '23514';
  end if;
  if target_contract.contract_json -> 'authorityPolicy' ->> 'networkPolicy' <> 'deny-all'
    or target_authority.scope_json ->> 'networkPolicy' <> 'deny-all'
    or target_contract.contract_json -> 'authorityPolicy' ->> 'persistence' <> 'none'
    or target_authority.scope_json ->> 'persistence' <> 'none'
    or coalesce(target_authority.scope_json -> 'allowedEnvironmentVariables', '[]'::jsonb) <> '[]'::jsonb
    or not coalesce(target_authority.scope_json -> 'allowedSandboxProviders', '[]'::jsonb) @> '["VERCEL_SANDBOX"]'::jsonb
    or not coalesce(target_authority.scope_json -> 'allowedExecutionBackends', '[]'::jsonb) @> '["MANAGED_REMOTE_SANDBOX"]'::jsonb
    or target_contract.contract_json -> 'deliveryOutcomePolicy' ->> 'policy' <> 'EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED'
  then
    raise exception 'CANONICAL_EXECUTION_POLICY_MISMATCH' using errcode = '23514';
  end if;

  permission_scope := target_authority.scope_json;
  if (workflow_policy ->> 'legacySourceResolution')::boolean then
    permission_scope := permission_scope || jsonb_build_object(
      'allowedPaths', jsonb_build_array('$JOB_WORKSPACE'),
      'allowedDomains', '[]'::jsonb,
      'allowedCommitShas', jsonb_build_array(source_commit),
      'allowedTreeShas', '[]'::jsonb,
      'allowedWorkflows', jsonb_build_array(workflow_key),
      'allowedFiles', contract_files,
      'allowedEnvironmentVariables', '[]'::jsonb,
      'maxArtifactBytes', 2097152,
      'maxRuntimeSeconds', 600,
      'maxSandboxes', 2,
      'maxCommands', 10,
      'maxStdoutBytes', 262144,
      'maxStderrBytes', 262144,
      'maxApiBudget', 0,
      'networkPolicy', 'deny-all',
      'persistence', 'none'
    );
  else
    contract_limits := target_contract.contract_json -> 'executionLimits';
    authority_limits := jsonb_build_object(
      'maxArtifactBytes', (permission_scope ->> 'maxArtifactBytes')::bigint,
      'maxRuntimeSeconds', (permission_scope ->> 'maxRuntimeSeconds')::integer,
      'maxSandboxes', (permission_scope ->> 'maxSandboxes')::integer,
      'maxCommands', (permission_scope ->> 'maxCommands')::integer,
      'maxStdoutBytes', (permission_scope ->> 'maxStdoutBytes')::bigint,
      'maxStderrBytes', (permission_scope ->> 'maxStderrBytes')::bigint,
      'maxApiBudget', (permission_scope ->> 'maxApiBudget')::numeric
    );
    if jsonb_typeof(contract_limits) is distinct from 'object'
      or contract_limits <> authority_limits
    then
      raise exception 'CANONICAL_EXECUTION_LIMITS_MISMATCH' using errcode = '23514';
    end if;
  end if;
  if coalesce((permission_scope ->> 'maxRuntimeSeconds')::integer, 0) not between 1 and 86400
    or coalesce((permission_scope ->> 'maxArtifactBytes')::bigint, 0) not between 1024 and 104857600
    or coalesce((permission_scope ->> 'maxSandboxes')::integer, 0) not between 1 and 10
    or coalesce((permission_scope ->> 'maxCommands')::integer, 0) not between 1 and 100
    or coalesce((permission_scope ->> 'maxStdoutBytes')::bigint, 0) not between 1024 and 52428800
    or coalesce((permission_scope ->> 'maxStderrBytes')::bigint, 0) not between 1024 and 52428800
    or coalesce((permission_scope ->> 'maxApiBudget')::numeric, -1) < 0
  then
    raise exception 'CANONICAL_EXECUTION_LIMITS_INVALID' using errcode = '23514';
  end if;

  idempotency_key := encode(extensions.digest(convert_to(
    concat_ws(':', task_id::text, contract_id::text, target_contract.contract_sha256,
      authority_id::text, target_authority.scope_sha256, source_repository,
      source_commit, coalesce(source_tree, ''), workflow_key), 'UTF8'), 'sha256'), 'hex');

  select envelope.* into existing_envelope
  from public.verified_work_execution_envelopes envelope
  where envelope.task_id = prepare_execution.task_id
    and envelope.idempotency_key = prepare_execution.idempotency_key;
  if existing_envelope.id is not null then
    select run.* into existing_job from public.job_runs run where run.id = existing_envelope.job_run_id;
    if existing_job.status in ('FAILED', 'CANCELLED', 'TIMED_OUT', 'LEASE_EXPIRED') then
      raise exception 'CANONICAL_EXECUTION_TERMINAL_FAILURE_REQUIRES_NEW_WORK' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'prepared', true, 'reused', true, 'startedAt', existing_envelope.created_at,
      'taskId', existing_envelope.task_id, 'assignmentId', existing_envelope.assignment_id,
      'agentId', existing_job.agent_id, 'workerId', existing_envelope.worker_id,
      'jobRunId', existing_envelope.job_run_id, 'workerLeaseId', existing_envelope.worker_lease_id,
      'permissionLeaseId', existing_envelope.permission_lease_id,
      'contractId', existing_envelope.task_contract_version_id,
      'contractVersion', target_contract.version, 'contractSha256', existing_envelope.contract_sha256,
      'contract', target_contract.contract_json, 'authorityId', existing_envelope.authority_id,
      'authorityScopeSha256', existing_envelope.authority_scope_sha256,
      'authorityScope', target_authority.scope_json,
      'permissionScope', existing_envelope.permission_scope_json,
      'agentIdentity', target_identity.profile_document,
      'source', jsonb_build_object('repository', existing_envelope.source_repository,
        'commitSha', existing_envelope.source_commit, 'treeSha', existing_envelope.source_tree),
      'sourceCommit', existing_envelope.source_commit,
      'workflow', existing_envelope.workflow_key, 'workflowSource', existing_envelope.workflow_source,
      'envelopeCanonical', existing_envelope.envelope_canonical_text,
      'envelopeSha256', existing_envelope.envelope_sha256,
      'idempotencyKey', existing_envelope.idempotency_key
    );
  end if;

  if target_task.status <> 'PUBLISHED' then
    raise exception 'CANONICAL_WORK_NOT_EXECUTABLE' using errcode = '23514';
  end if;
  if target_assignment.status not in ('OFFERED', 'ACCEPTED') then
    raise exception 'CANONICAL_ASSIGNMENT_NOT_EXECUTABLE' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.job_runs run
    where run.task_id = prepare_execution.task_id
      and run.status in ('QUEUED', 'CLAIMED', 'RUNNING', 'SUBMITTED')
  ) then
    raise exception 'CANONICAL_ACTIVE_JOB_ALREADY_EXISTS' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.job_runs run where run.task_id = prepare_execution.task_id) then
    raise exception 'CANONICAL_EXECUTION_RETRY_REQUIRES_NEW_WORK' using errcode = 'P0001';
  end if;

  execution_policy := jsonb_build_object(
    'schemaVersion', 1,
    'workflowPolicy', workflow_policy,
    'permissionScope', permission_scope,
    'deliveryOutcomePolicy', target_contract.contract_json -> 'deliveryOutcomePolicy'
  );

  insert into public.worker_nodes (
    id, provider_id, name, status, accepting_jobs, paired_at, last_heartbeat_at,
    worker_version, max_concurrent_jobs, active_job_count, metadata
  ) values (
    worker_id, target_assignment.provider_id, 'DoneLayer canonical server orchestrator',
    'BUSY', false, started_at, started_at, 'canonical-verified-work-v1', 1, 1,
    jsonb_build_object('role', 'SERVER_SIDE_ORCHESTRATOR',
      'executionBackend', 'MANAGED_REMOTE_SANDBOX', 'sandboxProvider', 'VERCEL_SANDBOX')
  );

  insert into public.worker_capabilities (
    worker_id, schema_version, operating_system, architecture, docker_available,
    codex_available, git_available, github_cli_available, supported_languages,
    installed_tools, available_executors, max_concurrent_jobs, reported_at, metadata
  ) values (
    worker_id, 1, 'SERVER_MANAGED', null, false, false, true, false,
    array['TypeScript'], array['Vercel AI Gateway', 'Vercel Sandbox'],
    array['AI_GATEWAY'], 1, started_at,
    jsonb_build_object('platformCredentialsReachWorkload', false)
  );

  update public.task_assignments
  set worker_id = prepare_execution.worker_id, status = 'RUNNING',
      accepted_at = coalesce(accepted_at, started_at), updated_at = started_at
  where id = target_assignment.id;

  insert into public.job_runs (
    id, task_id, assignment_id, agent_id, worker_id, attempt_no, executor_type,
    workflow_template_key, status, timeout_seconds, max_log_bytes,
    max_artifact_bytes, allowed_network_domains, started_at,
    absolute_deadline_at, commit_sha_before, result, task_contract_version_id,
    created_at, updated_at
  ) values (
    job_run_id, task_id, target_assignment.id, target_assignment.agent_id,
    worker_id, 1, workflow_policy ->> 'executorType', workflow_key,
    'RUNNING', (permission_scope ->> 'maxRuntimeSeconds')::integer,
    greatest((permission_scope ->> 'maxStdoutBytes')::bigint, (permission_scope ->> 'maxStderrBytes')::bigint),
    (permission_scope ->> 'maxArtifactBytes')::bigint, '{}'::text[], started_at,
    started_at + make_interval(secs => (permission_scope ->> 'maxRuntimeSeconds')::integer),
    source_commit, jsonb_build_object(
      'executionOutcome', 'INCONCLUSIVE', 'independentVerificationOutcome', 'INCONCLUSIVE',
      'deliveryOutcome', 'BLOCKED', 'corpusContribution', 0, 'reputationContribution', 0),
    contract_id, started_at, started_at
  );

  insert into public.worker_job_leases (
    id, job_run_id, worker_id, lease_generation, lease_token_digest, status,
    claimed_at, renewed_at, expires_at, created_at, updated_at
  ) values (
    worker_lease_id, job_run_id, worker_id, 1,
    extensions.digest(convert_to(job_run_id::text || ':' || worker_lease_id::text, 'UTF8'), 'sha256'),
    'ACTIVE', started_at, started_at,
    started_at + make_interval(secs => (permission_scope ->> 'maxRuntimeSeconds')::integer),
    started_at, started_at
  );

  insert into public.permission_leases (
    id, task_id, task_contract_version_id, job_run_id, agent_id, worker_id,
    version, status, scope_json, starts_at, expires_at, created_at, created_by
  ) values (
    permission_lease_id, task_id, contract_id, job_run_id, target_assignment.agent_id,
    worker_id, 1, 'ACTIVE', permission_scope, started_at,
    started_at + make_interval(secs => (permission_scope ->> 'maxRuntimeSeconds')::integer),
    started_at, 'DONE_LAYER_SERVER'
  );

  envelope_document := jsonb_build_object(
    'schemaVersion', 1, 'bindingType', 'CANONICAL_VERIFIED_WORK_EXECUTION_V1',
    'taskId', task_id, 'assignmentId', target_assignment.id, 'jobRunId', job_run_id,
    'workerId', worker_id, 'workerLeaseId', worker_lease_id,
    'permissionLeaseId', permission_lease_id,
    'contract', jsonb_build_object('id', contract_id, 'version', target_contract.version,
      'sha256', target_contract.contract_sha256),
    'authority', jsonb_build_object('id', authority_id, 'scopeSha256', target_authority.scope_sha256),
    'source', jsonb_build_object('repository', source_repository, 'commitSha', source_commit,
      'treeSha', source_tree),
    'workflow', workflow_key, 'workflowSource', workflow_policy ->> 'workflowSource',
    'permissionScope', permission_scope, 'startedAt', started_at
  );
  envelope_canonical := envelope_document::text;
  envelope_sha256 := encode(extensions.digest(convert_to(envelope_canonical, 'UTF8'), 'sha256'), 'hex');

  insert into public.verified_work_execution_envelopes (
    task_id, assignment_id, job_run_id, worker_id, worker_lease_id,
    permission_lease_id, task_contract_version_id, contract_sha256,
    authority_id, authority_scope_sha256, source_repository, source_commit,
    source_tree, workflow_key, workflow_source, permission_scope_json,
    execution_policy_snapshot, envelope_json, envelope_canonical_text,
    envelope_sha256, idempotency_key, created_at
  ) values (
    task_id, target_assignment.id, job_run_id, worker_id, worker_lease_id,
    permission_lease_id, contract_id, target_contract.contract_sha256,
    authority_id, target_authority.scope_sha256, source_repository, source_commit,
    source_tree, workflow_key, workflow_policy ->> 'workflowSource', permission_scope,
    execution_policy, envelope_document, envelope_canonical, envelope_sha256,
    idempotency_key, started_at
  );

  insert into public.job_run_events (
    job_run_id, client_sequence, event_type, level, message, payload, occurred_at
  ) values
    (job_run_id, 1, 'EXECUTION_PREPARE_REQUESTED', 'INFO', 'Canonical execution preparation requested.',
      jsonb_build_object('taskId', task_id), started_at),
    (job_run_id, 2, 'CONTRACT_VERIFIED', 'INFO', 'Locked Contract identity and hash verified.',
      jsonb_build_object('contractId', contract_id, 'contractSha256', target_contract.contract_sha256), started_at),
    (job_run_id, 3, 'AUTHORITY_VERIFIED', 'INFO', 'Approved task-scoped Authority identity and hash verified.',
      jsonb_build_object('authorityId', authority_id, 'authorityScopeSha256', target_authority.scope_sha256), started_at),
    (job_run_id, 4, 'SOURCE_VERIFIED', 'INFO', 'Exact immutable Source identity verified.',
      jsonb_build_object('repository', source_repository, 'commitSha', source_commit, 'treeSha', source_tree), started_at),
    (job_run_id, 5, 'WORKFLOW_VERIFIED', 'INFO', 'Server-registered workflow verified.',
      jsonb_build_object('workflow', workflow_key, 'workflowSource', workflow_policy ->> 'workflowSource'), started_at),
    (job_run_id, 6, 'JOB_CREATED', 'INFO', 'Canonical Job created atomically.',
      jsonb_build_object('jobRunId', job_run_id, 'envelopeSha256', envelope_sha256), started_at),
    (job_run_id, 7, 'LEASE_CREATED', 'INFO', 'Worker and Permission Leases created atomically.',
      jsonb_build_object('workerLeaseId', worker_lease_id, 'permissionLeaseId', permission_lease_id), started_at);

  perform private.transition_task(task_id, 'PUBLISHED', 'ANALYZING', 'SYSTEM', null, null,
    'CANONICAL_ANALYSIS_STARTED', 'Canonical execution preparation validated the locked Contract.', '{}'::jsonb);
  perform private.transition_task(task_id, 'ANALYZING', 'MATCHING', 'SYSTEM', null, null,
    'CANONICAL_MATCHING_STARTED', 'The locked Agent assignment is being validated.', '{}'::jsonb);
  perform private.transition_task(task_id, 'MATCHING', 'MATCHED', 'SYSTEM', null, null,
    'CANONICAL_AGENT_MATCHED', 'The locked Contract Agent matched the canonical Assignment.', '{}'::jsonb);
  perform private.transition_task(task_id, 'MATCHED', 'AWAITING_PROVIDER', 'SYSTEM', null, null,
    'CANONICAL_PROVIDER_AWAITED', 'The server orchestrator provider was selected.', '{}'::jsonb);
  perform private.transition_task(task_id, 'AWAITING_PROVIDER', 'ASSIGNED', 'SYSTEM', null, null,
    'CANONICAL_ASSIGNED', 'The bounded server orchestrator Assignment was accepted.', '{}'::jsonb);
  perform private.transition_task(task_id, 'ASSIGNED', 'RUNNING', 'SYSTEM', null, null,
    'CANONICAL_EXECUTION_STARTED', 'The canonical Job and Permission Lease are active.',
    jsonb_build_object('jobRunId', job_run_id, 'permissionLeaseId', permission_lease_id,
      'envelopeSha256', envelope_sha256));

  return jsonb_build_object(
    'prepared', true, 'reused', false, 'startedAt', started_at,
    'taskId', task_id, 'assignmentId', target_assignment.id,
    'agentId', target_assignment.agent_id, 'workerId', worker_id,
    'jobRunId', job_run_id, 'workerLeaseId', worker_lease_id,
    'permissionLeaseId', permission_lease_id, 'contractId', contract_id,
    'contractVersion', target_contract.version, 'contractSha256', target_contract.contract_sha256,
    'contract', target_contract.contract_json, 'authorityId', authority_id,
    'authorityScopeSha256', target_authority.scope_sha256,
    'authorityScope', target_authority.scope_json, 'permissionScope', permission_scope,
    'agentIdentity', target_identity.profile_document,
    'source', jsonb_build_object('repository', source_repository, 'commitSha', source_commit,
      'treeSha', source_tree), 'sourceCommit', source_commit,
    'workflow', workflow_key, 'workflowSource', workflow_policy ->> 'workflowSource',
    'envelopeCanonical', envelope_canonical, 'envelopeSha256', envelope_sha256,
    'idempotencyKey', idempotency_key
  );
end;
$$;

create or replace function public.finalize_verified_work_execution(p_result jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<finalize_execution>>
declare
  owner_auth_user_id uuid;
  owner_profile_id uuid;
  task_id uuid;
  job_run_id uuid;
  worker_id uuid;
  worker_lease_id uuid;
  permission_lease_id uuid;
  contract_id uuid;
  authority_id uuid;
  verification_run_id uuid;
  receipt_id uuid;
  receipt_public_id text;
  receipt_sha256 text;
  evidence_chain_sha256 text;
  receipt_document jsonb;
  job_result jsonb;
  target_job public.job_runs%rowtype;
  target_envelope public.verified_work_execution_envelopes%rowtype;
  target_contract public.task_contract_versions%rowtype;
  target_authority public.workspace_authority_reviews%rowtype;
  target_permission public.permission_leases%rowtype;
  target_worker_lease public.worker_job_leases%rowtype;
  existing_receipt public.job_receipts%rowtype;
  item jsonb;
  previous_hash text := null;
  expected_sequence integer := 1;
  required_checks integer;
  next_audit_sequence integer;
  finished_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_result) is distinct from 'object'
    or jsonb_typeof(p_result -> 'artifacts') is distinct from 'array'
    or jsonb_array_length(p_result -> 'artifacts') < 1
    or jsonb_typeof(p_result -> 'ledgerEntries') is distinct from 'array'
    or jsonb_typeof(p_result -> 'verification' -> 'checks') is distinct from 'array'
    or jsonb_typeof(p_result -> 'receipt' -> 'document') is distinct from 'object'
  then
    raise exception 'CANONICAL_FINALIZATION_INVALID' using errcode = '22023';
  end if;
  begin
    owner_auth_user_id := (p_result ->> 'ownerAuthUserId')::uuid;
    task_id := (p_result ->> 'taskId')::uuid;
    job_run_id := (p_result ->> 'jobRunId')::uuid;
    worker_id := (p_result ->> 'workerId')::uuid;
    worker_lease_id := (p_result ->> 'workerLeaseId')::uuid;
    permission_lease_id := (p_result ->> 'permissionLeaseId')::uuid;
    contract_id := (p_result ->> 'contractId')::uuid;
    authority_id := (p_result ->> 'authorityId')::uuid;
    verification_run_id := (p_result -> 'verification' ->> 'id')::uuid;
    receipt_id := (p_result -> 'receipt' ->> 'id')::uuid;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'CANONICAL_FINALIZATION_INVALID' using errcode = '22023';
  end;
  receipt_public_id := p_result -> 'receipt' ->> 'publicId';
  receipt_sha256 := p_result -> 'receipt' ->> 'sha256';
  evidence_chain_sha256 := p_result -> 'receipt' ->> 'evidenceChainSha256';
  receipt_document := p_result -> 'receipt' -> 'document';
  job_result := p_result -> 'jobResult';

  select run.* into target_job from public.job_runs run
  where run.id = finalize_execution.job_run_id and run.task_id = finalize_execution.task_id
  for update;
  select envelope.* into target_envelope from public.verified_work_execution_envelopes envelope
  where envelope.job_run_id = finalize_execution.job_run_id
  for update;
  if target_job.id is null or target_envelope.id is null then
    raise exception 'CANONICAL_FINALIZATION_LINEAGE_MISMATCH' using errcode = '23514';
  end if;

  select profile.id into owner_profile_id
  from public.tasks task
  join public.customer_profiles customer on customer.id = task.customer_id
  join public.profiles profile on profile.id = customer.profile_id
  where task.id = finalize_execution.task_id
    and profile.auth_user_id = finalize_execution.owner_auth_user_id
    and profile.status = 'ACTIVE' and profile.deleted_at is null;
  if owner_profile_id is null then
    raise exception 'CANONICAL_EXECUTION_OWNER_MISMATCH' using errcode = '42501';
  end if;

  select receipt.* into existing_receipt from public.job_receipts receipt
  where receipt.job_run_id = finalize_execution.job_run_id;
  if target_job.status = 'SUCCEEDED' and existing_receipt.id is not null then
    if existing_receipt.id <> receipt_id
      or existing_receipt.receipt_sha256 <> receipt_sha256
      or existing_receipt.evidence_chain_sha256 <> evidence_chain_sha256
    then
      raise exception 'CANONICAL_FINALIZATION_REPLAY_MISMATCH' using errcode = '23514';
    end if;
    return jsonb_build_object(
      'finalized', true, 'replayed', true, 'taskId', task_id, 'jobRunId', job_run_id,
      'permissionLeaseId', target_envelope.permission_lease_id,
      'verificationRunId', (select id from public.verification_runs where job_run_id = finalize_execution.job_run_id limit 1),
      'receiptId', existing_receipt.id, 'receiptPublicId', existing_receipt.receipt_public_id,
      'receiptSha256', existing_receipt.receipt_sha256,
      'evidenceChainSha256', existing_receipt.evidence_chain_sha256,
      'finalStatus', 'COMPLETED', 'deliveryOutcome', 'VERIFIED_DELIVERY',
      'finishedAt', target_job.finished_at
    );
  end if;

  select contract.* into target_contract from public.task_contract_versions contract
  where contract.id = finalize_execution.contract_id and contract.task_id = finalize_execution.task_id;
  select review.* into target_authority from public.workspace_authority_reviews review
  where review.id = finalize_execution.authority_id;
  if target_job.status <> 'RUNNING'
    or target_job.worker_id <> finalize_execution.worker_id
    or target_job.task_contract_version_id <> finalize_execution.contract_id
    or target_envelope.task_id <> finalize_execution.task_id
    or target_envelope.worker_id <> finalize_execution.worker_id
    or target_envelope.worker_lease_id <> finalize_execution.worker_lease_id
    or target_envelope.permission_lease_id <> finalize_execution.permission_lease_id
    or target_envelope.task_contract_version_id <> finalize_execution.contract_id
    or target_envelope.contract_sha256 <> p_result ->> 'contractSha256'
    or target_envelope.authority_id <> finalize_execution.authority_id
    or target_envelope.authority_scope_sha256 <> p_result ->> 'authorityScopeSha256'
    or target_envelope.envelope_sha256 <> p_result ->> 'envelopeSha256'
    or target_contract.id is null or target_contract.status <> 'LOCKED'
    or target_contract.contract_sha256 <> target_envelope.contract_sha256
    or target_authority.id is null or target_authority.decision <> 'APPROVED'
    or target_authority.task_id <> finalize_execution.task_id
    or target_authority.task_contract_version_id <> finalize_execution.contract_id
    or target_authority.scope_sha256 <> target_envelope.authority_scope_sha256
  then
    raise exception 'CANONICAL_FINALIZATION_LINEAGE_MISMATCH' using errcode = '23514';
  end if;

  select lease.* into target_permission from public.permission_leases lease
  where lease.id = finalize_execution.permission_lease_id
    and lease.job_run_id = finalize_execution.job_run_id
    and lease.task_id = finalize_execution.task_id
    and lease.worker_id = finalize_execution.worker_id
  for update;
  select lease.* into target_worker_lease from public.worker_job_leases lease
  where lease.id = finalize_execution.worker_lease_id
    and lease.job_run_id = finalize_execution.job_run_id
    and lease.worker_id = finalize_execution.worker_id
  for update;
  if target_permission.id is null or target_permission.status <> 'ACTIVE'
    or target_permission.expires_at <= finished_at
    or target_permission.scope_json <> target_envelope.permission_scope_json
    or target_worker_lease.id is null or target_worker_lease.status <> 'ACTIVE'
    or target_worker_lease.expires_at <= finished_at
    or exists (
      select 1 from public.job_run_events event
      where event.job_run_id = finalize_execution.job_run_id
        and event.event_type = 'PERMISSION_VIOLATION'
    )
  then
    raise exception 'CANONICAL_FINALIZATION_OWNERSHIP_INVALID' using errcode = '42501';
  end if;

  if job_result ->> 'executionOutcome' <> 'COMPLETED'
    or job_result ->> 'independentVerificationOutcome' <> 'VERIFIED'
    or job_result ->> 'deliveryOutcome' <> 'VERIFIED_DELIVERY'
    or (job_result ->> 'requiredEvidenceComplete')::boolean is distinct from true
    or (job_result ->> 'executionSandboxCleanupVerified')::boolean is distinct from true
    or (job_result ->> 'verifierSandboxCleanupVerified')::boolean is distinct from true
    or coalesce(job_result -> 'unresolvedPolicyViolations', 'null'::jsonb) <> '[]'::jsonb
    or job_result ->> 'canonicalEnvelopeSha256' <> target_envelope.envelope_sha256
    or job_result ->> 'contractSha256' <> target_envelope.contract_sha256
    or job_result ->> 'authorityScopeSha256' <> target_envelope.authority_scope_sha256
    or receipt_document ->> 'finalResult' <> 'VERIFIED_DELIVERY'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'executionOutcome' <> 'COMPLETED'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'independentVerificationOutcome' <> 'VERIFIED'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'deliveryOutcome' <> 'VERIFIED_DELIVERY'
    or receipt_document -> 'whatWasAgreed' -> 'workContract' ->> 'id' <> contract_id::text
    or receipt_document -> 'whatWasAgreed' -> 'workContract' ->> 'sha256' <> target_envelope.contract_sha256
    or receipt_document -> 'whatWasAgreed' -> 'authority' ->> 'id' <> authority_id::text
    or receipt_document -> 'whatWasAgreed' -> 'authority' ->> 'scopeSha256' <> target_envelope.authority_scope_sha256
    or receipt_sha256 !~ '^[a-f0-9]{64}$'
    or evidence_chain_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(receipt_public_id, '')) not between 20 and 120
  then
    raise exception 'CANONICAL_VERIFIED_DELIVERY_NOT_PROVEN' using errcode = '23514';
  end if;
  if target_envelope.workflow_key = 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION'
    and (
      receipt_document -> 'classification' ->> 'realJobClassification' <> 'NOT_VERIFIED'
      or receipt_document -> 'classification' ->> 'reason' <> 'BETA_GATE_VALIDATION'
      or coalesce((receipt_document -> 'classification' ->> 'reputationContribution')::integer, 0) <> 0
      or coalesce((receipt_document -> 'classification' ->> 'canonicalContribution')::integer, 0) <> 0
    )
  then
    raise exception 'BETA_GATE_3_CLASSIFICATION_IMMUTABLE' using errcode = '23514';
  end if;

  if jsonb_typeof(p_result -> 'changedFiles') is distinct from 'array'
    or jsonb_array_length(p_result -> 'changedFiles') < 1
    or jsonb_array_length(p_result -> 'changedFiles') <> (
      select count(distinct file_name)
      from jsonb_array_elements_text(p_result -> 'changedFiles') as changed(file_name)
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_result -> 'changedFiles') as changed(file_name)
      where not target_envelope.permission_scope_json -> 'allowedFiles' @> jsonb_build_array(file_name)
    )
  then
    raise exception 'CANONICAL_CHANGED_FILE_OUTSIDE_AUTHORITY' using errcode = '23514';
  end if;

  required_checks := (select count(*) from public.task_acceptance_checks check_row
    where check_row.task_id = finalize_execution.task_id and check_row.required);
  if required_checks < 1
    or jsonb_array_length(p_result -> 'verification' -> 'checks') <> required_checks
    or exists (
      select 1 from public.task_acceptance_checks check_row
      where check_row.task_id = finalize_execution.task_id and check_row.required
        and not exists (
          select 1 from jsonb_array_elements(p_result -> 'verification' -> 'checks') supplied
          where supplied ->> 'acceptanceCheckId' = check_row.id::text
            and supplied ->> 'status' = 'PASSED'
        )
    )
  then
    raise exception 'CANONICAL_ACCEPTANCE_NOT_VERIFIED' using errcode = '23514';
  end if;

  for item in select value from jsonb_array_elements(p_result -> 'ledgerEntries')
  loop
    if (item ->> 'sequenceNumber')::integer <> expected_sequence
      or item ->> 'taskId' <> task_id::text
      or item ->> 'jobRunId' <> job_run_id::text
      or nullif(item ->> 'previousEntrySha256', '') is distinct from previous_hash
      or item ->> 'entrySha256' !~ '^[a-f0-9]{64}$'
      or item ->> 'payloadSha256' !~ '^[a-f0-9]{64}$'
    then
      raise exception 'CANONICAL_EVIDENCE_LEDGER_INVALID' using errcode = '23514';
    end if;
    previous_hash := item ->> 'entrySha256';
    expected_sequence := expected_sequence + 1;
  end loop;
  if expected_sequence < 3 then
    raise exception 'CANONICAL_EVIDENCE_LEDGER_INCOMPLETE' using errcode = '23514';
  end if;
  item := (p_result -> 'ledgerEntries') -> (jsonb_array_length(p_result -> 'ledgerEntries') - 1);
  if item ->> 'entryType' <> 'RECEIPT_CREATED'
    or item ->> 'sourceRecordType' <> 'job_receipt'
    or item ->> 'sourceRecordId' <> receipt_id::text
    or item ->> 'payloadSha256' <> receipt_sha256
    or item ->> 'previousEntrySha256' <> evidence_chain_sha256
  then
    raise exception 'CANONICAL_RECEIPT_ANCHOR_INVALID' using errcode = '23514';
  end if;

  update public.job_runs
  set status = 'SUCCEEDED', finished_at = finalize_execution.finished_at, exit_code = 0,
      commit_sha_after = commit_sha_before, changed_files = p_result -> 'changedFiles',
      result = job_result, failure_code = null, updated_at = finalize_execution.finished_at
  where id = finalize_execution.job_run_id;

  for item in select value from jsonb_array_elements(p_result -> 'artifacts')
  loop
    if item ->> 'sha256' !~ '^[a-f0-9]{64}$'
      or (item ->> 'sizeBytes')::bigint < 0
      or char_length(coalesce(item ->> 'fileName', '')) not between 1 and 240
      or item ->> 'storagePath' not like '%' || job_run_id::text || '/%'
      or item ->> 'storagePath' like '/%'
      or item ->> 'storagePath' ~ '(^|/)[.][.](/|$)'
    then
      raise exception 'CANONICAL_ARTIFACT_INVALID' using errcode = '23514';
    end if;
    insert into public.evidence_artifacts (
      id, task_id, worker_id, job_run_id, artifact_type, file_name, mime_type,
      size_bytes, sha256, storage_path, upload_status, verified_at, metadata,
      created_at, updated_at
    ) values (
      (item ->> 'id')::uuid, task_id, worker_id, job_run_id,
      item ->> 'artifactType', item ->> 'fileName', item ->> 'mimeType',
      (item ->> 'sizeBytes')::bigint, decode(item ->> 'sha256', 'hex'),
      item ->> 'storagePath', 'VERIFIED', finalize_execution.finished_at,
      coalesce(item -> 'metadata', '{}'::jsonb), finalize_execution.finished_at, finalize_execution.finished_at
    );
  end loop;

  insert into public.verification_runs (
    id, task_id, job_run_id, verifier_version, status, required_check_count,
    passed_check_count, failed_check_count, started_at, finished_at, summary,
    metadata, created_at, updated_at
  ) values (
    verification_run_id, task_id, job_run_id,
    p_result -> 'verification' ->> 'verifierVersion', 'PASSED', required_checks,
    required_checks, 0, (p_result -> 'verification' ->> 'startedAt')::timestamptz,
    (p_result -> 'verification' ->> 'finishedAt')::timestamptz,
    p_result -> 'verification' ->> 'summary',
    coalesce(p_result -> 'verification' -> 'metadata', '{}'::jsonb),
    finalize_execution.finished_at, finalize_execution.finished_at
  );
  for item in select value from jsonb_array_elements(p_result -> 'verification' -> 'checks')
  loop
    insert into public.verification_results (
      id, verification_run_id, acceptance_check_id, status, summary,
      expected, actual, created_at, updated_at
    ) values (
      (item ->> 'id')::uuid, verification_run_id,
      (item ->> 'acceptanceCheckId')::uuid, 'PASSED', item ->> 'summary',
      coalesce(item -> 'expected', '{}'::jsonb), coalesce(item -> 'actual', '{}'::jsonb),
      finalize_execution.finished_at, finalize_execution.finished_at
    );
  end loop;

  for item in select value from jsonb_array_elements(p_result -> 'ledgerEntries')
  loop
    insert into public.evidence_ledger_entries (
      id, task_id, job_run_id, sequence_number, entry_type, source_record_type,
      source_record_id, payload_sha256, previous_entry_sha256, entry_sha256, created_at
    ) values (
      (item ->> 'id')::uuid, task_id, job_run_id,
      (item ->> 'sequenceNumber')::integer, item ->> 'entryType',
      item ->> 'sourceRecordType', item ->> 'sourceRecordId',
      item ->> 'payloadSha256', nullif(item ->> 'previousEntrySha256', ''),
      item ->> 'entrySha256', (item ->> 'createdAt')::timestamptz
    );
  end loop;

  insert into public.job_receipts (
    id, receipt_public_id, task_id, job_run_id, task_contract_version_id,
    permission_lease_id, result, receipt_json, receipt_sha256,
    evidence_chain_sha256, created_at
  ) values (
    receipt_id, receipt_public_id, task_id, job_run_id, contract_id,
    permission_lease_id, 'VERIFIED_DELIVERY', receipt_document, receipt_sha256,
    evidence_chain_sha256, finalize_execution.finished_at
  );

  update public.permission_leases set status = 'COMPLETED'
  where id = finalize_execution.permission_lease_id;
  update public.worker_job_leases set status = 'RELEASED', released_at = finalize_execution.finished_at,
    updated_at = finalize_execution.finished_at
  where id = finalize_execution.worker_lease_id and status = 'ACTIVE';
  update public.worker_nodes set status = 'OFFLINE', active_job_count = 0,
    last_heartbeat_at = finalize_execution.finished_at, updated_at = finalize_execution.finished_at
  where id = finalize_execution.worker_id;
  update public.task_assignments set status = 'COMPLETED', updated_at = finalize_execution.finished_at
  where id = target_job.assignment_id;
  select coalesce(max(event.client_sequence), 0) + 1 into next_audit_sequence
  from public.job_run_events event where event.job_run_id = finalize_execution.job_run_id;
  insert into public.job_run_events (
    job_run_id, client_sequence, event_type, level, message, payload, occurred_at
  ) values (
    job_run_id, next_audit_sequence, 'EXECUTION_FINALIZED', 'INFO',
    'Canonical execution finalized after independent verification.',
    jsonb_build_object('verificationRunId', verification_run_id, 'receiptId', receipt_id), finalize_execution.finished_at
  );

  perform private.transition_task(task_id, 'RUNNING', 'SUBMITTED', 'SYSTEM', null, null,
    'CANONICAL_DELIVERABLE_SUBMITTED', 'The bounded Agent submitted authorized evidence.',
    jsonb_build_object('jobRunId', job_run_id, 'patchSha256', p_result ->> 'patchSha256'));
  perform private.transition_task(task_id, 'SUBMITTED', 'VERIFYING', 'VERIFIER', null, null,
    'CANONICAL_INDEPENDENT_VERIFICATION_STARTED', 'An independent verifier evaluated the delivery.',
    jsonb_build_object('verificationRunId', verification_run_id));
  perform private.transition_task(task_id, 'VERIFYING', 'VERIFICATION_PASSED', 'VERIFIER', null, null,
    'CANONICAL_VERIFICATION_PASSED', 'All locked acceptance checks passed independently.',
    jsonb_build_object('verificationRunId', verification_run_id));
  perform private.transition_task(task_id, 'VERIFICATION_PASSED', 'CUSTOMER_REVIEW', 'SYSTEM', null, null,
    'CANONICAL_CUSTOMER_REVIEW', 'Verified delivery and its Receipt are ready for owner acceptance.',
    jsonb_build_object('receiptId', receipt_id));
  perform private.transition_task(task_id, 'CUSTOMER_REVIEW', 'COMPLETED', 'CUSTOMER', owner_profile_id, null,
    'CANONICAL_OWNER_ACCEPTED', 'The authenticated Work owner accepted the independently verified delivery.',
    jsonb_build_object('receiptId', receipt_id, 'deliveryOutcome', 'VERIFIED_DELIVERY'));

  return jsonb_build_object(
    'finalized', true, 'replayed', false, 'taskId', task_id, 'jobRunId', job_run_id,
    'permissionLeaseId', permission_lease_id, 'verificationRunId', verification_run_id,
    'receiptId', receipt_id, 'receiptPublicId', receipt_public_id,
    'receiptSha256', receipt_sha256, 'evidenceChainSha256', evidence_chain_sha256,
    'finalStatus', 'COMPLETED', 'deliveryOutcome', 'VERIFIED_DELIVERY',
    'finishedAt', finished_at
  );
end;
$$;

create or replace function public.fail_verified_work_execution(p_failure jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<fail_execution>>
declare
  owner_auth_user_id uuid;
  task_id uuid;
  job_run_id uuid;
  contract_id uuid;
  authority_id uuid;
  target_job public.job_runs%rowtype;
  target_envelope public.verified_work_execution_envelopes%rowtype;
  failure_code text;
  failure_reason text;
  execution_outcome text;
  next_sequence integer;
  failed_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_failure) is distinct from 'object' then
    raise exception 'CANONICAL_FAILURE_INVALID' using errcode = '22023';
  end if;
  begin
    owner_auth_user_id := (p_failure ->> 'ownerAuthUserId')::uuid;
    task_id := (p_failure ->> 'taskId')::uuid;
    job_run_id := (p_failure ->> 'jobRunId')::uuid;
    contract_id := (p_failure ->> 'contractId')::uuid;
    authority_id := (p_failure ->> 'authorityId')::uuid;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'CANONICAL_FAILURE_INVALID' using errcode = '22023';
  end;
  failure_code := upper(coalesce(p_failure ->> 'failureCode', 'CANONICAL_EXECUTION_FAILED'));
  failure_reason := left(coalesce(p_failure ->> 'failureReason', failure_code), 500);
  execution_outcome := coalesce(p_failure ->> 'executionOutcome', 'FAILED');
  if failure_code !~ '^[A-Z0-9_]{3,100}$'
    or char_length(failure_reason) < 1
    or execution_outcome not in ('FAILED', 'INCONCLUSIVE', 'TIMEOUT', 'PROVIDER_FAILURE')
  then
    raise exception 'CANONICAL_FAILURE_INVALID' using errcode = '22023';
  end if;

  select run.* into target_job from public.job_runs run
  where run.id = fail_execution.job_run_id and run.task_id = fail_execution.task_id
  for update;
  select envelope.* into target_envelope from public.verified_work_execution_envelopes envelope
  where envelope.job_run_id = fail_execution.job_run_id
  for update;
  if target_job.id is null or target_envelope.id is null
    or target_envelope.task_contract_version_id <> fail_execution.contract_id
    or target_envelope.authority_id <> fail_execution.authority_id
    or target_envelope.envelope_sha256 <> p_failure ->> 'envelopeSha256'
  then
    raise exception 'CANONICAL_FAILURE_LINEAGE_MISMATCH' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.tasks task
    join public.customer_profiles customer on customer.id = task.customer_id
    join public.profiles profile on profile.id = customer.profile_id
    where task.id = fail_execution.task_id
      and profile.auth_user_id = fail_execution.owner_auth_user_id
      and profile.status = 'ACTIVE' and profile.deleted_at is null
  ) then
    raise exception 'CANONICAL_EXECUTION_OWNER_MISMATCH' using errcode = '42501';
  end if;
  if target_job.status = 'FAILED' then
    if target_job.failure_code <> failure_code then
      raise exception 'CANONICAL_FAILURE_REPLAY_MISMATCH' using errcode = '23514';
    end if;
    return jsonb_build_object('failedClosed', true, 'replayed', true,
      'jobRunId', target_job.id, 'failureCode', failure_code, 'failedAt', target_job.finished_at);
  end if;
  if target_job.status = 'SUCCEEDED' then
    raise exception 'CANONICAL_FAILURE_CANNOT_REPLACE_SUCCESS' using errcode = '23514';
  end if;
  if target_job.status <> 'RUNNING' then
    raise exception 'CANONICAL_JOB_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  update public.job_runs set status = 'FAILED', finished_at = failed_at,
    failure_code = fail_execution.failure_code,
    result = jsonb_build_object(
      'executionOutcome', execution_outcome,
      'independentVerificationOutcome', 'INCONCLUSIVE',
      'deliveryOutcome', 'BLOCKED',
      'failureReason', failure_reason,
      'corpusContribution', 0,
      'reputationContribution', 0
    ), updated_at = failed_at
  where id = target_job.id;
  update public.permission_leases as permission set status = 'REVOKED', revoked_at = failed_at,
    revoke_reason = failure_code
  where permission.job_run_id = target_job.id and permission.status = 'ACTIVE';
  update public.worker_job_leases as worker_lease
  set status = 'RELEASED', released_at = failed_at, updated_at = failed_at
  where worker_lease.job_run_id = target_job.id and worker_lease.status = 'ACTIVE';
  update public.worker_nodes set status = 'OFFLINE', active_job_count = 0, updated_at = failed_at
  where id = target_job.worker_id;
  update public.task_assignments set status = 'CANCELLED', updated_at = failed_at
  where id = target_job.assignment_id;

  select coalesce(max(event.client_sequence), 0) + 1 into next_sequence
  from public.job_run_events event where event.job_run_id = target_job.id;
  insert into public.job_run_events (
    job_run_id, client_sequence, event_type, level, message, payload, occurred_at
  ) values (
    target_job.id, next_sequence, 'EXECUTION_FAILED', 'ERROR',
    'Canonical execution failed closed.',
    jsonb_build_object('failureCode', failure_code, 'failureReason', failure_reason,
      'envelopeSha256', target_envelope.envelope_sha256), failed_at
  );
  perform private.transition_task(target_job.task_id, 'RUNNING', 'CANCELLED', 'SYSTEM', null, null,
    'CANONICAL_EXECUTION_FAILED_CLOSED', 'The canonical Job failed closed.',
    jsonb_build_object('jobRunId', target_job.id, 'failureCode', failure_code));

  return jsonb_build_object('failedClosed', true, 'replayed', false,
    'jobRunId', target_job.id, 'failureCode', failure_code, 'failedAt', failed_at);
end;
$$;

revoke all on function public.prepare_verified_work_execution(jsonb) from public, anon, authenticated;
revoke all on function public.finalize_verified_work_execution(jsonb) from public, anon, authenticated;
revoke all on function public.fail_verified_work_execution(jsonb) from public, anon, authenticated;
grant execute on function public.prepare_verified_work_execution(jsonb) to service_role;
grant execute on function public.finalize_verified_work_execution(jsonb) to service_role;
grant execute on function public.fail_verified_work_execution(jsonb) to service_role;

-- Historical definitions remain intact for readback. New Gate 3 execution uses
-- the application compatibility wrapper over the canonical commands above.
revoke execute on function public.rpc_prepare_beta_gate_3_job(jsonb) from service_role;
revoke execute on function public.rpc_finalize_beta_gate_3_job(jsonb) from service_role;
revoke execute on function public.rpc_fail_beta_gate_3_job(jsonb) from service_role;
