-- Beta Gate 2 - Trust Workspace V1
--
-- This migration connects the existing Trust Foundation tables to an
-- authenticated, owner-scoped Beta workspace. It does not create a Job Run,
-- Permission Lease, Evidence, Receipt, payment, or live Agent execution.

alter table public.tasks drop constraint tasks_repository_mode_check;
alter table public.tasks add constraint tasks_repository_mode_check
  check (repository_mode in ('DEMO', 'GITHUB', 'REFERENCE'));

alter table public.tasks drop constraint tasks_check;
alter table public.tasks add constraint tasks_repository_binding_check check (
  (repository_mode = 'GITHUB' and repository_id is not null)
  or (repository_mode in ('DEMO', 'REFERENCE') and repository_id is null)
);

alter table public.task_acceptance_checks
  drop constraint task_acceptance_checks_check_type_check;
alter table public.task_acceptance_checks
  add constraint task_acceptance_checks_check_type_check check (check_type in (
    'COMMAND_EXIT', 'TEST', 'BUILD', 'GITHUB_CHECK', 'FILE_EXISTS', 'DIFF',
    'PULL_REQUEST', 'URL_HEALTH', 'SCREENSHOT', 'HUMAN_APPROVAL',
    'CONTRACT_ASSERTION'
  ));

create table public.workspace_authority_reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  task_contract_version_id uuid not null references public.task_contract_versions(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  decision text not null check (decision in ('APPROVED', 'DENIED')),
  scope_json jsonb not null check (jsonb_typeof(scope_json) = 'object'),
  scope_sha256 text not null check (scope_sha256 ~ '^[a-f0-9]{64}$'),
  decision_json jsonb not null check (jsonb_typeof(decision_json) = 'object'),
  decision_sha256 text not null check (decision_sha256 ~ '^[a-f0-9]{64}$'),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  unique (task_contract_version_id)
);

create index workspace_authority_reviews_task_idx
  on public.workspace_authority_reviews(task_id, decided_at desc);

alter table public.workspace_authority_reviews enable row level security;

create policy workspace_authority_reviews_participant_select
on public.workspace_authority_reviews for select to authenticated
using ((select private.can_access_task(task_id)));

create trigger workspace_authority_reviews_append_only_update
before update on public.workspace_authority_reviews
for each row execute function private.reject_row_mutation();

create trigger workspace_authority_reviews_append_only_delete
before delete on public.workspace_authority_reviews
for each row execute function private.reject_row_mutation();

create or replace function private.enforce_locked_workspace_work_content()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.task_contract_versions contract
    where contract.task_id = old.id
      and contract.status = 'LOCKED'
  ) and (
    new.customer_id is distinct from old.customer_id
    or new.repository_id is distinct from old.repository_id
    or new.repository_mode is distinct from old.repository_mode
    or new.repository_label is distinct from old.repository_label
    or new.target_branch is distinct from old.target_branch
    or new.title is distinct from old.title
    or new.problem_description is distinct from old.problem_description
    or new.desired_outcome is distinct from old.desired_outcome
    or new.category is distinct from old.category
    or new.security_sensitivity is distinct from old.security_sensitivity
    or new.allow_code_changes is distinct from old.allow_code_changes
    or new.allow_pull_request is distinct from old.allow_pull_request
    or new.requires_human_approval is distinct from old.requires_human_approval
  ) then
    raise exception 'WORKSPACE_LOCKED_WORK_IMMUTABLE' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger workspace_locked_work_content_guard
before update on public.tasks
for each row execute function private.enforce_locked_workspace_work_content();

