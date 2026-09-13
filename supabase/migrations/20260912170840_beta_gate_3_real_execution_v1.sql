-- Beta Gate 3 - one real, bounded, service-orchestrated verified Work lifecycle.
-- This migration does not create a Job by itself. The two mutation commands are
-- executable only by service_role and bind every write to an existing owner,
-- locked V2 Contract, approved Workspace Authority decision, and exact Source.

alter table public.job_runs drop constraint job_runs_executor_type_check;
alter table public.job_runs add constraint job_runs_executor_type_check
  check (executor_type in ('DEMO', 'CODEX_CLI', 'WEBHOOK', 'AI_GATEWAY'));

create or replace function public.rpc_prepare_beta_gate_3_job(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<prepare_gate>>
declare
  owner_auth_user_id uuid;
  owner_profile_id uuid;
  task_id uuid;
  contract_id uuid;
  authority_id uuid;
  job_run_id uuid;
  worker_id uuid;
  worker_lease_id uuid;
  permission_lease_id uuid;
  source_commit text;
  target_task public.tasks%rowtype;
  target_contract public.task_contract_versions%rowtype;
  target_authority public.workspace_authority_reviews%rowtype;
  target_assignment public.task_assignments%rowtype;
  target_identity public.agent_identity_profiles%rowtype;
  permission_scope jsonb;
  started_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'BETA_GATE_3_REQUEST_INVALID' using errcode = '22023';
  end if;

  begin
    owner_auth_user_id := (p_request ->> 'ownerAuthUserId')::uuid;
    task_id := (p_request ->> 'taskId')::uuid;
    contract_id := (p_request ->> 'contractId')::uuid;
    authority_id := (p_request ->> 'authorityId')::uuid;
    job_run_id := (p_request ->> 'jobRunId')::uuid;
    worker_id := (p_request ->> 'workerId')::uuid;
    worker_lease_id := (p_request ->> 'workerLeaseId')::uuid;
    permission_lease_id := (p_request ->> 'permissionLeaseId')::uuid;
  exception when invalid_text_representation then
    raise exception 'BETA_GATE_3_REQUEST_INVALID' using errcode = '22023';
  end;
  source_commit := lower(coalesce(p_request ->> 'sourceCommit', ''));

  select task.* into target_task
  from public.tasks task
  where task.id = prepare_gate.task_id
  for update;
  if target_task.id is null then
    raise exception 'BETA_GATE_3_WORK_NOT_FOUND' using errcode = 'P0002';
  end if;

  select profile.id into owner_profile_id
  from public.profiles profile
  join public.customer_profiles customer on customer.profile_id = profile.id
  where profile.auth_user_id = owner_auth_user_id
    and customer.id = target_task.customer_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null;
  if owner_profile_id is null then
    raise exception 'BETA_GATE_3_OWNER_MISMATCH' using errcode = '42501';
  end if;

  select contract.* into target_contract
  from public.task_contract_versions contract
  where contract.id = prepare_gate.contract_id
    and contract.task_id = prepare_gate.task_id
    and contract.status = 'LOCKED'
  for update;
  if target_contract.id is null
    or target_contract.version <> 2
    or target_contract.contract_sha256 <> p_request ->> 'contractSha256'
  then
    raise exception 'BETA_GATE_3_CONTRACT_MISMATCH' using errcode = 'P0001';
  end if;

  select review.* into target_authority
  from public.workspace_authority_reviews review
  where review.id = prepare_gate.authority_id
    and review.task_id = prepare_gate.task_id
    and review.task_contract_version_id = prepare_gate.contract_id
    and review.decision = 'APPROVED'
  for update;
  if target_authority.id is null
    or target_authority.scope_sha256 <> p_request ->> 'authorityScopeSha256'
  then
    raise exception 'BETA_GATE_3_AUTHORITY_MISMATCH' using errcode = 'P0001';
  end if;

  select assignment.* into target_assignment
  from public.task_assignments assignment
  where assignment.task_id = prepare_gate.task_id
  order by assignment.created_at desc, assignment.id desc
  limit 1
  for update;
  if target_assignment.id is null
    or target_assignment.agent_id::text <> target_contract.contract_json -> 'assignedAgent' ->> 'agentId'
  then
    raise exception 'BETA_GATE_3_ASSIGNMENT_MISMATCH' using errcode = '23514';
  end if;

  select identity.* into target_identity
  from public.agent_identity_profiles identity
  where identity.agent_id = target_assignment.agent_id
  order by identity.revision desc
  limit 1;
  if target_identity.agent_id is null
    or target_identity.profile_document ->> 'status' <> 'ACTIVE'
    or target_identity.profile_sha256 <> target_contract.contract_json -> 'assignedAgent' ->> 'profileSha256'
    or target_identity.revision <> (target_contract.contract_json -> 'assignedAgent' ->> 'profileRevision')::integer
  then
    raise exception 'BETA_GATE_3_AGENT_IDENTITY_MISMATCH' using errcode = '23514';
  end if;

  if target_task.status <> 'PUBLISHED'
    or target_task.category <> 'FEATURE_COMPLETION'
    or target_task.repository_mode <> 'REFERENCE'
    or target_task.repository_label <> 'https://github.com/NickHOI/Agent.git'
    or target_task.target_branch <> 'main'
    or target_contract.contract_json ->> 'contractType' <> 'VERIFIED_WORK_CONTRACT_V2'
    or target_contract.contract_json ->> 'allowedWorkflow' <> 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION'
    or target_contract.contract_json -> 'sourceReference' ->> 'repository' <> target_task.repository_label
    or target_contract.contract_json -> 'sourceReference' ->> 'branch' <> 'main'
    or target_contract.contract_json -> 'sourceReference' ->> 'commitResolution' <> 'REQUIRED_BEFORE_PERMISSION_LEASE'
    or target_contract.contract_json -> 'authorityPolicy' ->> 'networkPolicy' <> 'deny-all'
    or target_contract.contract_json -> 'authorityPolicy' ->> 'persistence' <> 'none'
    or target_contract.contract_json -> 'deliveryOutcomePolicy' ->> 'policy' <> 'EXECUTION_AND_INDEPENDENT_ACCEPTANCE_REQUIRED'
    or target_contract.contract_json -> 'authorityPolicy' -> 'allowedPaths' <> '["apps/web/src/lib/format.ts"]'::jsonb
    or target_authority.scope_json -> 'allowedFiles' <> '["apps/web/src/lib/format.ts"]'::jsonb
    or target_authority.scope_json ->> 'networkPolicy' <> 'deny-all'
    or target_authority.scope_json ->> 'persistence' <> 'none'
    or source_commit !~ '^[a-f0-9]{40}$'
  then
    raise exception 'BETA_GATE_3_BOUNDARY_MISMATCH' using errcode = '23514';
  end if;
  if exists (select 1 from public.job_runs run where run.task_id = prepare_gate.task_id) then
    raise exception 'BETA_GATE_3_JOB_ALREADY_EXISTS' using errcode = 'P0001';
  end if;

  permission_scope := jsonb_build_object(
    'allowedActions', target_authority.scope_json -> 'allowedActions',
    'deniedActions', target_authority.scope_json -> 'deniedActions',
    'allowedPaths', jsonb_build_array('$JOB_WORKSPACE'),
    'allowedDomains', '[]'::jsonb,
    'allowedRepositories', jsonb_build_array(target_task.repository_label),
    'allowedBranches', jsonb_build_array(target_task.target_branch),
    'allowedCommitShas', jsonb_build_array(source_commit),
    'allowedSandboxProviders', jsonb_build_array('VERCEL_SANDBOX'),
    'allowedExecutionBackends', jsonb_build_array('MANAGED_REMOTE_SANDBOX'),
    'allowedWorkflows', jsonb_build_array('BETA_GATE_3_MANAGED_REMOTE_EXECUTION'),
    'allowedFiles', jsonb_build_array('apps/web/src/lib/format.ts'),
    'allowedEnvironmentVariables', '[]'::jsonb,
    'maxArtifactBytes', 2097152,
    'maxRuntimeSeconds', 600,
    'maxApiBudget', 0,
    'maxSandboxes', 2,
    'maxCommands', 10,
    'maxStdoutBytes', 262144,
    'maxStderrBytes', 262144,
    'networkPolicy', 'deny-all',
    'persistence', 'none',
    'humanApprovalActions', '[]'::jsonb
  );

  insert into public.worker_nodes (
    id, provider_id, name, status, accepting_jobs, paired_at, last_heartbeat_at,
    worker_version, max_concurrent_jobs, active_job_count, metadata
  ) values (
    worker_id, target_assignment.provider_id, 'DoneLayer Gate 3 server orchestrator',
    'BUSY', false, started_at, started_at, 'beta-gate-3-v1', 1, 1,
    jsonb_build_object(
      'role', 'SERVER_SIDE_ORCHESTRATOR',
      'executionBackend', 'MANAGED_REMOTE_SANDBOX',
      'sandboxProvider', 'VERCEL_SANDBOX'
    )
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
  set worker_id = prepare_gate.worker_id,
      status = 'RUNNING',
      accepted_at = coalesce(accepted_at, started_at),
      updated_at = started_at
  where id = target_assignment.id;

  insert into public.job_runs (
    id, task_id, assignment_id, agent_id, worker_id, attempt_no, executor_type,
    workflow_template_key, status, timeout_seconds, max_log_bytes,
    max_artifact_bytes, allowed_network_domains, started_at,
    absolute_deadline_at, commit_sha_before, result, task_contract_version_id,
    created_at, updated_at
  ) values (
    job_run_id, task_id, target_assignment.id, target_assignment.agent_id,
    worker_id, 1, 'AI_GATEWAY', 'BETA_GATE_3_MANAGED_REMOTE_EXECUTION',
    'RUNNING', 600, 262144, 2097152, '{}'::text[], started_at,
    started_at + interval '10 minutes', source_commit,
    jsonb_build_object('executionOutcome', 'INCONCLUSIVE', 'deliveryOutcome', 'BLOCKED'),
    contract_id, started_at, started_at
  );

  insert into public.worker_job_leases (
    id, job_run_id, worker_id, lease_generation, lease_token_digest, status,
    claimed_at, renewed_at, expires_at, created_at, updated_at
  ) values (
    worker_lease_id, job_run_id, worker_id, 1,
    extensions.digest(convert_to(job_run_id::text || ':' || worker_lease_id::text, 'UTF8'), 'sha256'),
    'ACTIVE', started_at, started_at, started_at + interval '10 minutes', started_at, started_at
  );

  insert into public.permission_leases (
    id, task_id, task_contract_version_id, job_run_id, agent_id, worker_id,
    version, status, scope_json, starts_at, expires_at, created_at, created_by
  ) values (
    permission_lease_id, task_id, contract_id, job_run_id,
    target_assignment.agent_id, worker_id, 1, 'ACTIVE', permission_scope,
    started_at, started_at + interval '10 minutes', started_at, 'DONE_LAYER_SERVER'
  );

  perform private.transition_task(task_id, 'PUBLISHED', 'ANALYZING', 'SYSTEM', null, null,
    'BETA_GATE_3_ANALYSIS_STARTED', 'Service-orchestrated Gate 3 analysis started.', '{}'::jsonb);
  perform private.transition_task(task_id, 'ANALYZING', 'MATCHING', 'SYSTEM', null, null,
    'BETA_GATE_3_MATCHING_STARTED', 'Locked Agent assignment is being validated.', '{}'::jsonb);
  perform private.transition_task(task_id, 'MATCHING', 'MATCHED', 'SYSTEM', null, null,
    'BETA_GATE_3_AGENT_MATCHED', 'The locked Contract Agent matched.', '{}'::jsonb);
  perform private.transition_task(task_id, 'MATCHED', 'AWAITING_PROVIDER', 'SYSTEM', null, null,
    'BETA_GATE_3_PROVIDER_AWAITED', 'The server orchestrator provider was selected.', '{}'::jsonb);
  perform private.transition_task(task_id, 'AWAITING_PROVIDER', 'ASSIGNED', 'SYSTEM', null, null,
    'BETA_GATE_3_ASSIGNED', 'The bounded server orchestrator assignment was accepted.', '{}'::jsonb);
  perform private.transition_task(task_id, 'ASSIGNED', 'RUNNING', 'SYSTEM', null, null,
    'BETA_GATE_3_EXECUTION_STARTED', 'The bounded Gate 3 Job and Permission Lease are active.',
    jsonb_build_object('jobRunId', job_run_id, 'permissionLeaseId', permission_lease_id, 'sourceCommit', source_commit));

  return jsonb_build_object(
    'prepared', true,
    'startedAt', started_at,
    'taskId', task_id,
    'assignmentId', target_assignment.id,
    'agentId', target_assignment.agent_id,
    'workerId', worker_id,
    'jobRunId', job_run_id,
    'workerLeaseId', worker_lease_id,
    'permissionLeaseId', permission_lease_id,
    'contractId', contract_id,
    'contractVersion', target_contract.version,
    'contractSha256', target_contract.contract_sha256,
    'contract', target_contract.contract_json,
    'authorityId', authority_id,
    'authorityScopeSha256', target_authority.scope_sha256,
    'authorityScope', target_authority.scope_json,
    'permissionScope', permission_scope,
    'agentIdentity', target_identity.profile_document,
    'sourceCommit', source_commit
  );
end;
$$;

create or replace function public.rpc_finalize_beta_gate_3_job(p_result jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<finalize_gate>>
declare
  owner_auth_user_id uuid;
  owner_profile_id uuid;
  task_id uuid;
  job_run_id uuid;
  worker_id uuid;
  worker_lease_id uuid;
  permission_lease_id uuid;
  verification_run_id uuid;
  receipt_id uuid;
  receipt_public_id text;
  receipt_sha256 text;
  evidence_chain_sha256 text;
  receipt_document jsonb;
  job_result jsonb;
  target_job public.job_runs%rowtype;
  target_permission public.permission_leases%rowtype;
  item jsonb;
  previous_hash text := null;
  current_hash text;
  expected_sequence integer := 1;
  required_checks integer;
  finished_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_result) is distinct from 'object'
    or jsonb_typeof(p_result -> 'artifacts') is distinct from 'array'
    or jsonb_typeof(p_result -> 'ledgerEntries') is distinct from 'array'
    or jsonb_typeof(p_result -> 'verification' -> 'checks') is distinct from 'array'
    or jsonb_typeof(p_result -> 'receipt' -> 'document') is distinct from 'object'
  then
    raise exception 'BETA_GATE_3_RESULT_INVALID' using errcode = '22023';
  end if;
  begin
    owner_auth_user_id := (p_result ->> 'ownerAuthUserId')::uuid;
    task_id := (p_result ->> 'taskId')::uuid;
    job_run_id := (p_result ->> 'jobRunId')::uuid;
    worker_id := (p_result ->> 'workerId')::uuid;
    worker_lease_id := (p_result ->> 'workerLeaseId')::uuid;
    permission_lease_id := (p_result ->> 'permissionLeaseId')::uuid;
    verification_run_id := (p_result -> 'verification' ->> 'id')::uuid;
    receipt_id := (p_result -> 'receipt' ->> 'id')::uuid;
  exception when invalid_text_representation then
    raise exception 'BETA_GATE_3_RESULT_INVALID' using errcode = '22023';
  end;
  receipt_public_id := p_result -> 'receipt' ->> 'publicId';
  receipt_sha256 := p_result -> 'receipt' ->> 'sha256';
  evidence_chain_sha256 := p_result -> 'receipt' ->> 'evidenceChainSha256';
  receipt_document := p_result -> 'receipt' -> 'document';
  job_result := p_result -> 'jobResult';

  select run.* into target_job
  from public.job_runs run
  where run.id = finalize_gate.job_run_id
    and run.task_id = finalize_gate.task_id
    and run.worker_id = finalize_gate.worker_id
  for update;
  if target_job.id is null or target_job.status <> 'RUNNING' then
    raise exception 'BETA_GATE_3_JOB_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  select lease.* into target_permission
  from public.permission_leases lease
  where lease.id = finalize_gate.permission_lease_id
    and lease.job_run_id = finalize_gate.job_run_id
    and lease.task_id = finalize_gate.task_id
    and lease.worker_id = finalize_gate.worker_id
  for update;
  if target_permission.id is null
    or target_permission.status <> 'ACTIVE'
    or target_permission.expires_at <= finished_at
  then
    raise exception 'BETA_GATE_3_PERMISSION_NOT_ACTIVE' using errcode = '42501';
  end if;

  select profile.id into owner_profile_id
  from public.tasks task
  join public.customer_profiles customer on customer.id = task.customer_id
  join public.profiles profile on profile.id = customer.profile_id
  where task.id = finalize_gate.task_id
    and profile.auth_user_id = finalize_gate.owner_auth_user_id
    and profile.status = 'ACTIVE'
    and profile.deleted_at is null;
  if owner_profile_id is null then
    raise exception 'BETA_GATE_3_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if receipt_document ->> 'receiptType' <> 'VERIFIED_WORK_RECEIPT_V2'
    or receipt_document ->> 'finalResult' <> 'VERIFIED_DELIVERY'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'executionOutcome' <> 'COMPLETED'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'independentVerificationOutcome' <> 'VERIFIED'
    or receipt_document -> 'verifiedDeliveryOutcomes' ->> 'deliveryOutcome' <> 'VERIFIED_DELIVERY'
    or receipt_sha256 !~ '^[a-f0-9]{64}$'
    or evidence_chain_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(coalesce(receipt_public_id, '')) not between 20 and 120
    or job_result ->> 'executionOutcome' <> 'COMPLETED'
    or job_result ->> 'independentVerificationOutcome' <> 'VERIFIED'
    or job_result ->> 'deliveryOutcome' <> 'VERIFIED_DELIVERY'
  then
    raise exception 'BETA_GATE_3_VERIFIED_OUTCOME_INVALID' using errcode = '23514';
  end if;

  required_checks := (select count(*) from public.task_acceptance_checks check_row
    where check_row.task_id = finalize_gate.task_id and check_row.required);
  if required_checks < 1
    or jsonb_array_length(p_result -> 'verification' -> 'checks') <> required_checks
    or exists (
      select 1
      from public.task_acceptance_checks check_row
      where check_row.task_id = finalize_gate.task_id and check_row.required
        and not exists (
          select 1 from jsonb_array_elements(p_result -> 'verification' -> 'checks') supplied
          where supplied ->> 'acceptanceCheckId' = check_row.id::text
            and supplied ->> 'status' = 'PASSED'
        )
    )
  then
    raise exception 'BETA_GATE_3_ACCEPTANCE_NOT_VERIFIED' using errcode = '23514';
  end if;

  for item in select value from jsonb_array_elements(p_result -> 'ledgerEntries')
  loop
    if (item ->> 'sequenceNumber')::integer <> expected_sequence
      or nullif(item ->> 'previousEntrySha256', '') is distinct from previous_hash
      or item ->> 'entrySha256' !~ '^[a-f0-9]{64}$'
      or item ->> 'payloadSha256' !~ '^[a-f0-9]{64}$'
    then
      raise exception 'BETA_GATE_3_LEDGER_INVALID' using errcode = '23514';
    end if;
    current_hash := item ->> 'entrySha256';
    previous_hash := current_hash;
    expected_sequence := expected_sequence + 1;
  end loop;
  if expected_sequence < 3 then
    raise exception 'BETA_GATE_3_LEDGER_INCOMPLETE' using errcode = '23514';
  end if;
  item := (p_result -> 'ledgerEntries') -> (jsonb_array_length(p_result -> 'ledgerEntries') - 1);
  if item ->> 'entryType' <> 'RECEIPT_CREATED'
    or item ->> 'sourceRecordType' <> 'job_receipt'
    or item ->> 'sourceRecordId' <> receipt_id::text
    or item ->> 'payloadSha256' <> receipt_sha256
    or item ->> 'previousEntrySha256' <> evidence_chain_sha256
  then
    raise exception 'BETA_GATE_3_RECEIPT_ANCHOR_INVALID' using errcode = '23514';
  end if;

  update public.job_runs
  set status = 'SUCCEEDED', finished_at = finalize_gate.finished_at, exit_code = 0,
      commit_sha_after = commit_sha_before,
      changed_files = p_result -> 'changedFiles', result = job_result,
      failure_code = null, updated_at = finalize_gate.finished_at
  where id = finalize_gate.job_run_id;

  perform private.transition_task(task_id, 'RUNNING', 'SUBMITTED', 'SYSTEM', null, null,
    'BETA_GATE_3_DELIVERABLE_SUBMITTED', 'The bounded Agent submitted an authorized patch.',
    jsonb_build_object('jobRunId', job_run_id, 'patchSha256', p_result ->> 'patchSha256'));
  perform private.transition_task(task_id, 'SUBMITTED', 'VERIFYING', 'VERIFIER', null, null,
    'BETA_GATE_3_INDEPENDENT_VERIFICATION_STARTED', 'A fresh isolated verifier evaluated the delivery.',
    jsonb_build_object('verificationRunId', verification_run_id));

  for item in select value from jsonb_array_elements(p_result -> 'artifacts')
  loop
    if item ->> 'sha256' !~ '^[a-f0-9]{64}$'
      or (item ->> 'sizeBytes')::bigint < 0
      or char_length(coalesce(item ->> 'fileName', '')) not between 1 and 240
    then
      raise exception 'BETA_GATE_3_ARTIFACT_INVALID' using errcode = '23514';
    end if;
    insert into public.evidence_artifacts (
      id, task_id, worker_id, job_run_id, artifact_type, file_name, mime_type,
      size_bytes, sha256, storage_path, upload_status, verified_at, metadata,
      created_at, updated_at
    ) values (
      (item ->> 'id')::uuid, task_id, worker_id, job_run_id,
      item ->> 'artifactType', item ->> 'fileName', item ->> 'mimeType',
      (item ->> 'sizeBytes')::bigint, decode(item ->> 'sha256', 'hex'),
      item ->> 'storagePath', 'VERIFIED', finished_at,
      coalesce(item -> 'metadata', '{}'::jsonb), finished_at, finished_at
    );
  end loop;

  insert into public.verification_runs (
    id, task_id, job_run_id, verifier_version, status, required_check_count,
    passed_check_count, failed_check_count, started_at, finished_at, summary,
    metadata, created_at, updated_at
  ) values (
    verification_run_id, task_id, job_run_id,
    p_result -> 'verification' ->> 'verifierVersion', 'PASSED', required_checks,
    required_checks, 0,
    (p_result -> 'verification' ->> 'startedAt')::timestamptz,
    (p_result -> 'verification' ->> 'finishedAt')::timestamptz,
    p_result -> 'verification' ->> 'summary',
    coalesce(p_result -> 'verification' -> 'metadata', '{}'::jsonb),
    finished_at, finished_at
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
      finished_at, finished_at
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
    receipt_id, receipt_public_id, task_id, job_run_id,
    target_job.task_contract_version_id, permission_lease_id,
    'VERIFIED_DELIVERY', receipt_document, receipt_sha256,
    evidence_chain_sha256, finished_at
  );

  update public.permission_leases
  set status = 'COMPLETED'
  where id = finalize_gate.permission_lease_id;
  update public.worker_job_leases as lease
  set status = 'RELEASED', released_at = finalize_gate.finished_at, updated_at = finalize_gate.finished_at
  where lease.id = finalize_gate.worker_lease_id
    and lease.job_run_id = finalize_gate.job_run_id
    and lease.worker_id = finalize_gate.worker_id
    and lease.status = 'ACTIVE';
  update public.worker_nodes
  set status = 'OFFLINE', active_job_count = 0, last_heartbeat_at = finished_at, updated_at = finished_at
  where id = finalize_gate.worker_id;
  update public.task_assignments
  set status = 'COMPLETED', updated_at = finished_at
  where id = target_job.assignment_id;

  perform private.transition_task(task_id, 'VERIFYING', 'VERIFICATION_PASSED', 'VERIFIER', null, null,
    'BETA_GATE_3_VERIFICATION_PASSED', 'All locked acceptance checks passed in a fresh verifier Sandbox.',
    jsonb_build_object('verificationRunId', verification_run_id));
  perform private.transition_task(task_id, 'VERIFICATION_PASSED', 'CUSTOMER_REVIEW', 'SYSTEM', null, null,
    'BETA_GATE_3_CUSTOMER_REVIEW', 'Verified delivery and its Receipt are ready for owner acceptance.',
    jsonb_build_object('receiptId', receipt_id));
  perform private.transition_task(task_id, 'CUSTOMER_REVIEW', 'COMPLETED', 'CUSTOMER', owner_profile_id, null,
    'BETA_GATE_3_OWNER_ACCEPTED', 'The authenticated Work owner accepted the independently verified delivery.',
    jsonb_build_object('receiptId', receipt_id, 'deliveryOutcome', 'VERIFIED_DELIVERY'));

  return jsonb_build_object(
    'finalized', true,
    'taskId', task_id,
    'jobRunId', job_run_id,
    'permissionLeaseId', permission_lease_id,
    'verificationRunId', verification_run_id,
    'receiptId', receipt_id,
    'receiptPublicId', receipt_public_id,
    'receiptSha256', receipt_sha256,
    'evidenceChainSha256', evidence_chain_sha256,
    'finalStatus', 'COMPLETED',
    'deliveryOutcome', 'VERIFIED_DELIVERY',
    'finishedAt', finished_at
  );
end;
$$;

create or replace function public.rpc_fail_beta_gate_3_job(p_failure jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
<<fail_gate>>
declare
  target_job public.job_runs%rowtype;
  failed_at timestamptz := clock_timestamp();
  failure_code text := upper(coalesce(p_failure ->> 'failureCode', 'BETA_GATE_3_FAILED'));
begin
  if failure_code !~ '^[A-Z0-9_]{3,100}$' then
    raise exception 'BETA_GATE_3_FAILURE_INVALID' using errcode = '22023';
  end if;
  select run.* into target_job from public.job_runs run
  where run.id = (p_failure ->> 'jobRunId')::uuid
    and run.task_id = (p_failure ->> 'taskId')::uuid
  for update;
  if target_job.id is null or target_job.status <> 'RUNNING' then
    raise exception 'BETA_GATE_3_JOB_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  update public.job_runs set status = 'FAILED', finished_at = failed_at,
    failure_code = fail_gate.failure_code,
    result = jsonb_build_object(
      'executionOutcome', coalesce(p_failure ->> 'executionOutcome', 'FAILED'),
      'independentVerificationOutcome', 'INCONCLUSIVE',
      'deliveryOutcome', 'BLOCKED'
    ), updated_at = fail_gate.failed_at
  where id = target_job.id;
  update public.permission_leases set status = 'REVOKED', revoked_at = failed_at,
    revoke_reason = fail_gate.failure_code
  where job_run_id = target_job.id and status = 'ACTIVE';
  update public.worker_job_leases set status = 'RELEASED', released_at = failed_at, updated_at = failed_at
  where job_run_id = target_job.id and status = 'ACTIVE';
  update public.worker_nodes set status = 'OFFLINE', active_job_count = 0, updated_at = failed_at
  where id = target_job.worker_id;
  update public.task_assignments set status = 'CANCELLED', updated_at = failed_at
  where id = target_job.assignment_id;
  perform private.transition_task(target_job.task_id, 'RUNNING', 'CANCELLED', 'SYSTEM', null, null,
    'BETA_GATE_3_FAILED_CLOSED', 'The Gate 3 Job failed closed.',
    jsonb_build_object('jobRunId', target_job.id, 'failureCode', failure_code));
  return jsonb_build_object('failedClosed', true, 'jobRunId', target_job.id,
    'failureCode', failure_code, 'failedAt', failed_at);
end;
$$;

revoke all on function public.rpc_prepare_beta_gate_3_job(jsonb) from public, anon, authenticated;
revoke all on function public.rpc_finalize_beta_gate_3_job(jsonb) from public, anon, authenticated;
revoke all on function public.rpc_fail_beta_gate_3_job(jsonb) from public, anon, authenticated;
grant execute on function public.rpc_prepare_beta_gate_3_job(jsonb) to service_role;
grant execute on function public.rpc_finalize_beta_gate_3_job(jsonb) to service_role;
grant execute on function public.rpc_fail_beta_gate_3_job(jsonb) to service_role;
