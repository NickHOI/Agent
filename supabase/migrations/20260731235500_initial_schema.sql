-- DoneLayer initial schema
-- All user and worker mutations are performed by trusted server commands.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function private.reject_row_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end;
$$;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profile_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('CUSTOMER', 'PROVIDER', 'ADMIN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, role)
);

create table public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete restrict,
  company_name text,
  bio text,
  accepting_tasks boolean not null default false,
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED', 'PENDING', 'VERIFIED', 'SUSPENDED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.provider_public_profiles (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null unique references public.provider_profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  company_name text,
  public_bio text,
  listed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null,
  version text not null default '1.0.0',
  input_modes text[] not null default array['text']::text[],
  output_modes text[] not null default array['text', 'patch', 'evidence']::text[],
  supported_operating_systems text[] not null default '{}'::text[],
  supported_tools text[] not null default '{}'::text[],
  supported_languages text[] not null default '{}'::text[],
  required_mcp_servers text[] not null default '{}'::text[],
  pricing_model text not null default 'FIXED' check (pricing_model in ('FIXED', 'HOURLY', 'PER_RUN')),
  base_price_cents bigint not null default 0 check (base_price_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  availability text not null default 'OFFLINE' check (availability in ('AVAILABLE', 'BUSY', 'OFFLINE')),
  accepts_tasks boolean not null default false,
  endpoint_type text not null default 'DEMO'
    check (endpoint_type in ('LOCAL_WORKER', 'WEBHOOK', 'A2A', 'DEMO')),
  visibility text not null default 'PUBLIC' check (visibility in ('PUBLIC', 'PRIVATE', 'UNLISTED')),
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'ARCHIVED')),
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
  average_completion_seconds integer check (average_completion_seconds is null or average_completion_seconds >= 0),
  total_completed_tasks integer not null default 0 check (total_completed_tasks >= 0),
  verified_success_rate numeric(5,4) not null default 0 check (verified_success_rate between 0 and 1),
  customer_rating numeric(3,2) check (customer_rating is null or customer_rating between 0 and 5),
  recent_reliability numeric(5,4) not null default 1 check (recent_reliability between 0 and 1),
  current_workload integer not null default 0 check (current_workload >= 0),
  last_active_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill text not null check (char_length(skill) between 1 and 80),
  proficiency text not null default 'ADVANCED' check (proficiency in ('BASIC', 'INTERMEDIATE', 'ADVANCED', 'EXPERT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, skill)
);

create table public.agent_task_types (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  task_type text not null check (task_type in (
    'DIAGNOSE_REPOSITORY', 'BUILD_RESCUE', 'TEST_AND_FIX', 'FEATURE_COMPLETION',
    'PULL_REQUEST_VERIFICATION', 'LAUNCH_READINESS'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, task_type)
);

create table public.agent_endpoints (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  endpoint_type text not null check (endpoint_type in ('LOCAL_WORKER', 'WEBHOOK', 'A2A', 'DEMO')),
  endpoint_url text,
  agent_card_url text,
  authentication_type text not null default 'NONE' check (authentication_type in ('NONE', 'HMAC', 'BEARER', 'OAUTH2', 'A2A')),
  authentication_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(authentication_metadata) = 'object'),
  secret_reference text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED', 'ERROR')),
  last_validated_at timestamptz,
  validation_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, endpoint_type)
);

create table public.agent_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  server_name text not null,
  transport_type text not null check (transport_type in ('STDIO', 'SSE', 'STREAMABLE_HTTP', 'OTHER')),
  tools jsonb not null default '[]'::jsonb check (jsonb_typeof(tools) = 'array'),
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  prompts jsonb not null default '[]'::jsonb check (jsonb_typeof(prompts) = 'array'),
  authentication_required boolean not null default false,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, server_name)
);

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  installation_id bigint not null unique,
  account_login text not null,
  account_type text not null check (account_type in ('USER', 'ORGANIZATION')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  repository_selection text not null default 'SELECTED' check (repository_selection in ('ALL', 'SELECTED')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED', 'DELETED')),
  installed_at timestamptz not null default now(),
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.github_repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.github_installations(id) on delete cascade,
  github_repository_id bigint not null,
  full_name text not null,
  default_branch text not null,
  is_private boolean not null default true,
  selected boolean not null default true,
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, github_repository_id),
  unique (installation_id, full_name)
);

create table public.worker_nodes (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.provider_profiles(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'PENDING_PAIRING'
    check (status in ('PENDING_PAIRING', 'ONLINE', 'BUSY', 'OFFLINE', 'SUSPENDED', 'REVOKED')),
  accepting_jobs boolean not null default false,
  paired_at timestamptz,
  last_heartbeat_at timestamptz,
  worker_version text,
  max_concurrent_jobs integer not null default 1 check (max_concurrent_jobs between 1 and 32),
  active_job_count integer not null default 0 check (active_job_count between 0 and 32),
  suspended_at timestamptz,
  suspension_reason text,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (active_job_count <= max_concurrent_jobs)
);

create table public.worker_capabilities (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null unique references public.worker_nodes(id) on delete cascade,
  schema_version integer not null default 1 check (schema_version > 0),
  operating_system text not null,
  architecture text,
  cpu_count integer check (cpu_count is null or cpu_count > 0),
  memory_bytes bigint check (memory_bytes is null or memory_bytes >= 0),
  free_disk_bytes bigint check (free_disk_bytes is null or free_disk_bytes >= 0),
  docker_available boolean not null default false,
  codex_available boolean not null default false,
  git_available boolean not null default false,
  github_cli_available boolean not null default false,
  supported_languages text[] not null default '{}'::text[],
  installed_tools text[] not null default '{}'::text[],
  available_executors text[] not null default array['DEMO']::text[],
  max_concurrent_jobs integer not null default 1 check (max_concurrent_jobs between 1 and 32),
  reported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worker_mcp_servers (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_nodes(id) on delete cascade,
  server_name text not null,
  transport_type text not null check (transport_type in ('STDIO', 'SSE', 'STREAMABLE_HTTP', 'OTHER')),
  tools jsonb not null default '[]'::jsonb check (jsonb_typeof(tools) = 'array'),
  resources jsonb not null default '[]'::jsonb check (jsonb_typeof(resources) = 'array'),
  prompts jsonb not null default '[]'::jsonb check (jsonb_typeof(prompts) = 'array'),
  installed boolean not null default true,
  authentication_configured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (worker_id, server_name)
);

create table public.worker_heartbeats (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_nodes(id) on delete cascade,
  reported_status text not null check (reported_status in ('ONLINE', 'BUSY', 'DRAINING')),
  worker_version text,
  active_job_count integer not null default 0 check (active_job_count >= 0),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.worker_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_nodes(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  code_lookup text not null unique check (char_length(code_lookup) between 6 and 32),
  code_digest bytea not null check (octet_length(code_digest) = 32),
  expires_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  last_attempt_at timestamptz,
  consumed_at timestamptz,
  consumed_ip_hash bytea check (consumed_ip_hash is null or octet_length(consumed_ip_hash) = 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table public.worker_tokens (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.worker_nodes(id) on delete cascade,
  token_id text not null unique check (char_length(token_id) between 12 and 80),
  token_digest bytea not null check (octet_length(token_digest) = 32),
  scopes text[] not null default array['heartbeat', 'jobs:poll', 'jobs:claim', 'jobs:events', 'evidence:upload']::text[],
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  repository_id uuid references public.github_repositories(id) on delete restrict,
  repository_mode text not null default 'DEMO' check (repository_mode in ('DEMO', 'GITHUB')),
  repository_label text not null,
  target_branch text not null default 'main',
  title text not null check (char_length(title) between 3 and 180),
  problem_description text not null,
  desired_outcome text not null,
  category text not null check (category in (
    'DIAGNOSE_REPOSITORY', 'BUILD_RESCUE', 'TEST_AND_FIX', 'FEATURE_COMPLETION',
    'PULL_REQUEST_VERIFICATION', 'LAUNCH_READINESS'
  )),
  budget_cents bigint not null check (budget_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  deadline_at timestamptz,
  security_sensitivity text not null default 'STANDARD' check (security_sensitivity in ('LOW', 'STANDARD', 'HIGH')),
  allow_code_changes boolean not null default true,
  allow_pull_request boolean not null default false,
  requires_human_approval boolean not null default true,
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'PUBLISHED', 'ANALYZING', 'MATCHING', 'MATCHED', 'AWAITING_PROVIDER',
    'ASSIGNED', 'RUNNING', 'SUBMITTED', 'VERIFYING', 'VERIFICATION_PASSED',
    'VERIFICATION_FAILED', 'CUSTOMER_REVIEW', 'DISPUTED', 'COMPLETED',
    'CANCELLED', 'EXPIRED'
  )),
  status_version integer not null default 0 check (status_version >= 0),
  scope_summary text,
  suggested_task_template text,
  risk_level text check (risk_level is null or risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  suggested_verification_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(suggested_verification_checks) = 'array'),
  suggested_budget_cents bigint check (suggested_budget_cents is null or suggested_budget_cents >= 0),
  estimated_duration_minutes integer check (estimated_duration_minutes is null or estimated_duration_minutes >= 0),
  analysis_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis_metadata) = 'object'),
  published_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((repository_mode = 'GITHUB' and repository_id is not null) or repository_mode = 'DEMO')
);

create table public.task_requirements (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  requirement_type text not null check (requirement_type in ('SKILL', 'OPERATING_SYSTEM', 'TOOL', 'MCP_TOOL')),
  requirement_key text not null,
  requirement_value jsonb not null default '{}'::jsonb,
  required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, requirement_type, requirement_key)
);

create table public.task_acceptance_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  check_type text not null check (check_type in (
    'COMMAND_EXIT', 'TEST', 'BUILD', 'GITHUB_CHECK', 'FILE_EXISTS', 'DIFF',
    'PULL_REQUEST', 'URL_HEALTH', 'SCREENSHOT', 'HUMAN_APPROVAL'
  )),
  name text not null,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  required boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_opportunities (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  title text not null,
  scope_summary text not null,
  category text not null,
  budget_cents bigint not null check (budget_cents >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  deadline_at timestamptz,
  required_capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(required_capabilities) = 'array'),
  risk_level text not null check (risk_level in ('LOW', 'MEDIUM', 'HIGH')),
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_matches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  skill_match numeric(5,4) not null check (skill_match between 0 and 1),
  verified_success_rate numeric(5,4) not null check (verified_success_rate between 0 and 1),
  availability_score numeric(5,4) not null check (availability_score between 0 and 1),
  environment_match numeric(5,4) not null check (environment_match between 0 and 1),
  budget_fit numeric(5,4) not null check (budget_fit between 0 and 1),
  average_speed numeric(5,4) not null check (average_speed between 0 and 1),
  recent_reliability numeric(5,4) not null check (recent_reliability between 0 and 1),
  total_score numeric(6,3) not null check (total_score between 0 and 100),
  rank integer not null check (rank > 0),
  eligible boolean not null default true,
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, agent_id),
  unique (task_id, rank)
);