create or replace function public.rpc_bootstrap_beta_workspace(p_display_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  auth_user_id uuid := auth.uid();
  target_profile_id uuid;
  target_customer_id uuid;
  target_provider_id uuid;
  normalized_name text := btrim(p_display_name);
begin
  if auth_user_id is null then
    raise exception 'WORKSPACE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if normalized_name is null or normalized_name = '' or char_length(normalized_name) > 120 then
    raise exception 'WORKSPACE_DISPLAY_NAME_INVALID' using errcode = '22023';
  end if;

  insert into public.profiles (auth_user_id, display_name, status, metadata)
  values (auth_user_id, normalized_name, 'ACTIVE', jsonb_build_object('source', 'BETA_AUTH_HTTP'))
  on conflict (auth_user_id) do nothing;

  select profile.id into target_profile_id
  from public.profiles profile
  where profile.auth_user_id = auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null
  for update;

  if target_profile_id is null then
    raise exception 'WORKSPACE_PROFILE_UNAVAILABLE' using errcode = '42501';
  end if;

  insert into public.profile_roles (profile_id, role)
  values (target_profile_id, 'CUSTOMER'), (target_profile_id, 'PROVIDER')
  on conflict (profile_id, role) do nothing;

  insert into public.customer_profiles (profile_id, default_currency, metadata)
  values (target_profile_id, 'USD', jsonb_build_object('workspace', 'TRUST_WORKSPACE_V1'))
  on conflict (profile_id) do nothing;

  insert into public.provider_profiles (
    profile_id, company_name, bio, accepting_tasks, verification_status, metadata
  ) values (
    target_profile_id, normalized_name, 'Private Beta workspace controller', false,
    'UNVERIFIED', jsonb_build_object('workspace', 'TRUST_WORKSPACE_V1')
  ) on conflict (profile_id) do nothing;

  select customer.id into target_customer_id
  from public.customer_profiles customer
  where customer.profile_id = target_profile_id;

  select provider.id into target_provider_id
  from public.provider_profiles provider
  where provider.profile_id = target_profile_id;

  return jsonb_build_object(
    'profileId', target_profile_id::text,
    'customerId', target_customer_id::text,
    'providerId', target_provider_id::text
  );
end;
$$;

create or replace function public.rpc_create_beta_workspace_agent(
  p_agent jsonb,
  p_profile jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  auth_user_id uuid := auth.uid();
begin
  if auth_user_id is null then
    raise exception 'WORKSPACE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_agent) is distinct from 'object'
    or jsonb_typeof(p_profile) is distinct from 'object'
    or jsonb_typeof(p_agent -> 'skills') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'taskTypes') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'languages') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'operatingSystems') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'tools') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'requiredMcpServers') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'inputModes') is distinct from 'array'
    or jsonb_typeof(p_agent -> 'outputModes') is distinct from 'array'
  then
    raise exception 'WORKSPACE_AGENT_INPUT_INVALID' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_agent ->> 'name', ''))) not between 3 and 120
    or char_length(coalesce(p_agent ->> 'slug', '')) not between 1 and 120
    or coalesce(p_agent ->> 'slug', '') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(btrim(coalesce(p_agent ->> 'description', ''))) not between 20 and 5000
    or jsonb_array_length(p_agent -> 'skills') not between 1 and 50
    or jsonb_array_length(p_agent -> 'taskTypes') not between 1 and 6
    or jsonb_array_length(p_agent -> 'languages') > 30
    or jsonb_array_length(p_agent -> 'operatingSystems') not between 1 and 3
    or jsonb_array_length(p_agent -> 'tools') > 50
    or jsonb_array_length(p_agent -> 'requiredMcpServers') > 30
    or jsonb_array_length(p_agent -> 'inputModes') > 20
    or jsonb_array_length(p_agent -> 'outputModes') > 20
    or coalesce(p_agent ->> 'pricingModel', '') not in ('FIXED', 'HOURLY', 'FROM')
    or jsonb_typeof(p_agent -> 'basePriceCents') is distinct from 'number'
    or coalesce(p_agent ->> 'endpointType', '') not in ('LOCAL_WORKER', 'WEBHOOK', 'A2A')
    or coalesce(p_agent ->> 'authenticationType', '') not in ('NONE', 'HMAC', 'API_KEY', 'OAUTH', 'A2A_METADATA')
    or (
      p_agent ->> 'endpointType' <> 'LOCAL_WORKER'
      and coalesce(p_agent ->> 'endpointUrl', '') !~ '^https://[^[:space:]]+$'
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'skills') item(value)
      where char_length(btrim(item.value)) not between 1 and 80
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'taskTypes') item(value)
      where item.value not in (
        'DIAGNOSE_REPOSITORY', 'BUILD_RESCUE', 'TEST_AND_FIX',
        'FEATURE_COMPLETION', 'PULL_REQUEST_VERIFICATION', 'LAUNCH_READINESS'
      )
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'operatingSystems') item(value)
      where item.value not in ('WINDOWS', 'MACOS', 'LINUX')
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'languages') item(value)
      where char_length(btrim(item.value)) not between 1 and 100
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'tools') item(value)
      where char_length(btrim(item.value)) not between 1 and 100
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'requiredMcpServers') item(value)
      where char_length(btrim(item.value)) not between 1 and 200
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'inputModes') item(value)
      where char_length(btrim(item.value)) < 1
    )
    or exists (
      select 1 from jsonb_array_elements_text(p_agent -> 'outputModes') item(value)
      where char_length(btrim(item.value)) < 1
    )
  then
    raise exception 'WORKSPACE_AGENT_INPUT_INVALID' using errcode = '22023';
  end if;
  if (p_agent ->> 'basePriceCents')::numeric <> trunc((p_agent ->> 'basePriceCents')::numeric)
    or (p_agent ->> 'basePriceCents')::numeric not between 0 and 100000000
  then
    raise exception 'WORKSPACE_AGENT_INPUT_INVALID' using errcode = '22023';
  end if;
  if exists (
      select 1
      from jsonb_array_elements(
        (p_agent -> 'skills')
        || (p_agent -> 'taskTypes')
        || (p_agent -> 'languages')
        || (p_agent -> 'operatingSystems')
        || (p_agent -> 'tools')
        || (p_agent -> 'requiredMcpServers')
        || (p_agent -> 'inputModes')
        || (p_agent -> 'outputModes')
      ) item(value)
      where jsonb_typeof(item.value) <> 'string'
    )
    or jsonb_typeof(p_profile -> 'controller') is distinct from 'object'
    or jsonb_typeof(p_profile -> 'declaredCapabilities') is distinct from 'array'
    or jsonb_typeof(p_profile -> 'runtimeReferences') is distinct from 'array'
    or jsonb_typeof(p_profile -> 'externalIdentities') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(p_profile -> 'declaredCapabilities') item(value)
      where jsonb_typeof(item.value) <> 'string'
    )
    or exists (
      select 1
      from jsonb_array_elements(p_profile -> 'runtimeReferences') item(value)
      where jsonb_typeof(item.value) <> 'object'
    )
  then
    raise exception 'WORKSPACE_AGENT_PROFILE_INVALID' using errcode = '22023';
  end if;
  if p_profile ->> 'schemaVersion' is distinct from '1'
    or p_profile ->> 'profileType' is distinct from 'AGENT_IDENTITY_PROFILE_V1'
    or p_profile ->> 'agentId' is distinct from p_agent ->> 'id'
    or p_profile ->> 'revision' is distinct from '1'
    or p_profile ->> 'displayName' is distinct from p_agent ->> 'name'
    or p_profile ->> 'status' is distinct from 'ACTIVE'
    or p_profile ->> 'createdAt' is distinct from p_agent ->> 'createdAt'
    or p_profile ->> 'updatedAt' is distinct from p_agent ->> 'createdAt'
    or p_profile ->> 'previousProfileSha256' is not null
    or coalesce(p_profile ->> 'profileSha256', '') !~ '^[a-f0-9]{64}$'
    or p_profile -> 'controller' ->> 'controllerType' is distinct from 'PLATFORM_ACCOUNT'
    or p_profile -> 'controller' ->> 'accountType' is distinct from 'USER'
    or p_profile -> 'controller' ->> 'accountId' is distinct from auth_user_id::text
    or p_profile -> 'controller' ->> 'relationship' is distinct from 'CONTROLS'
    or p_profile -> 'controller' ->> 'assurance' is distinct from 'PLATFORM_ACCOUNT_RELATIONSHIP'
    or p_profile -> 'controller' ->> 'legallyVerified' is distinct from 'false'
    or jsonb_array_length(p_profile -> 'externalIdentities') <> 0
    or jsonb_array_length(p_profile -> 'runtimeReferences') <> 1
    or p_profile -> 'runtimeReferences' -> 0 ->> 'system' is distinct from 'DONE_LAYER'
    or p_profile -> 'runtimeReferences' -> 0 ->> 'identifier'
      is distinct from 'workspace-agent:' || (p_agent ->> 'id')
    or p_profile -> 'runtimeReferences' -> 0 ->> 'verificationLevel' is distinct from 'OBSERVED'
    or (p_profile - array[
      'schemaVersion', 'profileType', 'agentId', 'revision', 'displayName',
      'status', 'controller', 'declaredCapabilities', 'runtimeReferences',
      'externalIdentities', 'createdAt', 'updatedAt', 'previousProfileSha256',
      'profileSha256'
    ]::text[]) <> '{}'::jsonb
    or ((p_profile -> 'controller') - array[
      'controllerType', 'accountType', 'accountId', 'relationship',
      'assurance', 'legallyVerified'
    ]::text[]) <> '{}'::jsonb
    or ((p_profile -> 'runtimeReferences' -> 0) - array[
      'system', 'identifier', 'verificationLevel'
    ]::text[]) <> '{}'::jsonb
    or exists (
      select 1
      from jsonb_array_elements_text(p_profile -> 'declaredCapabilities') capability(value)
      where capability.value not in (
        select jsonb_array_elements_text((p_agent -> 'skills') || (p_agent -> 'taskTypes'))
      )
    )
    or exists (
      select 1
      from jsonb_array_elements_text((p_agent -> 'skills') || (p_agent -> 'taskTypes')) capability(value)
      where capability.value not in (
        select jsonb_array_elements_text(p_profile -> 'declaredCapabilities')
      )
    )
    or (
      select count(*) <> count(distinct capability.value)
      from jsonb_array_elements_text(p_profile -> 'declaredCapabilities') capability(value)
    )
  then
    raise exception 'WORKSPACE_AGENT_PROFILE_INVALID' using errcode = '22023';
  end if;
  return private.create_agent_with_identity(auth_user_id, p_agent, p_profile);
