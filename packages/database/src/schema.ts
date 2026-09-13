export const demoSchemaSql = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('CUSTOMER','PROVIDER','ADMIN')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    provider_id TEXT NOT NULL REFERENCES profiles(id),
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_agents_provider ON agents(provider_id);

  CREATE TABLE IF NOT EXISTS agent_identity_profiles (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    revision INTEGER NOT NULL CHECK(revision > 0),
    profile_sha256 TEXT NOT NULL UNIQUE CHECK(length(profile_sha256) = 64),
    previous_profile_sha256 TEXT CHECK(previous_profile_sha256 IS NULL OR length(previous_profile_sha256) = 64),
    controller_account_id TEXT NOT NULL,
    profile_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(agent_id, revision)
  );
  CREATE INDEX IF NOT EXISTS idx_agent_identity_controller
    ON agent_identity_profiles(controller_account_id, agent_id, revision DESC);
  CREATE TRIGGER IF NOT EXISTS trg_agent_identity_profile_chain_insert
  BEFORE INSERT ON agent_identity_profiles
  WHEN
    (NEW.revision = 1 AND NEW.previous_profile_sha256 IS NOT NULL) OR
    (NEW.revision > 1 AND NOT EXISTS (
      SELECT 1 FROM agent_identity_profiles previous
      WHERE previous.agent_id = NEW.agent_id
        AND previous.revision = NEW.revision - 1
        AND previous.profile_sha256 = NEW.previous_profile_sha256
        AND previous.controller_account_id = NEW.controller_account_id
    )) OR
    EXISTS (
      SELECT 1 FROM agent_identity_profiles existing
      WHERE existing.agent_id = NEW.agent_id
        AND existing.revision >= NEW.revision
    )
  BEGIN
    SELECT RAISE(ABORT, 'Agent Identity profile revision chain is invalid');
  END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_identity_profile_no_update
  BEFORE UPDATE ON agent_identity_profiles
  BEGIN
    SELECT RAISE(ABORT, 'Agent Identity profiles are append-only');
  END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_identity_profile_no_delete
  BEFORE DELETE ON agent_identity_profiles
  BEGIN
    SELECT RAISE(ABORT, 'Agent Identity profiles cannot be deleted');
  END;

  CREATE TABLE IF NOT EXISTS agent_external_identity_owners (
    identity_key TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    first_profile_revision INTEGER NOT NULL CHECK(first_profile_revision > 0),
    created_at TEXT NOT NULL,
    FOREIGN KEY(agent_id, first_profile_revision)
      REFERENCES agent_identity_profiles(agent_id, revision) ON DELETE RESTRICT
  );
  CREATE INDEX IF NOT EXISTS idx_agent_external_identity_owner
    ON agent_external_identity_owners(agent_id, first_profile_revision);
  CREATE TRIGGER IF NOT EXISTS trg_agent_external_identity_owner_no_update
  BEFORE UPDATE ON agent_external_identity_owners
  BEGIN
    SELECT RAISE(ABORT, 'External Agent identity ownership is immutable');
  END;
  CREATE TRIGGER IF NOT EXISTS trg_agent_external_identity_owner_no_delete
  BEFORE DELETE ON agent_external_identity_owners
  BEGIN
    SELECT RAISE(ABORT, 'External Agent identity ownership cannot be deleted');
  END;

  CREATE TABLE IF NOT EXISTS worker_nodes (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL,
    token_hash TEXT,
    token_id TEXT UNIQUE,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workers_provider_status ON worker_nodes(provider_id, status);

  CREATE TABLE IF NOT EXISTS worker_pairing_codes (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    code_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS worker_capability_snapshots (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id) ON DELETE CASCADE,
    capabilities_json TEXT NOT NULL,
    reported_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_worker_capability_snapshots_worker
    ON worker_capability_snapshots(worker_id, reported_at DESC);

  CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('ONLINE','BUSY')),
    active_job_run_ids_json TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    received_at TEXT NOT NULL,
    capability_snapshot_id TEXT NOT NULL REFERENCES worker_capability_snapshots(id)
  );
  CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_worker
    ON worker_heartbeats(worker_id, received_at DESC);

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES profiles(id),
    status TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 0,
    matched_agent_id TEXT REFERENCES agents(id),
    assigned_worker_id TEXT REFERENCES worker_nodes(id),
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_customer_status ON tasks(customer_id, status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS task_contract_versions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    status TEXT NOT NULL CHECK(status IN ('DRAFT','LOCKED','SUPERSEDED','CANCELLED')),
    contract_json TEXT NOT NULL,
    contract_sha256 TEXT NOT NULL CHECK(length(contract_sha256) = 64),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    locked_at TEXT,
    superseded_at TEXT,
    UNIQUE(task_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_task_contract_versions_task
    ON task_contract_versions(task_id, version DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_task_contract_one_locked
    ON task_contract_versions(task_id) WHERE status='LOCKED';

  CREATE TABLE IF NOT EXISTS task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS task_matches (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    rank INTEGER NOT NULL,
    total_score REAL NOT NULL CHECK(total_score >= 0 AND total_score <= 100),
    eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
    components_json TEXT NOT NULL,
    reasons_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_matches_task_rank ON task_matches(task_id, rank);

  CREATE TABLE IF NOT EXISTS task_assignments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    provider_id TEXT NOT NULL REFERENCES profiles(id),
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    status TEXT NOT NULL,
    quote_cents INTEGER NOT NULL CHECK(quote_cents >= 0),
    provider_earning_cents INTEGER NOT NULL CHECK(provider_earning_cents >= 0),
    platform_fee_cents INTEGER NOT NULL CHECK(platform_fee_cents >= 0),
    accepted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_assignments_provider_status ON task_assignments(provider_id, status);
  CREATE INDEX IF NOT EXISTS idx_assignments_task ON task_assignments(task_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS job_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    assignment_id TEXT NOT NULL REFERENCES task_assignments(id),
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    agent_id TEXT NOT NULL REFERENCES agents(id),
    status TEXT NOT NULL,
    executor TEXT NOT NULL,
    workflow_template TEXT NOT NULL,
    execution_backend_type TEXT NOT NULL DEFAULT 'LOCAL_WORKER' CHECK(execution_backend_type IN ('LOCAL_WORKER','MANAGED_REMOTE_SANDBOX')),
    started_at TEXT,
    ended_at TEXT,
    exit_code INTEGER,
    commit_sha_before TEXT,
    commit_sha_after TEXT,
    lease_id TEXT,
    lease_token_hash TEXT,
    lease_expires_at TEXT,
    task_contract_version_id TEXT REFERENCES task_contract_versions(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_worker_status ON job_runs(worker_id, status, created_at);

  CREATE TABLE IF NOT EXISTS managed_sandbox_runs (
    id TEXT PRIMARY KEY,
    job_run_id TEXT NOT NULL UNIQUE REFERENCES job_runs(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK(provider='VERCEL_SANDBOX'),
    provider_sandbox_id TEXT,
    provider_request_id TEXT,
    execution_backend_type TEXT NOT NULL CHECK(execution_backend_type='MANAGED_REMOTE_SANDBOX'),
    isolation_model TEXT NOT NULL CHECK(isolation_model='REMOTE_MICROVM'),
    lifecycle_mode TEXT NOT NULL CHECK(lifecycle_mode='NON_PERSISTENT'),
    status TEXT NOT NULL CHECK(status IN (
      'REQUESTED','CREATING','READY','RUNNING','SUCCEEDED','FAILED','TIMED_OUT',
      'CANCELLING','STOPPED','DESTROYED','CLEANUP_UNVERIFIED'
    )),
    region TEXT,
    runtime TEXT NOT NULL,
    network_policy_json TEXT NOT NULL,
    limits_json TEXT NOT NULL,
    provider_metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    stopped_at TEXT,
    destroyed_at TEXT,
    cleanup_verified_at TEXT,
    failure_code TEXT,
    failure_message TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_managed_sandbox_runs_status ON managed_sandbox_runs(status, created_at);

  CREATE TABLE IF NOT EXISTS job_run_attempts (
    job_run_id TEXT PRIMARY KEY REFERENCES job_runs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
    supersedes_job_run_id TEXT REFERENCES job_runs(id),
    terminal_reason TEXT,
    lease_revoked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_capability_evidence (
    job_run_id TEXT PRIMARY KEY REFERENCES job_runs(id) ON DELETE CASCADE,
    snapshot_id TEXT NOT NULL REFERENCES worker_capability_snapshots(id),
    capabilities_json TEXT NOT NULL,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS permission_leases (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    task_contract_version_id TEXT NOT NULL REFERENCES task_contract_versions(id),
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    version INTEGER NOT NULL CHECK(version > 0),
    status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','EXPIRED','REVOKED','VIOLATED','COMPLETED')),
    scope_json TEXT NOT NULL,
    starts_at TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    revoke_reason TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    CHECK(
      (status = 'PENDING' AND starts_at IS NULL AND expires_at IS NULL) OR
      (status <> 'PENDING' AND starts_at IS NOT NULL AND expires_at IS NOT NULL)
    ),
    UNIQUE(job_run_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_permission_leases_job
    ON permission_leases(job_run_id, version DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_leases_one_active
    ON permission_leases(job_run_id) WHERE status='ACTIVE';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_leases_one_live
    ON permission_leases(job_run_id) WHERE status IN ('PENDING','ACTIVE');
  CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_lease_contract_version
    ON permission_leases(task_id, task_contract_version_id, version);

  CREATE TABLE IF NOT EXISTS artifact_uploads (
    id TEXT PRIMARY KEY,
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    artifact_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    expected_size INTEGER NOT NULL CHECK(expected_size >= 0 AND expected_size <= 10485760),
    expected_sha256 TEXT NOT NULL CHECK(length(expected_sha256) = 64),
    upload_token_hash TEXT NOT NULL,
    content_base64 TEXT,
    status TEXT NOT NULL CHECK(status IN ('PENDING','UPLOADED','FINALIZED','EXPIRED')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS artifact_upload_observations (
    artifact_id TEXT PRIMARY KEY REFERENCES artifact_uploads(id) ON DELETE CASCADE,
    server_sha256 TEXT NOT NULL CHECK(length(server_sha256) = 64),
    received_mime_type TEXT NOT NULL,
    received_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_run_events (
    id TEXT PRIMARY KEY,
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    kind TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(job_run_id, sequence)
  );

  CREATE TABLE IF NOT EXISTS evidence_artifacts (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    worker_id TEXT NOT NULL REFERENCES worker_nodes(id),
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    artifact_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK(size >= 0 AND size <= 10485760),
    sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
    storage_path TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    claimed_sha256 TEXT CHECK(claimed_sha256 IS NULL OR length(claimed_sha256) = 64),
    server_sha256 TEXT CHECK(server_sha256 IS NULL OR length(server_sha256) = 64),
    sandbox_run_id TEXT REFERENCES managed_sandbox_runs(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS verification_results (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    check_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PASSED','FAILED','PENDING','ERROR')),
    summary TEXT NOT NULL,
    observed_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(task_id, job_run_id, check_id)
  );

  CREATE TABLE IF NOT EXISTS evidence_ledger_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
    entry_type TEXT NOT NULL CHECK(entry_type IN (
      'CONTRACT_LOCKED','PERMISSION_GRANTED','JOB_CLAIMED','HEARTBEAT_RECORDED',
      'EXECUTION_STARTED','REPOSITORY_CLONE_STARTED','REPOSITORY_CLONE_COMPLETED',
      'REMOTE_METADATA_CAPTURED','FILE_MANIFEST_CREATED',
        'ARTIFACT_CREATED','ARTIFACT_UPLOADED','ARTIFACT_HASH_VERIFIED','REMOTE_COMMIT_VERIFIED',
        'REPOSITORY_VERIFIED','SOURCE_PACKAGE_CREATED','SOURCE_PACKAGE_VERIFIED',
        'SOURCE_PACKAGE_UPLOADED','SOURCE_MANIFEST_VERIFIED','NETWORK_POLICY_UPDATED',
        'DEPENDENCY_INSTALL_STARTED','DEPENDENCY_INSTALL_COMPLETED','BUILD_STARTED','BUILD_COMPLETED',
        'TEST_STARTED','TEST_FAILED','SOURCE_INTEGRITY_VERIFIED',
        'MANAGED_SANDBOX_REQUESTED','MANAGED_SANDBOX_CREATED','MANAGED_SANDBOX_POLICY_VERIFIED',
      'MANAGED_SANDBOX_STARTED','NETWORK_PROBE_COMPLETED','MANAGED_SANDBOX_STOP_REQUESTED',
      'MANAGED_SANDBOX_STOPPED','MANAGED_SANDBOX_CLEANUP_VERIFIED','TIMEOUT_TRIGGERED','STALE_RESULT_REJECTED',
      'VERIFICATION_PASSED','VERIFICATION_FAILED',
      'CONTRACT_ASSERTIONS_LOCKED','TEST_ORACLE_INSPECTED','SPEC_TEST_CONFLICT_DETECTED',
      'SEMANTIC_VERIFICATION_STARTED','CONTRACT_ASSERTION_PASSED','CONTRACT_ASSERTION_FAILED',
      'ENGINEERING_REVIEW_REQUIRED','SEMANTIC_VERIFICATION_PASSED','EVIDENCE_BUNDLE_CREATED','RECEIPT_SUPERSEDED',
      'AUTHORITY_DECISION_RECORDED','PROTECTED_ACTION_ALLOWED','PROTECTED_ACTION_DENIED','PERMISSION_LEASE_REVOKED',
      'AGENT_IDENTITY_CREATED','AGENT_PROFILE_REVISION_CREATED','EXTERNAL_IDENTITY_LINKED',
      'AGENT_EXECUTION_IDENTITY_CREATED','IDENTITY_BINDING_VERIFIED','IDENTITY_BINDING_DENIED',
      'PERMISSION_VIOLATION',
      'WORKSPACE_CLEANED','RECEIPT_CREATED'
    )),
    source_record_type TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
    previous_entry_sha256 TEXT CHECK(previous_entry_sha256 IS NULL OR length(previous_entry_sha256) = 64),
    entry_sha256 TEXT NOT NULL CHECK(length(entry_sha256) = 64),
    created_at TEXT NOT NULL,
    UNIQUE(job_run_id, sequence_number),
    UNIQUE(job_run_id, entry_sha256)
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_ledger_job
    ON evidence_ledger_entries(job_run_id, sequence_number);

  CREATE TABLE IF NOT EXISTS job_receipts (
    id TEXT PRIMARY KEY,
    receipt_public_id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    job_run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
    task_contract_version_id TEXT NOT NULL REFERENCES task_contract_versions(id),
    permission_lease_id TEXT NOT NULL REFERENCES permission_leases(id),
    result TEXT NOT NULL CHECK(result IN (
      'VERIFIED','VERIFIED_DELIVERY','CONTRACT_VERIFIED','CONTRACT_VERIFIED_DELIVERY',
      'SPEC_TEST_CONFLICT','TEST_ORACLE_SUSPECT','ACCEPTANCE_CRITERIA_CONFLICT',
      'ENGINEERING_REVIEW_REQUIRED','SUPERSEDED','INVALIDATED_FOR_SEMANTIC_SUCCESS',
      'PARTIALLY_VERIFIED','FAILED','UNVERIFIED','DISPUTED',
      'PERMISSION_VIOLATION','INVALID_EVIDENCE_CHAIN'
    )),
    receipt_json TEXT NOT NULL,
    receipt_sha256 TEXT NOT NULL CHECK(length(receipt_sha256) = 64),
    evidence_chain_sha256 TEXT NOT NULL CHECK(length(evidence_chain_sha256) = 64),
    created_at TEXT NOT NULL,
    invalidated_at TEXT,
    invalidation_reason TEXT,
    UNIQUE(job_run_id)
  );

  CREATE TRIGGER IF NOT EXISTS trg_contract_locked_content_immutable
  BEFORE UPDATE ON task_contract_versions
  WHEN OLD.status <> 'DRAFT' AND (
    NEW.id <> OLD.id OR
    NEW.contract_json <> OLD.contract_json OR
    NEW.contract_sha256 <> OLD.contract_sha256 OR
    NEW.version <> OLD.version OR
    NEW.task_id <> OLD.task_id OR
    NEW.created_by <> OLD.created_by OR
    NEW.created_at <> OLD.created_at OR
    NEW.locked_at IS NOT OLD.locked_at
  )
  BEGIN
    SELECT RAISE(ABORT, 'Locked Task Contract content is immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_contract_status_guard
  BEFORE UPDATE ON task_contract_versions
  WHEN (OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT','LOCKED','CANCELLED')) OR
       (OLD.status = 'LOCKED' AND NEW.status NOT IN ('LOCKED','SUPERSEDED','CANCELLED')) OR
       (OLD.status = 'SUPERSEDED' AND NEW.status <> 'SUPERSEDED') OR
       (OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED')
  BEGIN
    SELECT RAISE(ABORT, 'Task Contract status transition is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_contract_no_delete
  BEFORE DELETE ON task_contract_versions
  BEGIN
    SELECT RAISE(ABORT, 'Task Contract versions cannot be deleted');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_job_contract_binding_insert
  BEFORE INSERT ON job_runs
  WHEN NEW.task_contract_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_contract_versions c
    WHERE c.id=NEW.task_contract_version_id
      AND c.task_id=NEW.task_id
      AND c.status IN ('LOCKED','SUPERSEDED')
  )
  BEGIN
    SELECT RAISE(ABORT, 'Job Run Task Contract binding is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_job_contract_binding_update
  BEFORE UPDATE OF task_contract_version_id, task_id ON job_runs
  WHEN NEW.task_contract_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_contract_versions c
    WHERE c.id=NEW.task_contract_version_id
      AND c.task_id=NEW.task_id
      AND c.status IN ('LOCKED','SUPERSEDED')
  )
  BEGIN
    SELECT RAISE(ABORT, 'Job Run Task Contract binding is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_binding_insert
  BEFORE INSERT ON permission_leases
  WHEN NOT EXISTS (
    SELECT 1 FROM job_runs j
    WHERE j.id=NEW.job_run_id
      AND j.task_id=NEW.task_id
      AND j.worker_id=NEW.worker_id
      AND j.agent_id=NEW.agent_id
      AND j.task_contract_version_id=NEW.task_contract_version_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'Permission Lease binding is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_binding_immutable
  BEFORE UPDATE ON permission_leases
  WHEN NEW.task_id<>OLD.task_id OR
       NEW.task_contract_version_id<>OLD.task_contract_version_id OR
       NEW.job_run_id<>OLD.job_run_id OR
       NEW.agent_id<>OLD.agent_id OR
       NEW.worker_id<>OLD.worker_id OR
       NEW.version<>OLD.version OR
       NEW.scope_json<>OLD.scope_json OR
       NEW.created_at<>OLD.created_at OR
       NEW.created_by<>OLD.created_by OR
       (OLD.status<>'PENDING' AND (
         NEW.starts_at IS NOT OLD.starts_at OR
         NEW.expires_at IS NOT OLD.expires_at
       )) OR
       (OLD.status IN ('COMPLETED','EXPIRED','REVOKED','VIOLATED') AND (
         NEW.revoked_at IS NOT OLD.revoked_at OR
         NEW.revoke_reason IS NOT OLD.revoke_reason
       ))
  BEGIN
    SELECT RAISE(ABORT, 'Permission Lease binding and scope are immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_status_guard
  BEFORE UPDATE OF status ON permission_leases
  WHEN (OLD.status='PENDING' AND NEW.status NOT IN ('PENDING','ACTIVE','EXPIRED','REVOKED','VIOLATED')) OR
       (OLD.status='ACTIVE' AND NEW.status NOT IN ('ACTIVE','COMPLETED','EXPIRED','REVOKED','VIOLATED')) OR
       (OLD.status IN ('COMPLETED','EXPIRED','REVOKED','VIOLATED') AND NEW.status<>OLD.status)
  BEGIN
    SELECT RAISE(ABORT, 'Permission Lease status transition is invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_dates_insert
  BEFORE INSERT ON permission_leases
  WHEN NEW.status<>'PENDING' AND (
    julianday(NEW.starts_at) IS NULL OR
    julianday(NEW.expires_at) IS NULL OR
    julianday(NEW.expires_at)<=julianday(NEW.starts_at)
  )
  BEGIN
    SELECT RAISE(ABORT, 'Permission Lease effective dates are invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_dates_update
  BEFORE UPDATE OF status, starts_at, expires_at ON permission_leases
  WHEN NEW.status<>'PENDING' AND (
    julianday(NEW.starts_at) IS NULL OR
    julianday(NEW.expires_at) IS NULL OR
    julianday(NEW.expires_at)<=julianday(NEW.starts_at)
  )
  BEGIN
    SELECT RAISE(ABORT, 'Permission Lease effective dates are invalid');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_permission_no_delete
  BEFORE DELETE ON permission_leases
  BEGIN
    SELECT RAISE(ABORT, 'Permission Leases cannot be deleted');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_evidence_ledger_no_update
  BEFORE UPDATE ON evidence_ledger_entries
  BEGIN
    SELECT RAISE(ABORT, 'Evidence Ledger entries are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_evidence_ledger_no_delete
  BEFORE DELETE ON evidence_ledger_entries
  BEGIN
    SELECT RAISE(ABORT, 'Evidence Ledger entries are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_receipt_immutable_content
  BEFORE UPDATE ON job_receipts
  WHEN NEW.id <> OLD.id OR
       NEW.receipt_public_id <> OLD.receipt_public_id OR
       NEW.task_id <> OLD.task_id OR
       NEW.task_contract_version_id <> OLD.task_contract_version_id OR
       NEW.permission_lease_id <> OLD.permission_lease_id OR
       NEW.created_at <> OLD.created_at OR
       NEW.receipt_json <> OLD.receipt_json OR
       NEW.receipt_sha256 <> OLD.receipt_sha256 OR
       NEW.evidence_chain_sha256 <> OLD.evidence_chain_sha256 OR
       NEW.result <> OLD.result OR
       NEW.job_run_id <> OLD.job_run_id
  BEGIN
    SELECT RAISE(ABORT, 'Verified Job Receipt content is immutable');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_receipt_no_delete
  BEFORE DELETE ON job_receipts
  BEGIN
    SELECT RAISE(ABORT, 'Verified Job Receipts cannot be deleted');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_receipt_invalidation_guard
  BEFORE UPDATE OF invalidated_at, invalidation_reason ON job_receipts
  WHEN (OLD.invalidated_at IS NOT NULL AND (
          NEW.invalidated_at IS NULL OR
          NEW.invalidated_at<>OLD.invalidated_at OR
          NEW.invalidation_reason<>OLD.invalidation_reason
        )) OR
       (OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NULL AND NEW.invalidation_reason IS NOT OLD.invalidation_reason)
  BEGIN
    SELECT RAISE(ABORT, 'Receipt invalidation is one-way');
  END;

  CREATE TABLE IF NOT EXISTS receipt_semantic_reviews (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES job_receipts(id),
    review_contract_sha256 TEXT NOT NULL CHECK(length(review_contract_sha256) = 64),
    outcome TEXT NOT NULL CHECK(outcome IN (
      'CONTRACT_VERIFIED','SPEC_TEST_CONFLICT','TEST_ORACLE_SUSPECT',
      'ACCEPTANCE_CRITERIA_CONFLICT','ENGINEERING_REVIEW_REQUIRED'
    )),
    overall_status TEXT NOT NULL CHECK(overall_status IN (
      'VERIFIED_DELIVERY','ENGINEERING_REVIEW_REQUIRED','SUPERSEDED','FAILED'
    )),
    evidence_chain_sha256 TEXT NOT NULL CHECK(length(evidence_chain_sha256) = 64),
    review_json TEXT NOT NULL,
    review_sha256 TEXT NOT NULL CHECK(length(review_sha256) = 64),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_receipt_semantic_reviews_receipt
    ON receipt_semantic_reviews(receipt_id, created_at);
  CREATE TRIGGER IF NOT EXISTS trg_receipt_semantic_review_no_update
  BEFORE UPDATE ON receipt_semantic_reviews
  BEGIN
    SELECT RAISE(ABORT, 'Receipt semantic reviews are append-only');
  END;
  CREATE TRIGGER IF NOT EXISTS trg_receipt_semantic_review_no_delete
  BEFORE DELETE ON receipt_semantic_reviews
  BEGIN
    SELECT RAISE(ABORT, 'Receipt semantic reviews are append-only');
  END;

  CREATE TABLE IF NOT EXISTS test_wallets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    available_cents INTEGER NOT NULL DEFAULT 0 CHECK(available_cents >= 0),
    reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents >= 0),
    pending_cents INTEGER NOT NULL DEFAULT 0 CHECK(pending_cents >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(owner_id, kind)
  );

  CREATE TABLE IF NOT EXISTS test_ledger_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT REFERENCES tasks(id),
    wallet_id TEXT NOT NULL REFERENCES test_wallets(id),
    transaction_key TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(wallet_id, transaction_key, entry_type)
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_task ON test_ledger_entries(task_id, created_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_kind TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    success INTEGER NOT NULL CHECK(success IN (0,1)),
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id, created_at);

  CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    opened_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('OPEN','UNDER_REVIEW','RESOLVED','REJECTED')),
    held_amount_cents INTEGER NOT NULL CHECK(held_amount_cents >= 0),
    resolution TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status, created_at DESC);

  CREATE TABLE IF NOT EXISTS webhook_receipts (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    body_sha256 TEXT NOT NULL,
    verified INTEGER NOT NULL CHECK(verified IN (0,1)),
    processed INTEGER NOT NULL CHECK(processed IN (0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source, delivery_id)
  );
`;