create table public.task_assignments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  match_id uuid references public.task_matches(id) on delete set null,
  agent_id uuid not null references public.agents(id) on delete restrict,
  provider_id uuid not null references public.provider_profiles(id) on delete restrict,
  worker_id uuid references public.worker_nodes(id) on delete restrict,
  status text not null default 'OFFERED'
    check (status in ('OFFERED', 'ACCEPTED', 'DECLINED', 'SCHEDULED', 'RUNNING', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  quoted_price_cents bigint not null check (quoted_price_cents >= 0),
  platform_fee_bps integer not null default 2000 check (platform_fee_bps between 0 and 10000),
  offered_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  scheduled_for timestamptz,
  expires_at timestamptz,
  provider_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_worker_statuses (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  assignment_id uuid not null unique references public.task_assignments(id) on delete cascade,
  worker_id uuid not null references public.worker_nodes(id) on delete restrict,
  worker_name text not null,
  status text not null check (status in ('ONLINE', 'BUSY', 'OFFLINE', 'SUSPENDED', 'REVOKED')),
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  sequence integer not null check (sequence > 0),
  event_type text not null,
  from_status text,
  to_status text,
  actor_type text not null check (actor_type in ('CUSTOMER', 'PROVIDER', 'WORKER', 'ADMIN', 'SYSTEM', 'VERIFIER')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  worker_id uuid references public.worker_nodes(id) on delete set null,
  reason text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, sequence)
);

create table public.task_state_transitions (
  id uuid primary key default gen_random_uuid(),
  from_status text not null,
  to_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_status, to_status),
  check (from_status <> to_status)
);

create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  assignment_id uuid not null references public.task_assignments(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  worker_id uuid not null references public.worker_nodes(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  executor_type text not null check (executor_type in ('DEMO', 'CODEX_CLI', 'WEBHOOK')),
  workflow_template_key text not null,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'CLAIMED', 'RUNNING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'LEASE_EXPIRED')),
  timeout_seconds integer not null check (timeout_seconds between 1 and 86400),
  max_log_bytes bigint not null default 5242880 check (max_log_bytes between 1024 and 52428800),
  max_artifact_bytes bigint not null default 10485760 check (max_artifact_bytes between 1024 and 104857600),
  allowed_network_domains text[] not null default '{}'::text[],
  started_at timestamptz,
  finished_at timestamptz,
  absolute_deadline_at timestamptz not null,
  cancel_requested_at timestamptz,
  exit_code integer,
  commit_sha_before text,
  commit_sha_after text,
  changed_files jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_files) = 'array'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  failure_code text,
  logs_truncated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, attempt_no),
  check (absolute_deadline_at > created_at)
);

create table public.worker_job_leases (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid not null references public.job_runs(id) on delete restrict,
  worker_id uuid not null references public.worker_nodes(id) on delete restrict,
  lease_generation integer not null check (lease_generation > 0),
  lease_token_digest bytea not null check (octet_length(lease_token_digest) = 32),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'RELEASED', 'EXPIRED', 'CANCELLED')),
  claimed_at timestamptz not null default now(),
  renewed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_run_id, lease_generation),
  check (expires_at > claimed_at)
);

create table public.job_run_events (
  id uuid primary key default gen_random_uuid(),
  job_run_id uuid not null references public.job_runs(id) on delete restrict,
  client_sequence integer not null check (client_sequence > 0),
  event_type text not null,
  level text not null default 'INFO' check (level in ('DEBUG', 'INFO', 'WARN', 'ERROR')),
  message text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_run_id, client_sequence)
);

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  worker_id uuid not null references public.worker_nodes(id) on delete restrict,
  job_run_id uuid not null references public.job_runs(id) on delete restrict,
  artifact_type text not null check (artifact_type in (
    'TASK_SUMMARY', 'PATCH', 'GIT_DIFF', 'CHANGED_FILES', 'BUILD_LOG', 'TEST_LOG',
    'EXIT_RESULT', 'PULL_REQUEST', 'SCREENSHOT', 'VERIFICATION_REPORT', 'OTHER'
  )),
  file_name text not null check (
    char_length(file_name) between 1 and 240
    and file_name !~ '[\\/]'
    and file_name not in ('.', '..')
  ),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 104857600),
  sha256 bytea check (sha256 is null or octet_length(sha256) = 32),
  storage_path text not null unique check (
    storage_path !~ '(^|/)\.\.(/|$)'
    and storage_path !~ '^/'
  ),
  upload_status text not null default 'PENDING'
    check (upload_status in ('PENDING', 'UPLOADED', 'VERIFIED', 'REJECTED', 'DELETED')),
  verified_at timestamptz,
  rejected_reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((upload_status = 'VERIFIED' and sha256 is not null and verified_at is not null) or upload_status <> 'VERIFIED')
);

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  job_run_id uuid not null references public.job_runs(id) on delete restrict,
  verifier_version text not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'PASSED', 'FAILED', 'ERROR', 'CANCELLED')),
  required_check_count integer not null default 0 check (required_check_count >= 0),
  passed_check_count integer not null default 0 check (passed_check_count >= 0),
  failed_check_count integer not null default 0 check (failed_check_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  summary text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (passed_check_count + failed_check_count <= required_check_count)
);

create table public.verification_results (
  id uuid primary key default gen_random_uuid(),
  verification_run_id uuid not null references public.verification_runs(id) on delete cascade,
  acceptance_check_id uuid not null references public.task_acceptance_checks(id) on delete restrict,
  status text not null check (status in ('PENDING', 'PASSED', 'FAILED', 'SKIPPED', 'ERROR')),
  summary text not null,
  expected jsonb not null default '{}'::jsonb,
  actual jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (verification_run_id, acceptance_check_id)
);

create table public.verification_result_artifacts (
  id uuid primary key default gen_random_uuid(),
  verification_result_id uuid not null references public.verification_results(id) on delete cascade,
  evidence_artifact_id uuid not null references public.evidence_artifacts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (verification_result_id, evidence_artifact_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  customer_id uuid not null references public.customer_profiles(id) on delete restrict,
  provider_id uuid not null references public.provider_profiles(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  rating integer not null check (rating between 1 and 5),
  comment text,
  status text not null default 'PUBLISHED' check (status in ('PUBLISHED', 'HIDDEN', 'REMOVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id, customer_id)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED_CUSTOMER', 'RESOLVED_PROVIDER', 'CANCELLED')),
  reason text not null,
  held_amount_cents bigint not null default 0 check (held_amount_cents >= 0),
  resolution text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_wallets (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id) on delete restrict,
  system_key text,
  account_type text not null check (account_type in (
    'CUSTOMER_AVAILABLE', 'PROVIDER_AVAILABLE', 'PROVIDER_PENDING',
    'ESCROW', 'PLATFORM_REVENUE', 'DISPUTE_HOLD', 'TEST_FAUCET'
  )),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  balance_cents bigint not null default 0,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'FROZEN', 'CLOSED')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((owner_profile_id is not null and system_key is null) or (owner_profile_id is null and system_key is not null)),
  check (balance_cents >= 0 or account_type = 'TEST_FAUCET')
);

create table public.test_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete restrict,
  dispute_id uuid references public.disputes(id) on delete restrict,
  operation text not null check (operation in ('GENESIS', 'RESERVE', 'RELEASE', 'REFUND', 'DISPUTE_HOLD', 'DISPUTE_RELEASE', 'ADJUSTMENT')),
  idempotency_key text not null unique,
  status text not null default 'POSTED' check (status = 'POSTED'),
  description text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.test_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.test_ledger_transactions(id) on delete restrict,
  wallet_id uuid not null references public.test_wallets(id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (transaction_id, wallet_id)
);

create table public.webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('GITHUB', 'WEBHOOK_AGENT', 'A2A')),
  delivery_id text not null,
  nonce text,
  signature_timestamp timestamptz,
  event_type text not null,
  body_sha256 bytea not null check (octet_length(body_sha256) = 32),
  signature_valid boolean not null default false,
  processing_status text not null default 'RECEIVED' check (processing_status in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
  processed_at timestamptz,
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, delivery_id)
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('ANONYMOUS', 'CUSTOMER', 'PROVIDER', 'WORKER', 'ADMIN', 'SYSTEM', 'VERIFIER')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  worker_id uuid references public.worker_nodes(id) on delete set null,
  request_id text,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  success boolean not null,
  ip_hash bytea check (ip_hash is null or octet_length(ip_hash) = 32),
  user_agent_hash bytea check (user_agent_hash is null or octet_length(user_agent_hash) = 32),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index test_wallets_owner_type_currency_uidx
  on public.test_wallets (owner_profile_id, account_type, currency)
  where owner_profile_id is not null;

