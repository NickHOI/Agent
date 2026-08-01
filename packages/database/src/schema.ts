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
    started_at TEXT,
    ended_at TEXT,
    exit_code INTEGER,
    commit_sha_before TEXT,
    commit_sha_after TEXT,
    lease_id TEXT,
    lease_token_hash TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_runs_worker_status ON job_runs(worker_id, status, created_at);

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
