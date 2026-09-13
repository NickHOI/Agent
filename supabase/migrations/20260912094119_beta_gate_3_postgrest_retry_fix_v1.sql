-- PostgREST 14 retries custom SQLSTATE 40001 responses indefinitely. Preserve
-- the fail-closed workspace errors while returning a non-retryable exception.
create or replace function public.rpc_approve_beta_workspace_authority(
  p_task_id uuid,
  p_expected_contract_version integer,
  p_expected_contract_sha256 text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_auth_user_id uuid := auth.uid();
  actor_profile_id uuid;
  current_task public.tasks%rowtype;
  current_contract public.task_contract_versions%rowtype;
  selected_agent_id uuid;
  authority_scope jsonb;
  authority_scope_sha256 text;
  authority_decision jsonb;
  authority_decision_sha256 text;
  authority_review_id uuid := gen_random_uuid();
  decision_time timestamptz := now();
begin
  if actor_auth_user_id is null then
    raise exception 'WORKSPACE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select task.* into current_task
  from public.tasks task
  where task.id = p_task_id
    and private.is_task_customer(task.id)
  for update;
  if not found then
    raise exception 'WORKSPACE_WORK_NOT_FOUND' using errcode = 'P0002';
  end if;

  select profile.id into actor_profile_id
  from public.profiles profile
  where profile.auth_user_id = actor_auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null;

  select contract.* into current_contract
  from public.task_contract_versions contract
  where contract.task_id = p_task_id
    and contract.status = 'LOCKED'
  for update;

  if current_contract.id is null
    or current_contract.version <> p_expected_contract_version
    or current_contract.contract_sha256 <> p_expected_contract_sha256
  then
    raise exception 'WORKSPACE_CONTRACT_STALE' using errcode = 'P0001';
  end if;
  if current_task.status <> 'DRAFT' then
    raise exception 'WORKSPACE_AUTHORITY_ALREADY_DECIDED' using errcode = 'P0001';
  end if;

  selected_agent_id := (current_contract.contract_json -> 'assignedAgent' ->> 'agentId')::uuid;
  if selected_agent_id is null or not private.owns_agent(selected_agent_id) then
    raise exception 'WORKSPACE_AGENT_ACCESS_DENIED' using errcode = '42501';
  end if;

  authority_scope := jsonb_build_object(
    'allowedActions', current_contract.contract_json -> 'allowedActions',
    'deniedActions', current_contract.contract_json -> 'forbiddenActions',
    'allowedPaths', current_contract.contract_json -> 'authorityPolicy' -> 'allowedPaths',
    'allowedDomains', '[]'::jsonb,
    'allowedRepositories', jsonb_build_array(current_task.repository_label),
    'allowedBranches', jsonb_build_array(current_task.target_branch),
    'allowedSandboxProviders', jsonb_build_array('VERCEL_SANDBOX'),
    'allowedExecutionBackends', jsonb_build_array('MANAGED_REMOTE_SANDBOX'),
    'allowedWorkflows', jsonb_build_array('BETA_GATE_3_MANAGED_REMOTE_EXECUTION'),
    'allowedFiles', current_contract.contract_json -> 'authorityPolicy' -> 'allowedPaths',
    'allowedEnvironmentVariables', '[]'::jsonb,
    'maxArtifactBytes', 10485760,
    'maxRuntimeSeconds', current_contract.contract_json -> 'timeLimitSeconds',
    'maxApiBudget', 0,
    'maxSandboxes', 2,
    'maxCommands', 10,
    'maxStdoutBytes', 1048576,
    'maxStderrBytes', 1048576,
    'networkPolicy', 'deny-all',
    'persistence', 'none',
    'humanApprovalActions', case when current_task.allow_pull_request
      then jsonb_build_array('create_pull_request')
      else '[]'::jsonb
    end
  );
  authority_scope_sha256 := encode(
    extensions.digest(convert_to(authority_scope::text, 'UTF8'), 'sha256'),
    'hex'
  );
  authority_decision := jsonb_build_object(
    'schemaVersion', 1,
    'decisionType', 'TASK_SCOPED_AUTHORITY_DECISION_V1',
    'decision', 'APPROVED',
    'taskId', p_task_id::text,
    'taskContractVersionId', current_contract.id::text,
    'taskContractVersion', current_contract.version,
    'taskContractSha256', current_contract.contract_sha256,
    'agentId', selected_agent_id::text,
    'requestedScopeSha256', authority_scope_sha256,
    'requestedScope', authority_scope,
    'decidedBy', jsonb_build_object(
      'actorType', 'CUSTOMER',
      'actorId', actor_profile_id::text
    ),
    'decidedAt', decision_time,
    'permissionLeaseStatus', 'NOT_ISSUED',
    'sourceCommitStatus', 'NOT_RESOLVED'
  );
  authority_decision_sha256 := encode(
    extensions.digest(convert_to(authority_decision::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.workspace_authority_reviews (
    id, task_id, task_contract_version_id, agent_id, decision,
    scope_json, scope_sha256, decision_json, decision_sha256,
    decided_by, decided_at
  ) values (
    authority_review_id, p_task_id, current_contract.id, selected_agent_id,
    'APPROVED', authority_scope, authority_scope_sha256, authority_decision,
    authority_decision_sha256, actor_profile_id, decision_time
  );

  perform private.transition_task(
    p_task_id,
    'DRAFT',
    'PUBLISHED',
    'CUSTOMER',
    actor_profile_id,
    null,
    'TASK_SCOPED_AUTHORITY_APPROVED',
    'Customer approved the bounded pre-execution Authority ceiling.',
    jsonb_build_object(
      'authorityReviewId', authority_review_id::text,
      'scopeSha256', authority_scope_sha256,
      'permissionLeaseStatus', 'NOT_ISSUED'
    )
  );

  return jsonb_build_object(
    'authorityReviewId', authority_review_id::text,
    'decision', 'APPROVED',
    'scopeSha256', authority_scope_sha256,
    'permissionLeaseStatus', 'NOT_ISSUED',
    'workStatus', 'PUBLISHED'
  );
end;
$$;

revoke all on function public.rpc_approve_beta_workspace_authority(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.rpc_approve_beta_workspace_authority(uuid, integer, text)
  to authenticated;
grant execute on function public.rpc_approve_beta_workspace_authority(uuid, integer, text)
  to service_role;

comment on function public.rpc_approve_beta_workspace_authority(uuid, integer, text) is
  'Approves the immutable workspace Authority ceiling with non-retryable stale-state errors.';