create unique index test_wallets_system_key_currency_uidx
  on public.test_wallets (system_key, currency)
  where system_key is not null;

create unique index webhook_receipts_source_nonce_uidx
  on public.webhook_receipts (source, nonce)
  where nonce is not null;

insert into public.task_state_transitions (from_status, to_status) values
  ('DRAFT', 'PUBLISHED'),
  ('DRAFT', 'CANCELLED'),
  ('PUBLISHED', 'ANALYZING'),
  ('PUBLISHED', 'CANCELLED'),
  ('PUBLISHED', 'EXPIRED'),
  ('ANALYZING', 'MATCHING'),
  ('ANALYZING', 'CANCELLED'),
  ('ANALYZING', 'EXPIRED'),
  ('MATCHING', 'MATCHED'),
  ('MATCHING', 'CANCELLED'),
  ('MATCHING', 'EXPIRED'),
  ('MATCHED', 'AWAITING_PROVIDER'),
  ('MATCHED', 'MATCHING'),
  ('MATCHED', 'CANCELLED'),
  ('AWAITING_PROVIDER', 'ASSIGNED'),
  ('AWAITING_PROVIDER', 'MATCHING'),
  ('AWAITING_PROVIDER', 'CANCELLED'),
  ('AWAITING_PROVIDER', 'EXPIRED'),
  ('ASSIGNED', 'RUNNING'),
  ('ASSIGNED', 'AWAITING_PROVIDER'),
  ('ASSIGNED', 'CANCELLED'),
  ('ASSIGNED', 'EXPIRED'),
  ('RUNNING', 'SUBMITTED'),
  ('RUNNING', 'ASSIGNED'),
  ('RUNNING', 'CANCELLED'),
  ('RUNNING', 'EXPIRED'),
  ('SUBMITTED', 'VERIFYING'),
  ('SUBMITTED', 'RUNNING'),
  ('SUBMITTED', 'CANCELLED'),
  ('VERIFYING', 'VERIFICATION_PASSED'),
  ('VERIFYING', 'VERIFICATION_FAILED'),
  ('VERIFYING', 'CANCELLED'),
  ('VERIFICATION_PASSED', 'CUSTOMER_REVIEW'),
  ('VERIFICATION_FAILED', 'ASSIGNED'),
  ('VERIFICATION_FAILED', 'DISPUTED'),
  ('VERIFICATION_FAILED', 'CANCELLED'),
  ('CUSTOMER_REVIEW', 'COMPLETED'),
  ('CUSTOMER_REVIEW', 'DISPUTED'),
  ('CUSTOMER_REVIEW', 'ASSIGNED'),
  ('CUSTOMER_REVIEW', 'CANCELLED'),
  ('DISPUTED', 'COMPLETED'),
  ('DISPUTED', 'ASSIGNED'),
  ('DISPUTED', 'CANCELLED');

create or replace function private.enforce_task_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if coalesce(current_setting('donelayer.transition_task_id', true), '') <> old.id::text then
    raise exception 'task status can only change through the transition command'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from public.task_state_transitions transition
    where transition.from_status = old.status
      and transition.to_status = new.status
  ) then
    raise exception 'invalid task transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if new.status_version <> old.status_version + 1 then
    raise exception 'task status_version must increment exactly once'
      using errcode = '40001';
  end if;

  if new.status in ('VERIFICATION_PASSED', 'COMPLETED') and not exists (
    select 1
    from public.verification_runs run
    join public.job_runs verified_job on verified_job.id = run.job_run_id
    where run.task_id = new.id
      and run.status = 'PASSED'
      and verified_job.task_id = new.id
      and verified_job.id = (
        select latest_job.id
        from public.job_runs latest_job
        where latest_job.task_id = new.id
        order by latest_job.created_at desc, latest_job.id desc
        limit 1
      )
      and run.id = (
        select latest_verification.id
        from public.verification_runs latest_verification
        where latest_verification.task_id = new.id
          and latest_verification.job_run_id = verified_job.id
        order by latest_verification.created_at desc, latest_verification.id desc
        limit 1
      )
      and not exists (
        select 1
        from public.task_acceptance_checks acceptance
        where acceptance.task_id = new.id
          and acceptance.required
          and not exists (
            select 1
            from public.verification_results result
            where result.verification_run_id = run.id
              and result.acceptance_check_id = acceptance.id
              and result.status = 'PASSED'
          )
      )
  ) then
    raise exception 'required acceptance checks have not passed'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_task_transition_before_update
before update of status on public.tasks
for each row execute function private.enforce_task_transition();

create or replace function private.transition_task(
  p_task_id uuid,
  p_expected_status text,
  p_to_status text,
  p_actor_type text,
  p_actor_profile_id uuid,
  p_worker_id uuid,
  p_event_type text,
  p_reason text,
  p_payload jsonb default '{}'::jsonb
)
returns public.tasks
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_task public.tasks%rowtype;
  next_sequence integer;