end;
$$;

create or replace function public.rpc_append_beta_workspace_agent_identity(
  p_profile jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  auth_user_id uuid := auth.uid();
begin
  if auth_user_id is null then
    raise exception 'WORKSPACE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  return private.append_agent_identity_profile(auth_user_id, p_profile);
end;
$$;

create or replace function public.rpc_create_beta_workspace_work(p_work jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  auth_user_id uuid := auth.uid();
  actor_profile_id uuid;
  customer_id uuid;
  selected_agent_id uuid;
  selected_provider_id uuid;
  selected_profile_revision integer;
  selected_profile_sha256 text;
  target_task_id uuid := gen_random_uuid();
  target_assignment_id uuid := gen_random_uuid();
  target_contract_id uuid := gen_random_uuid();
  target_created_at timestamptz := now();
  target_contract jsonb;
  target_contract_sha256 text;
  acceptance_checks jsonb;
  allowed_actions jsonb;
  forbidden_actions jsonb;
  allowed_paths jsonb;
  delivery_policy text;
  allow_code_changes boolean;
  allow_pull_request boolean;
begin
  if auth_user_id is null then
    raise exception 'WORKSPACE_AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_work) is distinct from 'object'
    or jsonb_typeof(p_work -> 'acceptanceRequirements') is distinct from 'array'
    or jsonb_array_length(p_work -> 'acceptanceRequirements') not between 1 and 20
    or jsonb_typeof(p_work -> 'allowedPaths') is distinct from 'array'
    or jsonb_array_length(p_work -> 'allowedPaths') not between 1 and 20
    or char_length(btrim(coalesce(p_work ->> 'title', ''))) not between 3 and 180
    or char_length(btrim(coalesce(p_work ->> 'requestDescription', ''))) not between 10 and 20000
    or char_length(btrim(coalesce(p_work ->> 'desiredOutcome', ''))) not between 3 and 10000
    or char_length(btrim(coalesce(p_work ->> 'repositoryReference', ''))) not between 1 and 500
    or char_length(btrim(coalesce(p_work ->> 'targetBranch', ''))) not between 1 and 255
    or p_work ->> 'taskType' not in (
      'DIAGNOSE_REPOSITORY', 'BUILD_RESCUE', 'TEST_AND_FIX',
      'FEATURE_COMPLETION', 'PULL_REQUEST_VERIFICATION', 'LAUNCH_READINESS'
    )
    or p_work ->> 'securitySensitivity' not in ('LOW', 'STANDARD', 'HIGH')
    or exists (
      select 1
      from jsonb_array_elements_text(p_work -> 'acceptanceRequirements') requirement(value)
      where char_length(btrim(requirement.value)) not between 3 and 500
    )
    or exists (
      select 1
      from jsonb_array_elements_text(p_work -> 'allowedPaths') allowed_path(value)
      where char_length(btrim(allowed_path.value)) not between 1 and 240
        or allowed_path.value ~ '(^/|\\|(^|/)\.\.(/|$))'
    )
  then
    raise exception 'WORKSPACE_WORK_INPUT_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(p_work -> 'allowCodeChanges') is distinct from 'boolean'
    or jsonb_typeof(p_work -> 'allowPullRequest') is distinct from 'boolean'
    or exists (
      select 1
      from jsonb_array_elements(
        (p_work -> 'acceptanceRequirements') || (p_work -> 'allowedPaths')
      ) item(value)
      where jsonb_typeof(item.value) <> 'string'
    )
  then
    raise exception 'WORKSPACE_WORK_INPUT_INVALID' using errcode = '22023';
  end if;

  select profile.id, customer.id into actor_profile_id, customer_id
  from public.profiles profile
  join public.customer_profiles customer on customer.profile_id = profile.id
  join public.profile_roles role on role.profile_id = profile.id and role.role = 'CUSTOMER'
  where profile.auth_user_id = auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null
  for update of customer;

  if customer_id is null then
    raise exception 'WORKSPACE_CUSTOMER_ACCESS_DENIED' using errcode = '42501';
  end if;

  selected_agent_id := (p_work ->> 'agentId')::uuid;
  select agent.provider_id, identity.revision, identity.profile_sha256
    into selected_provider_id, selected_profile_revision, selected_profile_sha256
  from public.agents agent
  join lateral (
    select profile.revision, profile.profile_sha256
    from public.agent_identity_profiles profile
    where profile.agent_id = agent.id
      and profile.profile_document ->> 'status' = 'ACTIVE'
    order by profile.revision desc
    limit 1
  ) identity on true
  where agent.id = selected_agent_id
    and agent.status = 'ACTIVE'
    and private.owns_agent(agent.id);

  if selected_provider_id is null then
    raise exception 'WORKSPACE_AGENT_ACCESS_DENIED' using errcode = '42501';
  end if;

  delivery_policy := p_work ->> 'deliveryOutcomePolicy';
  if delivery_policy not in (
    'EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED',
    'INDEPENDENT_ACCEPTANCE_SUFFICIENT'
  ) then
    raise exception 'WORKSPACE_DELIVERY_POLICY_INVALID' using errcode = '22023';
  end if;

  allow_code_changes := coalesce((p_work ->> 'allowCodeChanges')::boolean, false);
  allow_pull_request := coalesce((p_work ->> 'allowPullRequest')::boolean, false);
  if allow_pull_request and not allow_code_changes then
    raise exception 'WORKSPACE_PULL_REQUEST_REQUIRES_CODE_CHANGES' using errcode = '22023';
  end if;

  allowed_paths := p_work -> 'allowedPaths';
  allowed_actions := to_jsonb(array_remove(array[
    'read_source',
    'collect_evidence',
    'independently_verify',
    case when allow_code_changes then 'create_patch' end,
    case when allow_code_changes then 'run_locked_verification' end,
    case when allow_pull_request then 'create_pull_request' end
  ], null));
  forbidden_actions := to_jsonb(array_remove(array[
    'modify_acceptance_criteria',
    'merge_pull_request',
    'production_deploy',
    'real_payment',
    'blockchain_write',
    'access_platform_credentials',
    'access_unlisted_resources',
    case when not allow_code_changes then 'create_patch' end,
    case when not allow_pull_request then 'create_pull_request' end
  ], null));

  select jsonb_agg(jsonb_build_object(
    'id', gen_random_uuid()::text,
    'label', btrim(requirement.value),
    'required', true,
    'type', 'CONTRACT_ASSERTION',
    'config', jsonb_build_object(
      'statement', btrim(requirement.value),
      'verifier', 'INDEPENDENT_DONE_LAYER_CONTROLLED_CHECK'
    )
  ) order by requirement.ordinality)
  into acceptance_checks
  from jsonb_array_elements_text(p_work -> 'acceptanceRequirements')
    with ordinality as requirement(value, ordinality)
  where btrim(requirement.value) <> '';

  if acceptance_checks is null
    or jsonb_array_length(acceptance_checks) <> jsonb_array_length(p_work -> 'acceptanceRequirements')
  then
    raise exception 'WORKSPACE_ACCEPTANCE_REQUIREMENT_INVALID' using errcode = '22023';
  end if;

  insert into public.tasks (
    id, customer_id, repository_mode, repository_label, target_branch, title,
    problem_description, desired_outcome, category, budget_cents, currency,
    security_sensitivity, allow_code_changes, allow_pull_request,
    requires_human_approval, status, status_version, scope_summary,
    suggested_verification_checks, analysis_metadata, created_at, updated_at
  ) values (
    target_task_id, customer_id, 'REFERENCE', p_work ->> 'repositoryReference',
    p_work ->> 'targetBranch', p_work ->> 'title', p_work ->> 'requestDescription',
    p_work ->> 'desiredOutcome', p_work ->> 'taskType', 0, 'USD',
    p_work ->> 'securitySensitivity', allow_code_changes, allow_pull_request,
    true, 'DRAFT', 0, p_work ->> 'desiredOutcome', acceptance_checks,
    jsonb_build_object(
      'workspace', 'TRUST_WORKSPACE_V1',
      'selectedAgentId', selected_agent_id::text,
      'deliveryOutcomePolicy', delivery_policy
    ),
    target_created_at, target_created_at
  );

  insert into public.task_acceptance_checks (
    id, task_id, check_type, name, config, required, sort_order
  )
  select
    (item.value ->> 'id')::uuid,
    target_task_id,
    'CONTRACT_ASSERTION',
    item.value ->> 'label',
    item.value -> 'config',
    true,
    item.ordinality::integer
  from jsonb_array_elements(acceptance_checks) with ordinality as item(value, ordinality);

  insert into public.task_assignments (
    id, task_id, agent_id, provider_id, status, quoted_price_cents,
    platform_fee_bps, offered_at, expires_at, provider_note, created_at, updated_at
  ) values (
    target_assignment_id, target_task_id, selected_agent_id, selected_provider_id,
    'OFFERED', 0, 0, target_created_at, target_created_at + interval '7 days',
    'Beta Workspace selection; no execution accepted or started.',
    target_created_at, target_created_at
  );

  target_contract := jsonb_build_object(
    'taskId', target_task_id::text,
    'taskType', p_work ->> 'taskType',
    'desiredOutcome', p_work ->> 'desiredOutcome',
    'deliverables', p_work -> 'acceptanceRequirements',
    'allowedWorkflow', 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION',
    'allowedActions', allowed_actions,
    'forbiddenActions', forbidden_actions,
    'acceptanceChecks', acceptance_checks,
    'requiredEvidence', jsonb_build_array(
      'AGENT_IDENTITY', 'WORK_CONTRACT', 'TASK_SCOPED_AUTHORITY',
      'SOURCE_IDENTITY', 'EXECUTION_RESULT', 'TEST_AND_BUILD_RESULT',
      'CONTRACT_ASSERTIONS', 'FRESH_INDEPENDENT_VERIFICATION',
      'PROVENANCE', 'VERIFIED_WORK_RECEIPT'
    ),
    'budgetLimit', jsonb_build_object('currency', 'USD', 'maxAmount', 0),
    'timeLimitSeconds', 3600,
    'privacyClassification', case p_work ->> 'securitySensitivity'
      when 'HIGH' then 'RESTRICTED'
      when 'STANDARD' then 'CONFIDENTIAL'
      else 'INTERNAL'
    end,
    'humanApprovalRequirements', case when allow_pull_request
      then jsonb_build_array(
        'Approve task-scoped Authority before execution',
        'Record separate approval before creating a Pull Request'
      )
      else jsonb_build_array('Approve task-scoped Authority before execution')
    end,
    'failureConditions', jsonb_build_array(
      'Required evidence is missing',
      'An acceptance requirement fails',
      'Source, Authority, or Receipt integrity is invalid',
      'An action exceeds the approved scope'
    ),
    'contractVersion', 2,
    'contractType', 'VERIFIED_WORK_CONTRACT_V2',
    'sourceReference', jsonb_build_object(
      'repository', p_work ->> 'repositoryReference',
      'branch', p_work ->> 'targetBranch',
      'commitResolution', 'REQUIRED_BEFORE_PERMISSION_LEASE'
    ),
    'assignedAgent', jsonb_build_object(
      'agentId', selected_agent_id::text,
      'profileRevision', selected_profile_revision,
      'profileSha256', selected_profile_sha256
    ),
    'authorityPolicy', jsonb_build_object(
      'allowedPaths', allowed_paths,
      'networkPolicy', 'deny-all',
      'persistence', 'none',
      'sandboxProvider', 'VERCEL_SANDBOX',
      'executionBackend', 'MANAGED_REMOTE_SANDBOX'
    ),
    'deliveryOutcomePolicy', jsonb_build_object(
      'schemaVersion', 1,
      'policyVersion', 1,
      'policy', delivery_policy
    )
  );
  target_contract_sha256 := encode(
    extensions.digest(convert_to(target_contract::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into public.task_contract_versions (
    id, task_id, version, status, contract_json, contract_sha256,
    created_by, created_at, locked_at
  ) values (
    target_contract_id, target_task_id, 2, 'LOCKED', target_contract,
    target_contract_sha256, actor_profile_id::text, target_created_at, target_created_at
  );

  insert into public.task_events (
    task_id, sequence, event_type, from_status, to_status, actor_type,
    actor_profile_id, reason, payload, occurred_at
  ) values (
    target_task_id, 1, 'WORK_CONTRACT_LOCKED', null, 'DRAFT', 'CUSTOMER',
    actor_profile_id, 'Work created with a locked V2 Contract.',
    jsonb_build_object(
      'contractVersionId', target_contract_id::text,
      'contractSha256', target_contract_sha256,
      'authorityStatus', 'PENDING_REVIEW'
    ),
    target_created_at
  );

  return jsonb_build_object(
    'taskId', target_task_id::text,
    'contractVersionId', target_contract_id::text,
    'contractSha256', target_contract_sha256,
    'authorityStatus', 'PENDING_REVIEW'
  );
end;
$$;

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
  auth_user_id uuid := auth.uid();
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
  if auth_user_id is null then
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
  where profile.auth_user_id = auth_user_id
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
    raise exception 'WORKSPACE_CONTRACT_STALE' using errcode = '40001';
  end if;
  if current_task.status <> 'DRAFT' then
    raise exception 'WORKSPACE_AUTHORITY_ALREADY_DECIDED' using errcode = '40001';
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

revoke all on public.workspace_authority_reviews from public, anon, authenticated;
grant select on public.workspace_authority_reviews to authenticated;
grant all on public.workspace_authority_reviews to service_role;

revoke all on function private.enforce_locked_workspace_work_content()
  from public, anon, authenticated;
grant execute on function private.enforce_locked_workspace_work_content()
  to service_role;

revoke all on function public.rpc_bootstrap_beta_workspace(text)
  from public, anon, authenticated;
revoke all on function public.rpc_create_beta_workspace_agent(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.rpc_append_beta_workspace_agent_identity(jsonb)
  from public, anon, authenticated;
revoke all on function public.rpc_create_beta_workspace_work(jsonb)
  from public, anon, authenticated;
revoke all on function public.rpc_approve_beta_workspace_authority(uuid, integer, text)
  from public, anon, authenticated;

grant execute on function public.rpc_bootstrap_beta_workspace(text) to authenticated;
grant execute on function public.rpc_create_beta_workspace_agent(jsonb, jsonb) to authenticated;
grant execute on function public.rpc_create_beta_workspace_work(jsonb) to authenticated;
grant execute on function public.rpc_approve_beta_workspace_authority(uuid, integer, text) to authenticated;

grant execute on function public.rpc_bootstrap_beta_workspace(text) to service_role;
grant execute on function public.rpc_create_beta_workspace_agent(jsonb, jsonb) to service_role;
grant execute on function public.rpc_append_beta_workspace_agent_identity(jsonb) to service_role;
grant execute on function public.rpc_create_beta_workspace_work(jsonb) to service_role;
grant execute on function public.rpc_approve_beta_workspace_authority(uuid, integer, text) to service_role;

comment on table public.workspace_authority_reviews is
  'Immutable pre-execution Authority decisions. Approval is not an active Permission Lease.';
