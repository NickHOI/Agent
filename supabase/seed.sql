-- DoneLayer local/demo seed data.
-- This file intentionally does not insert into Supabase's managed auth schema.
-- Demo identities use the application DemoAuth adapter; a real Supabase user is
-- linked by setting profiles.auth_user_id from the trusted signup callback.
-- It is intended for a clean local `supabase db reset`. Stable ids make repeated
-- runs safe for this fixture; it is not a merge script for arbitrary production data.

begin;

insert into public.profiles (id, display_name, status, metadata) values
  ('00000000-0000-4000-8000-000000000001', 'Nick Demo', 'ACTIVE', '{"demoPersona":"customer"}'),
  ('00000000-0000-4000-8000-000000000010', 'Provider Alpha', 'ACTIVE', '{"demoPersona":"provider"}'),
  ('00000000-0000-4000-8000-000000000020', 'Provider Beta', 'ACTIVE', '{"demoPersona":"provider"}'),
  ('00000000-0000-4000-8000-000000000099', 'DoneLayer Admin', 'ACTIVE', '{"demoPersona":"admin"}')
on conflict (id) do update set
  display_name = excluded.display_name,
  metadata = excluded.metadata;

insert into public.profile_roles (id, profile_id, role) values
  ('01000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'CUSTOMER'),
  ('01000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000010', 'PROVIDER'),
  ('01000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000020', 'PROVIDER'),
  ('01000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000099', 'ADMIN')
on conflict (id) do nothing;

insert into public.customer_profiles (id, profile_id, default_currency, metadata) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'USD', '{"demo":true}')
on conflict (id) do update set metadata = excluded.metadata;

insert into public.provider_profiles (
  id, profile_id, company_name, bio, accepting_tasks, verification_status, metadata
) values
  (
    '20000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000010',
    'Alpha Project Systems',
    'Build rescue and launch-readiness specialists.',
    true,
    'VERIFIED',
    '{"demo":true}'
  ),
  (
    '20000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000020',
    'Beta Web Works',
    'Focused TypeScript and React completion agents.',
    true,
    'VERIFIED',
    '{"demo":true}'
  )
on conflict (id) do update set
  company_name = excluded.company_name,
  bio = excluded.bio,
  metadata = excluded.metadata;

insert into public.provider_public_profiles (
  id, provider_id, display_name, company_name, public_bio, listed
) values
  (
    '21000000-0000-4000-8000-000000000010',
    '20000000-0000-4000-8000-000000000010',
    'Provider Alpha', 'Alpha Project Systems',
    'Build rescue and launch-readiness specialists.', true
  ),
  (
    '21000000-0000-4000-8000-000000000020',
    '20000000-0000-4000-8000-000000000020',
    'Provider Beta', 'Beta Web Works',
    'Focused TypeScript and React completion agents.', true
  )
on conflict (id) do update set
  display_name = excluded.display_name,
  company_name = excluded.company_name,
  public_bio = excluded.public_bio;

insert into public.agents (
  id, provider_id, name, slug, description, version, supported_operating_systems,
  supported_tools, supported_languages, required_mcp_servers, pricing_model,
  base_price_cents, availability, accepts_tasks, endpoint_type, status,
  verification_status, average_completion_seconds, total_completed_tasks,
  verified_success_rate, customer_rating, recent_reliability, last_active_at
) values
  (
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000010',
    'Swift Build Rescue Agent',
    'swift-build-rescue-agent',
    'Diagnoses Xcode and Swift build failures and produces verifiable fixes.',
    '1.2.0',
    array['macOS'],
    array['git', 'xcodebuild', 'swift', 'codex'],
    array['Swift'],
    array[]::text[],
    'FIXED', 18000, 'AVAILABLE', true, 'DEMO', 'ACTIVE', 'VERIFIED',
    4200, 74, 0.9100, 4.82, 0.9500, now() - interval '3 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000020',
    'React Bug Fix Agent',
    'react-bug-fix-agent',
    'Repairs scoped React and TypeScript defects with test evidence.',
    '1.4.1',
    array['Windows', 'Linux'],
    array['git', 'node', 'npm', 'vitest', 'playwright', 'codex'],
    array['TypeScript', 'JavaScript', 'React'],
    array[]::text[],
    'FIXED', 14000, 'AVAILABLE', true, 'DEMO', 'ACTIVE', 'VERIFIED',
    2700, 123, 0.9300, 4.88, 0.9700, now() - interval '1 minute'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000010',
    'Repository QA Agent',
    'repository-qa-agent',
    'Runs repeatable repository diagnosis, tests, lint and dependency checks.',
    '1.1.0',
    array['Linux', 'macOS'],
    array['git', 'node', 'npm', 'docker', 'codex'],
    array['TypeScript', 'JavaScript', 'Python'],
    array[]::text[],
    'PER_RUN', 9000, 'AVAILABLE', true, 'DEMO', 'ACTIVE', 'VERIFIED',
    1800, 206, 0.8900, 4.71, 0.9200, now() - interval '8 minutes'
  ),
  (
    '30000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000010',
    'App Launch Readiness Agent',
    'app-launch-readiness-agent',
    'Produces a proof-backed build, test, lint and security readiness report.',
    '1.0.3',
    array['Linux', 'macOS'],
    array['git', 'node', 'npm', 'docker', 'codex'],
    array['TypeScript', 'JavaScript', 'Swift'],
    array['github'],
    'FIXED', 22000, 'AVAILABLE', true, 'DEMO', 'ACTIVE', 'VERIFIED',
    5400, 61, 0.9500, 4.93, 0.9800, now() - interval '5 minutes'
  )