begin
  select * into current_task
  from public.tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception 'task not found' using errcode = 'P0002';
  end if;

  if current_task.status <> p_expected_status then
    raise exception 'task state changed; expected %, found %', p_expected_status, current_task.status
      using errcode = '40001';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'transition reason is required' using errcode = '23514';
  end if;

  case p_actor_type
    when 'CUSTOMER' then
      if p_worker_id is not null or not exists (
        select 1
        from public.customer_profiles customer
        join public.profiles profile on profile.id = customer.profile_id
        where customer.id = current_task.customer_id
          and customer.profile_id = p_actor_profile_id
          and profile.status = 'ACTIVE'
          and profile.deleted_at is null
      ) then
        raise exception 'customer actor does not own task' using errcode = '42501';
      end if;
    when 'PROVIDER' then
      if p_worker_id is not null or not exists (
        select 1
        from public.task_assignments assignment
        join public.provider_profiles provider on provider.id = assignment.provider_id
        join public.profiles profile on profile.id = provider.profile_id
        where assignment.task_id = p_task_id
          and provider.profile_id = p_actor_profile_id
          and profile.status = 'ACTIVE'
          and profile.deleted_at is null
          and assignment.id = (
            select latest_assignment.id
            from public.task_assignments latest_assignment
            where latest_assignment.task_id = p_task_id
            order by latest_assignment.created_at desc, latest_assignment.id desc
            limit 1
          )
      ) then
        raise exception 'provider actor is not assigned to task' using errcode = '42501';
      end if;
    when 'WORKER' then
      if p_actor_profile_id is not null or p_worker_id is null or not exists (
        select 1
        from public.task_assignments assignment
        join public.worker_nodes worker on worker.id = assignment.worker_id
        where assignment.task_id = p_task_id
          and assignment.worker_id = p_worker_id
          and worker.status in ('ONLINE', 'BUSY')
          and worker.revoked_at is null
          and worker.suspended_at is null
          and exists (
            select 1
            from public.job_runs run
            join public.worker_job_leases lease on lease.job_run_id = run.id
            where run.task_id = p_task_id
              and run.worker_id = p_worker_id
              and lease.worker_id = p_worker_id
              and lease.status = 'ACTIVE'
              and lease.expires_at > now()
          )
          and assignment.id = (
            select latest_assignment.id
            from public.task_assignments latest_assignment
            where latest_assignment.task_id = p_task_id
            order by latest_assignment.created_at desc, latest_assignment.id desc
            limit 1
          )
      ) then
        raise exception 'worker actor is not assigned to task' using errcode = '42501';
      end if;
    when 'ADMIN' then
      if p_worker_id is not null or not exists (
        select 1
        from public.profile_roles profile_role
        join public.profiles profile on profile.id = profile_role.profile_id
        where profile_role.profile_id = p_actor_profile_id
          and profile_role.role = 'ADMIN'
          and profile.status = 'ACTIVE'
          and profile.deleted_at is null
      ) then
        raise exception 'admin actor is invalid' using errcode = '42501';
      end if;
    when 'SYSTEM' then
      if p_actor_profile_id is not null or p_worker_id is not null then
        raise exception 'system transition cannot impersonate another actor' using errcode = '42501';
      end if;
    when 'VERIFIER' then
      if p_actor_profile_id is not null or p_worker_id is not null then
        raise exception 'verifier transition cannot impersonate another actor' using errcode = '42501';
      end if;
    else
      raise exception 'invalid task transition actor' using errcode = '22023';
  end case;

  if p_to_status = 'COMPLETED' then
    if p_expected_status = 'CUSTOMER_REVIEW' and p_actor_type not in ('CUSTOMER', 'ADMIN') then
      raise exception 'only the task customer or an admin can accept delivery' using errcode = '42501';
    elsif p_expected_status = 'DISPUTED' and p_actor_type <> 'ADMIN' then
      raise exception 'only an admin can complete a disputed task' using errcode = '42501';
    end if;
  end if;

  select coalesce(max(sequence), 0) + 1 into next_sequence
  from public.task_events
  where task_id = p_task_id;

  perform set_config('donelayer.transition_task_id', p_task_id::text, true);

  update public.tasks
  set status = p_to_status,
      status_version = status_version + 1,
      published_at = case when p_to_status = 'PUBLISHED' then coalesce(published_at, now()) else published_at end,
      completed_at = case when p_to_status = 'COMPLETED' then now() else completed_at end,
      cancelled_at = case when p_to_status = 'CANCELLED' then now() else cancelled_at end
  where id = p_task_id
  returning * into current_task;

  perform set_config('donelayer.transition_task_id', '', true);

  insert into public.task_events (
    task_id, sequence, event_type, from_status, to_status, actor_type,
    actor_profile_id, worker_id, reason, payload
  ) values (
    p_task_id, next_sequence, p_event_type, p_expected_status, p_to_status, p_actor_type,
    p_actor_profile_id, p_worker_id, p_reason, coalesce(p_payload, '{}'::jsonb)
  );

  if p_to_status = 'MATCHING' then
    insert into public.task_opportunities (
      task_id, title, scope_summary, category, budget_cents, currency,
      deadline_at, required_capabilities, risk_level, published
    )
    select
      task.id,
      initcap(replace(task.category, '_', ' ')) || ' task',
      coalesce(task.scope_summary, 'A scoped software task awaiting a compatible provider.'),
      task.category,
      task.budget_cents,
      task.currency,
      task.deadline_at,
      coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'type', requirement.requirement_type,
              'key', requirement.requirement_key,
              'required', requirement.required
            ) order by requirement.requirement_type, requirement.requirement_key
          )
          from public.task_requirements requirement
          where requirement.task_id = task.id
        ),
        '[]'::jsonb
      ),
      coalesce(task.risk_level, 'MEDIUM'),
      true
    from public.tasks task
    where task.id = p_task_id
    on conflict (task_id) do update set
      title = excluded.title,
      scope_summary = excluded.scope_summary,
      category = excluded.category,
      budget_cents = excluded.budget_cents,
      currency = excluded.currency,
      deadline_at = excluded.deadline_at,
      required_capabilities = excluded.required_capabilities,
      risk_level = excluded.risk_level,
      published = true;
  elsif p_to_status in ('ASSIGNED', 'RUNNING', 'CANCELLED', 'EXPIRED', 'COMPLETED') then
    update public.task_opportunities
    set published = false
    where task_id = p_task_id;
  end if;

  insert into public.audit_logs (
    actor_type, actor_profile_id, worker_id, action, resource_type, resource_id, success, metadata
  ) values (
    p_actor_type, p_actor_profile_id, p_worker_id, 'task.transition', 'task', p_task_id, true,
    jsonb_build_object('from', p_expected_status, 'to', p_to_status, 'eventType', p_event_type)
  );

  return current_task;
end;
$$;

revoke all on function private.transition_task(uuid, text, text, text, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.transition_task(uuid, text, text, text, uuid, uuid, text, text, jsonb) to service_role;

create or replace function private.enforce_assignment_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id
      or new.match_id is distinct from old.match_id
      or new.agent_id is distinct from old.agent_id
      or new.provider_id is distinct from old.provider_id
    then
      raise exception 'assignment identity is immutable' using errcode = '55000';
    end if;

    if new.worker_id is distinct from old.worker_id
      and exists (select 1 from public.job_runs run where run.assignment_id = old.id)
    then
      raise exception 'assignment worker is immutable after a job is created' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1 from public.agents agent
    where agent.id = new.agent_id and agent.provider_id = new.provider_id
  ) then
    raise exception 'assignment agent/provider mismatch' using errcode = '23514';
  end if;

  if new.match_id is not null and not exists (
    select 1 from public.task_matches match
    where match.id = new.match_id
      and match.task_id = new.task_id
      and match.agent_id = new.agent_id
  ) then
    raise exception 'assignment match/task/agent mismatch' using errcode = '23514';
  end if;

  if new.worker_id is not null and not exists (
    select 1 from public.worker_nodes worker
    where worker.id = new.worker_id and worker.provider_id = new.provider_id
  ) then
    raise exception 'assignment worker/provider mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_assignment_consistency_before_write
before insert or update of task_id, match_id, agent_id, provider_id, worker_id
on public.task_assignments
for each row execute function private.enforce_assignment_consistency();

create or replace function private.enforce_job_run_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id
      or new.assignment_id is distinct from old.assignment_id
      or new.agent_id is distinct from old.agent_id
      or new.worker_id is distinct from old.worker_id
    then
      raise exception 'job run identity is immutable' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1
    from public.task_assignments assignment
    where assignment.id = new.assignment_id
      and assignment.task_id = new.task_id
      and assignment.agent_id = new.agent_id
      and assignment.worker_id = new.worker_id
      and assignment.accepted_at is not null
      and assignment.status in ('ACCEPTED', 'SCHEDULED', 'RUNNING')
  ) then
    raise exception 'job run does not match an accepted assignment' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_job_run_consistency_before_write
before insert or update of task_id, assignment_id, agent_id, worker_id
on public.job_runs
for each row execute function private.enforce_job_run_consistency();

create or replace function private.enforce_evidence_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id
      or new.worker_id is distinct from old.worker_id
      or new.job_run_id is distinct from old.job_run_id
    then
      raise exception 'evidence identity is immutable' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1 from public.job_runs run
    where run.id = new.job_run_id
      and run.task_id = new.task_id
      and run.worker_id = new.worker_id
  ) then
    raise exception 'evidence task/worker/job mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_evidence_consistency_before_write
before insert or update of task_id, worker_id, job_run_id
on public.evidence_artifacts
for each row execute function private.enforce_evidence_consistency();

create or replace function private.enforce_verification_run_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.task_id is distinct from old.task_id
      or new.job_run_id is distinct from old.job_run_id
    then
      raise exception 'verification run identity is immutable' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1 from public.job_runs run
    where run.id = new.job_run_id and run.task_id = new.task_id
  ) then
    raise exception 'verification task/job mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_verification_run_consistency_before_write
before insert or update of task_id, job_run_id
on public.verification_runs
for each row execute function private.enforce_verification_run_consistency();

create or replace function private.enforce_verification_result_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.verification_run_id is distinct from old.verification_run_id
      or new.acceptance_check_id is distinct from old.acceptance_check_id
    then
      raise exception 'verification result identity is immutable' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1
    from public.verification_runs run
    join public.task_acceptance_checks acceptance on acceptance.task_id = run.task_id
    where run.id = new.verification_run_id
      and acceptance.id = new.acceptance_check_id
  ) then
    raise exception 'verification result/check task mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_verification_result_consistency_before_write
before insert or update of verification_run_id, acceptance_check_id
on public.verification_results
for each row execute function private.enforce_verification_result_consistency();

create or replace function private.enforce_result_artifact_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    if new.verification_result_id is distinct from old.verification_result_id
      or new.evidence_artifact_id is distinct from old.evidence_artifact_id
    then
      raise exception 'verification artifact link is immutable' using errcode = '55000';
    end if;
  end if;

  if not exists (
    select 1
    from public.verification_results result
    join public.verification_runs run on run.id = result.verification_run_id
    join public.evidence_artifacts artifact on artifact.id = new.evidence_artifact_id
    where result.id = new.verification_result_id
      and artifact.task_id = run.task_id
      and artifact.job_run_id = run.job_run_id
      and artifact.upload_status = 'VERIFIED'
  ) then
    raise exception 'verification artifact is not verified for this job' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_result_artifact_consistency_before_write
before insert or update of verification_result_id, evidence_artifact_id
on public.verification_result_artifacts
for each row execute function private.enforce_result_artifact_consistency();

create or replace function private.enforce_task_worker_status_consistency()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.task_assignments assignment
    where assignment.id = new.assignment_id
      and assignment.task_id = new.task_id
      and assignment.worker_id = new.worker_id
  ) then
    raise exception 'task worker status does not match assignment' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger enforce_task_worker_status_consistency_before_write
before insert or update of task_id, assignment_id, worker_id
on public.task_worker_statuses
for each row execute function private.enforce_task_worker_status_consistency();

create or replace function private.constant_time_equal(p_left bytea, p_right bytea)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = pg_catalog
as $$
declare
  difference integer := 0;
  byte_index integer;
