# Beta Gate 3 Real End-to-End Verified Work Report

## Status

# MILESTONE PASS — BETA GATE 3 REAL END-TO-END VERIFIED WORK — EXTERNAL REVIEW REQUIRED

This is a non-production product and engineering PASS for the exact bounded
Beta Gate 3 journey. It is not production readiness, a Reputation corpus
entry, a payment authorization, or permission to begin Gate 4.

## Verified Journey

1. A real Supabase Auth user entered the existing `donelayer-beta-validation`
   Workspace. The owner email and temporary passwords are absent from every
   report and evidence artifact.
2. The persisted Work `586650a1-98cd-4226-9768-4a90ebcd3d9b` reused the Agent,
   locked Contract V2, and approved task-scoped Authority created before the
   source-package stop. No setup was recreated.
3. An attempted browser Authority expansion was rejected with no mutation.
   The accepted Authority permits only `apps/web/src/lib/format.ts`, deny-all
   network, no persistence, no workload environment variables, at most two
   Sandboxes, and at most ten commands.
4. Anonymous credential-free Git resolution and clone bound `main` to exact
   Commit `dda68c21fe4b5d3728622408e5fabd4c50baa853`. The 164-file canonical
   Source Package passed independent remote-Commit resolution and cleanup.
   Source Package SHA-256 is
   `898cbe32e73e4dd4cd23f2902c4dfb83f95741d24f7437a6602276ffb1a7c70f`.
5. Exactly one Job ran through Vercel AI Gateway. The selected model was
   `inclusionai/ling-3.0-flash-fin`; the run made five API requests. Token
   counts were 71,106 input and 1,140 output. Provider cost remained
   unavailable and is not guessed.
6. The execution Sandbox produced one patch for the single authorized file.
   Patch SHA-256 is
   `2f14f696494ba423ede5e1c15f7c8149b4dcca82d1c2b41249dcf07676434e19`.
   A fresh verifier Sandbox independently reproduced the patch and passed both
   locked assertions. Both Sandboxes were cleanup-verified.
7. Execution, independent verification, and delivery remained separate:
   `COMPLETED`, `VERIFIED`, and `VERIFIED_DELIVERY`.
8. Supabase durably persisted the completed Assignment, completed Permission
   Lease, released Worker Lease, offline Worker, four verified artifacts,
   two passed verification results, 18 Evidence Ledger entries, and one
   Receipt. Sign-out denied Work access; sign-in restored the same valid Work
   and Receipt.
9. PostgreSQL's equivalent `+00:00` timestamp serialization initially exposed
   a readback verifier defect. The verifier now normalizes persisted UTC
   timestamps before hashing; real field tampering still fails closed. The
   persisted Ledger and Receipt now independently verify as valid.
10. The public Receipt endpoint and page read the Supabase record through a
    server-only projection and expose only the bounded public view. Anonymous
    verification reports `VALID`.

## Durable Evidence

- Agent: `628557f4-d4b5-4219-9786-a363ef7b5aaa`
- Contract: `261905f3-64f9-441b-813e-5a8e0cb09e5e`
- Contract SHA-256:
  `caf1d6558bec4a2a4ad36acd9306b2a8dc4bff5a2b2b5edd912103b31af99496`
- Authority: `69bc363a-63e8-4f51-94eb-6e6c3682fc52`
- Authority scope SHA-256:
  `a75affc709a8390c2652a5d0024f5a257a0838d51e7fde841e4446cf425f748e`
- Job: `9f95f764-128b-4f20-808b-eb7a75a9cb15`
- Verification: `c8031355-57ca-4bbe-a77c-8a85a1a154ec`
- Receipt: `cb695c52-89ef-470b-9de5-08943f98d13a`
- Public Receipt: `dlr_XGLxWCZfMc5S7JWWYdMwOb01`
- Receipt SHA-256:
  `54bd7e29bcf128759ce6a4ec88105c342b6d1097cd720a019256a741e65142a0`
- Pre-Receipt Evidence chain SHA-256:
  `15be37508fa1e746172a76ba42db8d5aebaa3a469288f68233a6ff1395b237f2`
- Final Ledger chain SHA-256:
  `ceabff542043b9d507f561729fe106a274cc863fc20f5ad855b9f3bda5752c90`

## Security And Isolation

- Account B received `404` for Account A's Work. Cross-account Authority,
  private Receipt download, and execution attempts were denied.
- Anonymous calls to `rpc_prepare_beta_gate_3_job`,
  `rpc_finalize_beta_gate_3_job`, and `rpc_fail_beta_gate_3_job` each returned
  `401`. Service-only persistence remains service-only.
- Verifier rejection cannot produce Verified Delivery, and missing or tampered
  evidence cannot produce a valid Receipt, as covered by focused policy,
  Ledger, and Receipt tests.
- The Worker ended `OFFLINE`, active Job count is zero, its Lease is released,
  and platform credentials were not passed to workloads.
- Persisted evidence contains no detected credential value, bearer token,
  `.env.local` path, or host user path.
- Gitleaks scanned 447 currently committable files. Two pre-existing test-only
  detections were reviewed: a unit-test constant and a UUID fixture. Neither
  matches a live credential format or external environment value.

## Health And Resource Evidence

- The immediately preceding retry-fix verification established
  `ACTIVE_HEALTHY`, no retryable `40001`, and no abnormal idle rollback growth.
- This Job completed without `40001`, retry duplication, or a second Job. Final
  Job count is exactly one.
- Post-run Auth health returned `200`; a server-authenticated read-only
  PostgREST query returned `200` in 1,010 ms.
- The bounded Job ran for 247,176 ms. The Worker and both non-persistent
  Sandboxes were inactive and cleanup-verified afterward.

## Regression Evidence

- Focused trust, Gate, Model C, Ledger, Receipt, and readback tests: 53/53.
- Full repository: 349 active tests passed; 14 established tests skipped.
- ESLint: PASS with zero warnings.
- Strict TypeScript: PASS.
- Web production build: PASS.
- Worker build: PASS.
- Anonymous public Receipt desktop `1440x900`: PASS, no overflow.
- Anonymous public Receipt mobile `390x844`: PASS, no overflow.
- `git diff --check`: PASS; only existing line-ending notices were emitted.

## External Effects And Classification

The Gate created one non-production Supabase Job lifecycle, made five model API
requests, and used exactly one execution Sandbox plus one verifier Sandbox. It
created no branch, Commit, Pull Request, merge, deployment, payment, blockchain
action, billing change, second provider, persistent snapshot, or local fallback.

Classification is `NOT_VERIFIED`, reason `BETA_GATE_VALIDATION`, Reputation
contribution `0`. It is displayed as a valid non-qualifying Receipt and does
not enter the Real Job audit queue or change the canonical count.

## Stop

Stop for external review of this report and
`test-results/beta-gate-3-real-end-to-end-evidence.json`. Do not begin Gate 4.