on conflict (id) do update set
  description = excluded.description,
  supported_operating_systems = excluded.supported_operating_systems,
  supported_tools = excluded.supported_tools,
  supported_languages = excluded.supported_languages,
  base_price_cents = excluded.base_price_cents,
  last_active_at = excluded.last_active_at;

insert into public.agent_skills (id, agent_id, skill, proficiency) values
  ('31000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Swift', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'Xcode', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'React', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', 'TypeScript', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000003', 'Repository diagnosis', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000003', 'Testing', 'ADVANCED'),
  ('31000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000004', 'Launch readiness', 'EXPERT'),
  ('31000000-0000-4000-8000-000000000008', '30000000-0000-4000-8000-000000000004', 'Security checks', 'ADVANCED')
on conflict (id) do nothing;

insert into public.agent_task_types (id, agent_id, task_type) values
  ('32000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'BUILD_RESCUE'),
  ('32000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'TEST_AND_FIX'),
  ('32000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'TEST_AND_FIX'),
  ('32000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000002', 'FEATURE_COMPLETION'),
  ('32000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000003', 'DIAGNOSE_REPOSITORY'),
  ('32000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000003', 'PULL_REQUEST_VERIFICATION'),
  ('32000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000004', 'LAUNCH_READINESS')
on conflict (id) do nothing;

insert into public.agent_endpoints (id, agent_id, endpoint_type, authentication_type, status) values
  ('33000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'DEMO', 'NONE', 'ACTIVE'),
  ('33000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'DEMO', 'NONE', 'ACTIVE'),
  ('33000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'DEMO', 'NONE', 'ACTIVE'),
  ('33000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', 'DEMO', 'NONE', 'ACTIVE')
on conflict (id) do nothing;

insert into public.agent_mcp_servers (
  id, agent_id, server_name, transport_type, tools, resources, prompts,
  authentication_required, required
) values (
  '34000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000004',
  'github',
  'STDIO',
  '["get_pull_request","get_check_runs"]',
  '["repository"]',
  '[]',
  true,
  true
)
on conflict (id) do update set tools = excluded.tools, resources = excluded.resources;

insert into public.worker_nodes (
  id, provider_id, name, status, accepting_jobs, paired_at, last_heartbeat_at,
  worker_version, max_concurrent_jobs, active_job_count
) values
  (
    '40000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000010',
    'macOS Worker Online', 'ONLINE', true, now() - interval '2 days', now(), '0.1.0', 2, 0
  ),
  (
    '40000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000020',
    'Windows Worker Online', 'ONLINE', true, now() - interval '1 day', now(), '0.1.0', 2, 0
  ),
  (
    '40000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000010',
    'Linux Worker Offline', 'OFFLINE', false, now() - interval '4 days', now() - interval '1 day', '0.1.0', 1, 0
  )
on conflict (id) do update set
  name = excluded.name,
  worker_version = excluded.worker_version;

insert into public.worker_capabilities (
  id, worker_id, operating_system, architecture, cpu_count, memory_bytes,
  free_disk_bytes, docker_available, codex_available, git_available,
  github_cli_available, supported_languages, installed_tools,
  available_executors, max_concurrent_jobs, reported_at
) values
  (
    '41000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
    'macOS', 'arm64', 10, 34359738368, 214748364800, true, true, true, true,
    array['Swift', 'TypeScript', 'JavaScript'],
    array['git', 'xcodebuild', 'swift', 'node', 'npm', 'codex', 'gh', 'docker'],
    array['DEMO', 'CODEX_CLI'], 2, now()
  ),
  (
    '41000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002',
    'Windows', 'x64', 12, 34359738368, 161061273600, true, true, true, true,
    array['TypeScript', 'JavaScript', 'React'],
    array['git', 'node', 'npm', 'vitest', 'playwright', 'codex', 'gh', 'docker'],
    array['DEMO', 'CODEX_CLI'], 2, now()
  ),
  (
    '41000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000003',
    'Linux', 'x64', 8, 17179869184, 85899345920, true, false, true, false,
    array['TypeScript', 'JavaScript', 'Python'],
    array['git', 'node', 'npm', 'python', 'docker'],
    array['DEMO'], 1, now() - interval '1 day'
  )
on conflict (id) do nothing;

insert into public.worker_mcp_servers (
  id, worker_id, server_name, transport_type, tools, resources,
  prompts, installed, authentication_configured
) values (
  '42000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'github', 'STDIO', '["get_pull_request","get_check_runs"]', '["repository"]',
  '[]', true, true
)
on conflict (id) do nothing;

insert into public.worker_heartbeats (
  id, worker_id, reported_status, worker_version, active_job_count, metrics, received_at
) values
  (
    '43000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001', 'ONLINE', '0.1.0', 0,
    '{"freeDiskBytes":214748364800}', now()
  ),
  (
    '43000000-0000-4000-8000-000000000002',
    '40000000-0000-4000-8000-000000000002', 'ONLINE', '0.1.0', 0,
    '{"freeDiskBytes":161061273600}', now()
  )
on conflict (id) do nothing;

insert into public.tasks (
  id, customer_id, repository_mode, repository_label, target_branch, title,
  problem_description, desired_outcome, category, budget_cents, deadline_at,
  security_sensitivity, allow_code_changes, allow_pull_request,
  requires_human_approval, status, risk_level
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'DEMO', 'done-layer/demo-auth-sample', 'main',
  'Fix failing authentication tests in a sample repository',
  'The authentication suite fails after a session refresh and blocks the build.',
  'All authentication tests pass, the project builds, and the patch contains a scoped fix.',
  'TEST_AND_FIX', 18000, now() + interval '3 days', 'STANDARD',
  true, true, true, 'DRAFT', 'MEDIUM'
)
on conflict (id) do nothing;

insert into public.task_requirements (
  id, task_id, requirement_type, requirement_key, requirement_value, required
) values
  (
    '51000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'SKILL', 'TypeScript', '{"minimumProficiency":"ADVANCED"}', true
  ),
  (
    '51000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    'TOOL', 'vitest', '{}', true
  )
on conflict (id) do nothing;

insert into public.task_acceptance_checks (
  id, task_id, check_type, name, config, required, sort_order
) values
  (
    '52000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    'TEST', 'Authentication tests pass',
    '{"workflowTemplateKey":"test_and_fix_node","minimumTests":12,"maximumFailures":0}', true, 1
  ),
  (
    '52000000-0000-4000-8000-000000000002',
    '50000000-0000-4000-8000-000000000001',
    'BUILD', 'Application builds',
    '{"workflowTemplateKey":"build_node","expectedExitCode":0}', true, 2
  ),
  (
    '52000000-0000-4000-8000-000000000003',
    '50000000-0000-4000-8000-000000000001',
    'DIFF', 'A scoped code change exists',
    '{"minimumChangedFiles":1,"maximumChangedFiles":12}', true, 3
  )
on conflict (id) do nothing;

insert into public.task_events (
  id, task_id, sequence, event_type, actor_type, actor_profile_id, reason, payload
) values (
  '53000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  1, 'TASK_CREATED', 'CUSTOMER', '00000000-0000-4000-8000-000000000001',
  'Demo task created', '{"source":"seed"}'
)
on conflict (id) do nothing;

insert into public.test_wallets (
  id, owner_profile_id, system_key, account_type, currency, balance_cents, metadata
) values
  (
    '60000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001', null,
    'CUSTOMER_AVAILABLE', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000010', null,
    'PROVIDER_AVAILABLE', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000010', null,
    'PROVIDER_PENDING', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000020',
    '00000000-0000-4000-8000-000000000020', null,
    'PROVIDER_AVAILABLE', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000020', null,
    'PROVIDER_PENDING', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000100', null, 'escrow',
    'ESCROW', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000101', null, 'platform',
    'PLATFORM_REVENUE', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000102', null, 'dispute-hold',
    'DISPUTE_HOLD', 'USD', 0, '{"genesis":true}'
  ),
  (
    '60000000-0000-4000-8000-000000000103', null, 'demo-faucet',
    'TEST_FAUCET', 'USD', 0, '{"genesis":true}'
  )
on conflict (id) do update set metadata = excluded.metadata;

insert into public.test_ledger_transactions (
  id, operation, idempotency_key, description, created_by, metadata
) values (
  '61000000-0000-4000-8000-000000000001',
  'GENESIS', 'genesis:nick-demo:usd:v1', 'Fund Nick Demo test wallet',
  '00000000-0000-4000-8000-000000000099', '{"fixture":true}'
)
on conflict (id) do nothing;

insert into public.test_ledger_entries (
  id, transaction_id, wallet_id, amount_cents
) values
  (
    '62000000-0000-4000-8000-000000000001',
    '61000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001', 100000
  ),
  (
    '62000000-0000-4000-8000-000000000002',
    '61000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000103', -100000
  )
on conflict (id) do nothing;

commit;