begin
  if octet_length(p_left) <> octet_length(p_right) then
    return false;
  end if;

  for byte_index in 0 .. octet_length(p_left) - 1 loop
    difference := difference | (get_byte(p_left, byte_index) # get_byte(p_right, byte_index));
  end loop;

  return difference = 0;
end;
$$;

create or replace function private.consume_pairing_code_and_issue_token(
  p_code_lookup text,
  p_code_digest bytea,
  p_token_id text,
  p_token_digest bytea,
  p_consumed_ip_hash bytea default null,
  p_token_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  pairing public.worker_pairing_codes%rowtype;
  paired_worker_id uuid;
begin
  if p_code_digest is null or octet_length(p_code_digest) <> 32
    or p_token_digest is null or octet_length(p_token_digest) <> 32
    or p_token_id is null or char_length(p_token_id) not between 12 and 80
    or (p_consumed_ip_hash is not null and octet_length(p_consumed_ip_hash) <> 32)
  then
    raise exception 'invalid pairing credential material' using errcode = '22023';
  end if;

  select * into pairing
  from public.worker_pairing_codes pairing_code
  where pairing_code.code_lookup = p_code_lookup
  for update;

  if not found
    or pairing.consumed_at is not null
    or pairing.expires_at <= now()
    or pairing.attempt_count >= 5
  then
    return null;
  end if;

  update public.worker_pairing_codes
  set attempt_count = attempt_count + 1,
      last_attempt_at = now()
  where id = pairing.id;

  if not private.constant_time_equal(pairing.code_digest, p_code_digest) then
    return null;
  end if;

  select worker.id into paired_worker_id
  from public.worker_nodes worker
  where worker.id = pairing.worker_id
    and worker.status = 'PENDING_PAIRING'
    and worker.revoked_at is null
  for update;

  if not found then
    return null;
  end if;

  update public.worker_pairing_codes
  set consumed_at = now(),
      consumed_ip_hash = p_consumed_ip_hash
  where id = pairing.id
    and consumed_at is null;

  insert into public.worker_tokens (
    worker_id, token_id, token_digest, expires_at
  ) values (
    paired_worker_id, p_token_id, p_token_digest, p_token_expires_at
  );

  update public.worker_nodes
  set status = 'OFFLINE',
      paired_at = now(),
      accepting_jobs = false
  where id = paired_worker_id;

  insert into public.audit_logs (
    actor_type, worker_id, action, resource_type, resource_id, success, ip_hash, metadata
  ) values (
    'WORKER', paired_worker_id, 'worker.paired', 'worker', paired_worker_id, true,
    p_consumed_ip_hash, jsonb_build_object('tokenId', p_token_id)
  );

  return paired_worker_id;
end;
$$;

create or replace function private.claim_job(
  p_worker_id uuid,
  p_lease_token_digest bytea,
  p_lease_seconds integer default 60
)
returns table (
  claimed_job_run_id uuid,
  claimed_lease_id uuid,
  claimed_lease_generation integer,
  claimed_lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_job public.job_runs%rowtype;
  selected_worker public.worker_nodes%rowtype;
  new_lease_id uuid;
  new_generation integer;
  new_expiry timestamptz;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'lease duration is outside the allowed range' using errcode = '22023';
  end if;

  select * into selected_worker
  from public.worker_nodes worker
  where worker.id = p_worker_id
  for update;

  if not found
    or selected_worker.status not in ('ONLINE', 'BUSY')
    or not selected_worker.accepting_jobs
    or selected_worker.revoked_at is not null
    or selected_worker.suspended_at is not null
    or selected_worker.last_heartbeat_at is null
    or selected_worker.last_heartbeat_at < now() - interval '45 seconds'
    or selected_worker.active_job_count >= selected_worker.max_concurrent_jobs
  then
    return;
  end if;

  select run.* into selected_job
  from public.job_runs run
  join public.task_assignments assignment on assignment.id = run.assignment_id
  where run.worker_id = p_worker_id
    and run.status = 'QUEUED'
    and run.absolute_deadline_at > now()
    and assignment.accepted_at is not null
    and assignment.status in ('ACCEPTED', 'SCHEDULED', 'RUNNING')
  order by run.created_at
  for update of run skip locked
  limit 1;

  if not found then
    return;
  end if;

  select coalesce(max(lease_generation), 0) + 1 into new_generation
  from public.worker_job_leases
  where job_run_id = selected_job.id;

  new_lease_id := gen_random_uuid();
  new_expiry := least(
    now() + make_interval(secs => p_lease_seconds),
    selected_job.absolute_deadline_at
  );

  insert into public.worker_job_leases (
    id, job_run_id, worker_id, lease_generation, lease_token_digest, expires_at
  ) values (
    new_lease_id, selected_job.id, p_worker_id, new_generation,
    p_lease_token_digest, new_expiry
  );

  update public.job_runs
  set status = 'CLAIMED',
      started_at = coalesce(started_at, now())
  where id = selected_job.id;

  update public.worker_nodes
  set active_job_count = active_job_count + 1,
      status = 'BUSY'
  where id = p_worker_id;

  insert into public.task_worker_statuses (
    task_id, assignment_id, worker_id, worker_name, status, last_heartbeat_at
  )
  select
    selected_job.task_id,
    selected_job.assignment_id,
    worker.id,
    worker.name,
    'BUSY',
    worker.last_heartbeat_at
  from public.worker_nodes worker
  where worker.id = p_worker_id
  on conflict (task_id) do update set
    assignment_id = excluded.assignment_id,
    worker_id = excluded.worker_id,
    worker_name = excluded.worker_name,
    status = excluded.status,
    last_heartbeat_at = excluded.last_heartbeat_at;

  return query select selected_job.id, new_lease_id, new_generation, new_expiry;
end;
$$;

create or replace function private.renew_job_lease(
  p_worker_id uuid,
  p_job_run_id uuid,
  p_lease_generation integer,
  p_lease_token_digest bytea,
  p_lease_seconds integer default 60
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  renewed_expiry timestamptz;
begin
  if p_lease_seconds < 15 or p_lease_seconds > 300 then
    raise exception 'lease duration is outside the allowed range' using errcode = '22023';
  end if;

  update public.worker_job_leases lease
  set renewed_at = now(),
      expires_at = least(
        now() + make_interval(secs => p_lease_seconds),
        run.absolute_deadline_at
      )
  from public.job_runs run, public.worker_nodes worker
  where lease.job_run_id = p_job_run_id
    and lease.job_run_id = run.id
    and lease.worker_id = p_worker_id
    and worker.id = p_worker_id
    and lease.lease_generation = p_lease_generation
    and private.constant_time_equal(lease.lease_token_digest, p_lease_token_digest)
    and lease.status = 'ACTIVE'
    and lease.expires_at > now()
    and run.status in ('CLAIMED', 'RUNNING')
    and run.cancel_requested_at is null
    and run.absolute_deadline_at > now()
    and worker.status in ('ONLINE', 'BUSY')
    and worker.revoked_at is null
    and worker.suspended_at is null
  returning lease.expires_at into renewed_expiry;

  return renewed_expiry;
end;
$$;

create or replace function private.expire_job_leases()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  expired_lease record;
  expired_count integer := 0;
begin
  for expired_lease in
    select lease.id, lease.job_run_id, lease.worker_id, lease.lease_generation, run.task_id
    from public.worker_job_leases lease
    join public.job_runs run on run.id = lease.job_run_id
    where lease.status = 'ACTIVE'
      and lease.expires_at <= now()
    order by lease.expires_at
    for update skip locked
  loop
    update public.worker_job_leases
    set status = 'EXPIRED',
        released_at = now()
    where id = expired_lease.id
      and status = 'ACTIVE';

    if not found then
      continue;
    end if;

    update public.job_runs
    set status = 'LEASE_EXPIRED',
        failure_code = 'WORKER_LEASE_EXPIRED',
        finished_at = now()
    where id = expired_lease.job_run_id
      and status in ('CLAIMED', 'RUNNING');

    update public.worker_nodes
    set active_job_count = greatest(active_job_count - 1, 0),
        status = case
          when revoked_at is not null then 'REVOKED'
          when suspended_at is not null then 'SUSPENDED'
          when last_heartbeat_at is null or last_heartbeat_at < now() - interval '45 seconds' then 'OFFLINE'
          when active_job_count <= 1 then 'ONLINE'
          else 'BUSY'
        end
    where id = expired_lease.worker_id;

    update public.task_worker_statuses task_worker
    set status = worker.status,
        last_heartbeat_at = worker.last_heartbeat_at
    from public.worker_nodes worker
    where task_worker.task_id = expired_lease.task_id
      and task_worker.worker_id = expired_lease.worker_id
      and worker.id = expired_lease.worker_id;

    insert into public.audit_logs (
      actor_type, worker_id, action, resource_type, resource_id, success, metadata
    ) values (
      'SYSTEM', expired_lease.worker_id, 'job.lease_expired', 'job_run',
      expired_lease.job_run_id, true,
      jsonb_build_object('leaseGeneration', expired_lease.lease_generation)
    );

    expired_count := expired_count + 1;
  end loop;

  return expired_count;
end;
$$;

revoke all on function private.consume_pairing_code_and_issue_token(text, bytea, text, bytea, bytea, timestamptz) from public, anon, authenticated;
revoke all on function private.claim_job(uuid, bytea, integer) from public, anon, authenticated;
revoke all on function private.renew_job_lease(uuid, uuid, integer, bytea, integer) from public, anon, authenticated;
revoke all on function private.expire_job_leases() from public, anon, authenticated;
grant execute on function private.consume_pairing_code_and_issue_token(text, bytea, text, bytea, bytea, timestamptz) to service_role;
grant execute on function private.claim_job(uuid, bytea, integer) to service_role;
grant execute on function private.renew_job_lease(uuid, uuid, integer, bytea, integer) to service_role;
grant execute on function private.expire_job_leases() to service_role;

create or replace function private.apply_test_ledger_entry()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  perform set_config('donelayer.applying_ledger_entry', 'on', true);

  update public.test_wallets
  set balance_cents = balance_cents + new.amount_cents
  where id = new.wallet_id
    and status = 'ACTIVE'
    and (account_type = 'TEST_FAUCET' or balance_cents + new.amount_cents >= 0);

  if not found then
    raise exception 'wallet is unavailable or has insufficient test balance'
      using errcode = '23514';
  end if;

  perform set_config('donelayer.applying_ledger_entry', 'off', true);

  return new;
end;
$$;

create trigger apply_test_ledger_entry_before_insert
before insert on public.test_ledger_entries
for each row execute function private.apply_test_ledger_entry();

create or replace function private.protect_test_wallet_balance()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.balance_cents is distinct from old.balance_cents
    and coalesce(current_setting('donelayer.applying_ledger_entry', true), 'off') <> 'on'
  then
    raise exception 'wallet balance can only change through a ledger entry'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger protect_test_wallet_balance_before_update
before update of balance_cents on public.test_wallets
for each row execute function private.protect_test_wallet_balance();

create or replace function private.assert_test_ledger_balanced()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_transaction_id uuid;
  entry_total bigint;
  currency_count integer;
begin
  target_transaction_id := coalesce(new.transaction_id, old.transaction_id);
  select coalesce(sum(entry.amount_cents), 0), count(distinct wallet.currency)
  into entry_total, currency_count
  from public.test_ledger_entries entry
  join public.test_wallets wallet on wallet.id = entry.wallet_id
  where entry.transaction_id = target_transaction_id;

  if entry_total <> 0 or currency_count <> 1 then
    raise exception 'test ledger transaction % is not balanced in one currency', target_transaction_id
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger assert_test_ledger_balanced_at_commit
after insert or update or delete on public.test_ledger_entries
deferrable initially deferred
for each row execute function private.assert_test_ledger_balanced();

create trigger task_events_append_only
before update or delete on public.task_events
for each row execute function private.reject_row_mutation();

create trigger job_run_events_append_only
before update or delete on public.job_run_events
for each row execute function private.reject_row_mutation();

create trigger worker_heartbeats_append_only
before update or delete on public.worker_heartbeats
for each row execute function private.reject_row_mutation();

create trigger test_ledger_entries_append_only
before update or delete on public.test_ledger_entries
for each row execute function private.reject_row_mutation();

create trigger test_ledger_transactions_append_only
before update or delete on public.test_ledger_transactions
for each row execute function private.reject_row_mutation();

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function private.reject_row_mutation();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'profile_roles', 'customer_profiles', 'provider_profiles', 'provider_public_profiles',
    'agents', 'agent_skills', 'agent_task_types', 'agent_endpoints', 'agent_mcp_servers',
    'github_installations', 'github_repositories', 'worker_nodes', 'worker_capabilities',
    'worker_mcp_servers', 'worker_heartbeats', 'worker_pairing_codes', 'worker_tokens',
    'tasks', 'task_requirements', 'task_acceptance_checks', 'task_opportunities',
    'task_matches', 'task_assignments', 'task_worker_statuses', 'task_events', 'task_state_transitions',
    'job_runs', 'worker_job_leases', 'job_run_events', 'evidence_artifacts',
    'verification_runs', 'verification_results', 'verification_result_artifacts',
    'reviews', 'disputes', 'test_wallets', 'test_ledger_transactions',
    'test_ledger_entries', 'webhook_receipts', 'audit_logs'
  ]
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  end loop;
end;
$$;

create index profiles_auth_user_id_idx on public.profiles (auth_user_id) where auth_user_id is not null;
create index profile_roles_profile_id_idx on public.profile_roles (profile_id);
create index provider_public_profiles_listed_idx on public.provider_public_profiles (listed, provider_id);
create index agents_provider_status_idx on public.agents (provider_id, status);
create index agents_marketplace_success_idx on public.agents (verified_success_rate desc) where status = 'ACTIVE';
create index agents_marketplace_price_idx on public.agents (base_price_cents) where status = 'ACTIVE';
create index agents_marketplace_speed_idx on public.agents (average_completion_seconds) where status = 'ACTIVE';
create index agents_supported_os_gin_idx on public.agents using gin (supported_operating_systems);
create index agents_supported_tools_gin_idx on public.agents using gin (supported_tools);
create index agents_supported_languages_gin_idx on public.agents using gin (supported_languages);
create index agent_skills_skill_idx on public.agent_skills (skill, agent_id);
create index agent_task_types_type_idx on public.agent_task_types (task_type, agent_id);
create index github_installations_customer_idx on public.github_installations (customer_id, status);
create index github_repositories_installation_idx on public.github_repositories (installation_id, selected);
create index worker_nodes_provider_status_idx on public.worker_nodes (provider_id, status);
create index worker_nodes_heartbeat_idx on public.worker_nodes (last_heartbeat_at) where status in ('ONLINE', 'BUSY');
create index worker_heartbeats_worker_received_idx on public.worker_heartbeats (worker_id, received_at desc);
create index worker_pairing_codes_worker_idx on public.worker_pairing_codes (worker_id);
create index worker_pairing_codes_expiry_idx on public.worker_pairing_codes (expires_at) where consumed_at is null;
create index worker_pairing_codes_created_by_idx on public.worker_pairing_codes (created_by);
create unique index worker_pairing_codes_digest_uidx on public.worker_pairing_codes (code_digest);
create index worker_tokens_worker_active_idx on public.worker_tokens (worker_id) where revoked_at is null;
create unique index worker_tokens_digest_uidx on public.worker_tokens (token_digest);
create index tasks_customer_status_idx on public.tasks (customer_id, status, updated_at desc);
create index tasks_repository_idx on public.tasks (repository_id) where repository_id is not null;
create index tasks_status_updated_idx on public.tasks (status, updated_at desc);
create index task_acceptance_checks_task_idx on public.task_acceptance_checks (task_id, sort_order);
create index task_matches_agent_idx on public.task_matches (agent_id, total_score desc);
create index task_assignments_task_status_idx on public.task_assignments (task_id, status);
create index task_assignments_provider_status_idx on public.task_assignments (provider_id, status);
create index task_assignments_agent_idx on public.task_assignments (agent_id);
create index task_assignments_match_idx on public.task_assignments (match_id) where match_id is not null;
create index task_assignments_worker_idx on public.task_assignments (worker_id) where worker_id is not null;
create index task_worker_statuses_worker_idx on public.task_worker_statuses (worker_id);
create unique index task_assignments_one_active_uidx on public.task_assignments (task_id)
  where status in ('OFFERED', 'ACCEPTED', 'SCHEDULED', 'RUNNING');
create index task_events_actor_idx on public.task_events (actor_profile_id) where actor_profile_id is not null;
create index task_events_worker_idx on public.task_events (worker_id) where worker_id is not null;
create index job_runs_task_status_idx on public.job_runs (task_id, status, created_at desc);
create index job_runs_worker_status_idx on public.job_runs (worker_id, status, created_at);
create index job_runs_agent_idx on public.job_runs (agent_id);
create index job_runs_claimable_idx on public.job_runs (worker_id, created_at) where status = 'QUEUED';
create index worker_job_leases_worker_idx on public.worker_job_leases (worker_id, status, expires_at);
create index worker_job_leases_expiry_idx on public.worker_job_leases (expires_at) where status = 'ACTIVE';
create unique index worker_job_leases_digest_uidx on public.worker_job_leases (lease_token_digest);
create unique index worker_job_leases_one_active_uidx on public.worker_job_leases (job_run_id)
  where status = 'ACTIVE';
create index evidence_artifacts_task_idx on public.evidence_artifacts (task_id, created_at);
create index evidence_artifacts_job_idx on public.evidence_artifacts (job_run_id, artifact_type);
create index evidence_artifacts_worker_idx on public.evidence_artifacts (worker_id);
create index verification_runs_task_idx on public.verification_runs (task_id, created_at desc);
create index verification_runs_job_idx on public.verification_runs (job_run_id);
create index verification_results_check_idx on public.verification_results (acceptance_check_id);
create index verification_result_artifacts_evidence_idx on public.verification_result_artifacts (evidence_artifact_id);
create index reviews_agent_status_idx on public.reviews (agent_id, status, created_at desc);
create index reviews_provider_idx on public.reviews (provider_id);
create index reviews_customer_idx on public.reviews (customer_id);
create index disputes_task_status_idx on public.disputes (task_id, status);
create index disputes_opened_by_idx on public.disputes (opened_by);
create index disputes_resolved_by_idx on public.disputes (resolved_by) where resolved_by is not null;
create index test_ledger_transactions_task_idx on public.test_ledger_transactions (task_id, created_at);
create index test_ledger_transactions_dispute_idx on public.test_ledger_transactions (dispute_id) where dispute_id is not null;
create index test_ledger_transactions_created_by_idx on public.test_ledger_transactions (created_by) where created_by is not null;
create index test_ledger_entries_wallet_idx on public.test_ledger_entries (wallet_id, created_at);
create index webhook_receipts_received_idx on public.webhook_receipts (source, received_at desc);
create index webhook_receipts_processing_idx on public.webhook_receipts (processing_status, received_at);
create index audit_logs_actor_idx on public.audit_logs (actor_profile_id, occurred_at desc) where actor_profile_id is not null;
create index audit_logs_worker_idx on public.audit_logs (worker_id, occurred_at desc) where worker_id is not null;
create index audit_logs_resource_idx on public.audit_logs (resource_type, resource_id, occurred_at desc);

-- RLS helpers live outside the Data API's exposed schema. Each function returns
-- only an authorization decision and fixes its search_path.
create or replace function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select profile.id
  from public.profiles profile
  where profile.auth_user_id = auth.uid()
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null
  limit 1
$$;

create or replace function private.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.profile_roles profile_role
    join public.profiles profile on profile.id = profile_role.profile_id
    where profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
      and profile_role.role = p_role
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.has_role('ADMIN')
$$;

create or replace function private.is_verified_provider()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.provider_profiles provider
    join public.profiles profile on profile.id = provider.profile_id
    where profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
      and provider.verification_status = 'VERIFIED'
  )
$$;

create or replace function private.owns_customer(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.customer_profiles customer
    join public.profiles profile on profile.id = customer.profile_id
    where customer.id = p_customer_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
  )
$$;

create or replace function private.owns_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.provider_profiles provider
    join public.profiles profile on profile.id = provider.profile_id
    where provider.id = p_provider_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
  )
$$;

create or replace function private.owns_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.agents agent
    join public.provider_profiles provider on provider.id = agent.provider_id
    join public.profiles profile on profile.id = provider.profile_id
    where agent.id = p_agent_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
  )
$$;

create or replace function private.owns_worker(p_worker_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.worker_nodes worker
    join public.provider_profiles provider on provider.id = worker.provider_id
    join public.profiles profile on profile.id = provider.profile_id
    where worker.id = p_worker_id
      and profile.auth_user_id = auth.uid()
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
  )
$$;

create or replace function private.can_view_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.provider_profiles provider
    join public.profiles profile on profile.id = provider.profile_id
    where provider.id = p_provider_id
      and provider.verification_status = 'VERIFIED'
      and profile.status = 'ACTIVE'
      and profile.deleted_at is null
  ) or private.owns_provider(p_provider_id) or private.is_admin()
$$;

create or replace function private.can_view_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.agents agent
    where agent.id = p_agent_id
      and agent.visibility = 'PUBLIC'
      and agent.status = 'ACTIVE'
      and agent.verification_status = 'VERIFIED'
      and agent.deleted_at is null
  ) or private.owns_agent(p_agent_id) or private.is_admin()
$$;

create or replace function private.is_task_customer(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tasks task
    where task.id = p_task_id
      and private.owns_customer(task.customer_id)
  )
$$;

create or replace function private.is_task_provider(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.task_assignments assignment
    where assignment.task_id = p_task_id
      and private.owns_provider(assignment.provider_id)
      and assignment.status in ('OFFERED', 'ACCEPTED', 'SCHEDULED', 'RUNNING', 'COMPLETED')
      and assignment.id = (
        select latest_assignment.id
        from public.task_assignments latest_assignment
        where latest_assignment.task_id = p_task_id
        order by latest_assignment.created_at desc, latest_assignment.id desc
        limit 1
      )
  )
$$;

create or replace function private.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.is_admin()
    or private.is_task_customer(p_task_id)
    or private.is_task_provider(p_task_id)
$$;

create or replace function private.can_access_job(p_job_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.job_runs run
    where run.id = p_job_run_id
      and private.can_access_task(run.task_id)
  )
$$;

create or replace function private.can_access_wallet(p_wallet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.is_admin() or exists (
    select 1
    from public.test_wallets wallet
    where wallet.id = p_wallet_id
      and wallet.owner_profile_id = private.current_profile_id()
  )
$$;

create or replace function private.can_access_github_installation(p_installation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.is_admin() or exists (
    select 1
    from public.github_installations installation
    where installation.id = p_installation_id
      and private.owns_customer(installation.customer_id)
  )
$$;

create or replace function private.can_access_artifact(p_artifact_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.evidence_artifacts artifact
    where artifact.id = p_artifact_id
      and private.can_access_task(artifact.task_id)
  )
$$;

create or replace function private.can_access_storage_object(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.evidence_artifacts artifact
    where artifact.storage_path = p_object_name
      and artifact.upload_status = 'VERIFIED'
      and private.can_access_task(artifact.task_id)
  )
$$;

revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private grant execute on functions to service_role;
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.can_view_provider(uuid) to anon, authenticated;
grant execute on function private.can_view_agent(uuid) to anon, authenticated;
grant execute on function private.current_profile_id() to authenticated;
grant execute on function private.has_role(text) to authenticated;
grant execute on function private.is_admin() to authenticated;
grant execute on function private.is_verified_provider() to authenticated;
grant execute on function private.owns_customer(uuid) to authenticated;
grant execute on function private.owns_provider(uuid) to authenticated;
grant execute on function private.owns_agent(uuid) to authenticated;
grant execute on function private.owns_worker(uuid) to authenticated;
grant execute on function private.is_task_customer(uuid) to authenticated;
grant execute on function private.is_task_provider(uuid) to authenticated;
grant execute on function private.can_access_task(uuid) to authenticated;
grant execute on function private.can_access_job(uuid) to authenticated;
grant execute on function private.can_access_wallet(uuid) to authenticated;
grant execute on function private.can_access_github_installation(uuid) to authenticated;
grant execute on function private.can_access_artifact(uuid) to authenticated;
grant execute on function private.can_access_storage_object(text) to authenticated;
grant execute on all functions in schema private to service_role;

-- PostgREST-callable wrappers remain SECURITY INVOKER and service-role only.
-- Privileged logic stays in the unexposed private schema.
create or replace function public.rpc_transition_task(
  p_task_id uuid,
  p_expected_status text,
  p_to_status text,
  p_actor_type text,
  p_actor_profile_id uuid,
  p_worker_id uuid,
  p_event_type text,
  p_reason text,
  p_payload jsonb default '{}'::jsonb
)
returns public.tasks
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select *
  from private.transition_task(
    p_task_id, p_expected_status, p_to_status, p_actor_type, p_actor_profile_id,
    p_worker_id, p_event_type, p_reason, p_payload
  )
$$;

create or replace function public.rpc_pair_worker(
  p_code_lookup text,
  p_code_digest bytea,
  p_token_id text,
  p_token_digest bytea,
  p_consumed_ip_hash bytea default null,
  p_token_expires_at timestamptz default null
)
returns uuid
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select private.consume_pairing_code_and_issue_token(
    p_code_lookup, p_code_digest, p_token_id, p_token_digest,
    p_consumed_ip_hash, p_token_expires_at
  )
$$;

create or replace function public.rpc_claim_job(
  p_worker_id uuid,
  p_lease_token_digest bytea,
  p_lease_seconds integer default 60
)
returns table (
  claimed_job_run_id uuid,
  claimed_lease_id uuid,
  claimed_lease_generation integer,
  claimed_lease_expires_at timestamptz
)
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select * from private.claim_job(p_worker_id, p_lease_token_digest, p_lease_seconds)
$$;

create or replace function public.rpc_renew_job_lease(
  p_worker_id uuid,
  p_job_run_id uuid,
  p_lease_generation integer,
  p_lease_token_digest bytea,
  p_lease_seconds integer default 60
)
returns timestamptz
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select private.renew_job_lease(
    p_worker_id, p_job_run_id, p_lease_generation,
    p_lease_token_digest, p_lease_seconds
  )
$$;

create or replace function public.rpc_expire_job_leases()
returns integer
language sql
volatile
security invoker
set search_path = pg_catalog, public
as $$
  select private.expire_job_leases()
$$;

revoke all on function public.rpc_transition_task(uuid, text, text, text, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.rpc_pair_worker(text, bytea, text, bytea, bytea, timestamptz) from public, anon, authenticated;
revoke all on function public.rpc_claim_job(uuid, bytea, integer) from public, anon, authenticated;
revoke all on function public.rpc_renew_job_lease(uuid, uuid, integer, bytea, integer) from public, anon, authenticated;
revoke all on function public.rpc_expire_job_leases() from public, anon, authenticated;
grant execute on function public.rpc_transition_task(uuid, text, text, text, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.rpc_pair_worker(text, bytea, text, bytea, bytea, timestamptz) to service_role;
grant execute on function public.rpc_claim_job(uuid, bytea, integer) to service_role;
grant execute on function public.rpc_renew_job_lease(uuid, uuid, integer, bytea, integer) to service_role;
grant execute on function public.rpc_expire_job_leases() to service_role;

-- Supabase Data API grants are intentionally explicit. Authenticated clients
-- receive read-only access; every mutation goes through server-side commands.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

grant select on public.profiles, public.profile_roles, public.customer_profiles, public.provider_profiles,
  public.provider_public_profiles, public.agents, public.agent_skills, public.agent_task_types, public.agent_endpoints,
  public.agent_mcp_servers, public.github_installations, public.github_repositories,
  public.worker_nodes, public.worker_capabilities, public.worker_mcp_servers,
  public.worker_heartbeats, public.tasks, public.task_requirements,
  public.task_acceptance_checks, public.task_opportunities, public.task_matches,
  public.task_assignments, public.task_worker_statuses, public.task_events, public.task_state_transitions,
  public.job_runs, public.job_run_events, public.evidence_artifacts,
  public.verification_runs, public.verification_results,
  public.verification_result_artifacts, public.reviews, public.disputes,
  public.test_wallets, public.test_ledger_transactions, public.test_ledger_entries
to authenticated;

grant select on public.provider_public_profiles, public.agents, public.agent_skills,
  public.agent_task_types, public.agent_mcp_servers, public.reviews
to anon;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'profile_roles', 'customer_profiles', 'provider_profiles', 'provider_public_profiles',
    'agents', 'agent_skills', 'agent_task_types', 'agent_endpoints', 'agent_mcp_servers',
    'github_installations', 'github_repositories', 'worker_nodes', 'worker_capabilities',
    'worker_mcp_servers', 'worker_heartbeats', 'worker_pairing_codes', 'worker_tokens',
    'tasks', 'task_requirements', 'task_acceptance_checks', 'task_opportunities',
    'task_matches', 'task_assignments', 'task_worker_statuses', 'task_events', 'task_state_transitions',
    'job_runs', 'worker_job_leases', 'job_run_events', 'evidence_artifacts',
    'verification_runs', 'verification_results', 'verification_result_artifacts',
    'reviews', 'disputes', 'test_wallets', 'test_ledger_transactions',
    'test_ledger_entries', 'webhook_receipts', 'audit_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end;
$$;

create policy profiles_self_or_admin_select
on public.profiles for select to authenticated
using (auth_user_id = (select auth.uid()) or (select private.is_admin()));

create policy profile_roles_self_or_admin_select
on public.profile_roles for select to authenticated
using (profile_id = (select private.current_profile_id()) or (select private.is_admin()));

create policy customer_profiles_self_or_admin_select
on public.customer_profiles for select to authenticated
using ((select private.owns_customer(id)) or (select private.is_admin()));

create policy provider_profiles_self_or_admin_select
on public.provider_profiles for select to authenticated
using ((select private.owns_provider(id)) or (select private.is_admin()));

create policy provider_public_profiles_catalog_select
on public.provider_public_profiles for select to anon, authenticated
using (listed);

create policy provider_public_profiles_owner_select
on public.provider_public_profiles for select to authenticated
using ((select private.owns_provider(provider_id)) or (select private.is_admin()));

create policy agents_catalog_select
on public.agents for select to anon, authenticated
using ((select private.can_view_agent(id)));

create policy agent_skills_catalog_select
on public.agent_skills for select to anon, authenticated
using ((select private.can_view_agent(agent_id)));

create policy agent_task_types_catalog_select
on public.agent_task_types for select to anon, authenticated
using ((select private.can_view_agent(agent_id)));

create policy agent_mcp_servers_catalog_select
on public.agent_mcp_servers for select to anon, authenticated
using ((select private.can_view_agent(agent_id)));

create policy agent_endpoints_owner_select
on public.agent_endpoints for select to authenticated
using ((select private.owns_agent(agent_id)) or (select private.is_admin()));

create policy github_installations_customer_select
on public.github_installations for select to authenticated
using ((select private.can_access_github_installation(id)));

create policy github_repositories_customer_select
on public.github_repositories for select to authenticated
using ((select private.can_access_github_installation(installation_id)));

create policy worker_nodes_owner_select
on public.worker_nodes for select to authenticated
using ((select private.owns_worker(id)) or (select private.is_admin()));

create policy worker_capabilities_owner_select
on public.worker_capabilities for select to authenticated
using ((select private.owns_worker(worker_id)) or (select private.is_admin()));

create policy worker_mcp_servers_owner_select
on public.worker_mcp_servers for select to authenticated
using ((select private.owns_worker(worker_id)) or (select private.is_admin()));

create policy worker_heartbeats_owner_select
on public.worker_heartbeats for select to authenticated
using ((select private.owns_worker(worker_id)) or (select private.is_admin()));

create policy worker_pairing_codes_admin_select
on public.worker_pairing_codes for select to authenticated
using ((select private.is_admin()));

create policy worker_tokens_admin_select
on public.worker_tokens for select to authenticated
using ((select private.is_admin()));

create policy tasks_participant_select
on public.tasks for select to authenticated
using ((select private.can_access_task(id)));

create policy task_requirements_participant_select
on public.task_requirements for select to authenticated
using ((select private.can_access_task(task_id)));

create policy task_acceptance_checks_participant_select
on public.task_acceptance_checks for select to authenticated
using ((select private.can_access_task(task_id)));

create policy task_opportunities_provider_select
on public.task_opportunities for select to authenticated
using (
  published and (
    (select private.is_verified_provider())
    or (select private.is_task_customer(task_id))
    or (select private.is_admin())
  )
);

create policy task_matches_involved_select
on public.task_matches for select to authenticated
using (
  (select private.is_task_customer(task_id))
  or (select private.owns_agent(agent_id))
  or (select private.is_admin())
);

create policy task_assignments_participant_select
on public.task_assignments for select to authenticated
using (
  (select private.is_task_customer(task_id))
  or (select private.owns_provider(provider_id))
  or (select private.is_admin())
);

create policy task_worker_statuses_participant_select
on public.task_worker_statuses for select to authenticated
using ((select private.can_access_task(task_id)));

create policy task_events_participant_select
on public.task_events for select to authenticated
using ((select private.can_access_task(task_id)));

create policy task_state_transitions_authenticated_select
on public.task_state_transitions for select to authenticated
using (true);

create policy job_runs_participant_select
on public.job_runs for select to authenticated
using ((select private.can_access_task(task_id)));

create policy worker_job_leases_admin_select
on public.worker_job_leases for select to authenticated
using ((select private.is_admin()));

create policy job_run_events_participant_select
on public.job_run_events for select to authenticated
using ((select private.can_access_job(job_run_id)));

create policy evidence_artifacts_participant_select
on public.evidence_artifacts for select to authenticated
using ((select private.can_access_task(task_id)));

create policy verification_runs_participant_select
on public.verification_runs for select to authenticated
using ((select private.can_access_task(task_id)));

create policy verification_results_participant_select
on public.verification_results for select to authenticated
using (
  exists (
    select 1
    from public.verification_runs run
    where run.id = verification_run_id
      and (select private.can_access_task(run.task_id))
  )
);

create policy verification_result_artifacts_participant_select
on public.verification_result_artifacts for select to authenticated
using ((select private.can_access_artifact(evidence_artifact_id)));

create policy reviews_published_select
on public.reviews for select to anon, authenticated
using (status = 'PUBLISHED');

create policy reviews_involved_select
on public.reviews for select to authenticated
using (
  (select private.owns_customer(customer_id))
  or (select private.owns_provider(provider_id))
  or (select private.is_admin())
);

create policy disputes_participant_select
on public.disputes for select to authenticated
using ((select private.can_access_task(task_id)));

create policy test_wallets_owner_select
on public.test_wallets for select to authenticated
using (owner_profile_id = (select private.current_profile_id()) or (select private.is_admin()));

create policy test_ledger_transactions_participant_select
on public.test_ledger_transactions for select to authenticated
using (
  (task_id is not null and (select private.can_access_task(task_id)))
  or created_by = (select private.current_profile_id())
  or (select private.is_admin())
);

create policy test_ledger_entries_wallet_owner_select
on public.test_ledger_entries for select to authenticated
using ((select private.can_access_wallet(wallet_id)));

create policy webhook_receipts_admin_select
on public.webhook_receipts for select to authenticated
using ((select private.is_admin()));

create policy audit_logs_admin_select
on public.audit_logs for select to authenticated
using ((select private.is_admin()));

-- Realtime is a delivery optimization. Sequence numbers remain the source of
-- truth when a subscription reconnects or falls back to polling.
do $$
declare
  realtime_table text;
begin
  if exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime' and not puballtables
  ) then
    foreach realtime_table in array array[
      'tasks', 'task_events', 'job_run_events', 'worker_nodes',
      'task_worker_statuses', 'verification_runs'
    ]
    loop
      if not exists (
        select 1
        from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = realtime_table
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          realtime_table
        );
      end if;
    end loop;
  elsif not exists (
    select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime'
  ) then
    raise warning 'supabase_realtime publication is absent; timeline will use polling until it is configured';
  end if;
end;
$$;

-- Private evidence bucket. Worker uploads use an exact-path signed upload token
-- issued by the trusted server; authenticated users receive no direct write policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  10485760,
  array[
    'text/plain', 'text/x-diff', 'application/json',
    'image/png', 'image/jpeg', 'image/webp'
  ]::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists evidence_objects_authorized_read on storage.objects;
create policy evidence_objects_authorized_read
on storage.objects for select to authenticated
using (
  bucket_id = 'evidence'
  and (select private.can_access_storage_object(name))
);
