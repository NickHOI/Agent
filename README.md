# DoneLayer

**Get the job finished. Prove it works.**

DoneLayer 是一個以驗證為核心的軟件任務市場 MVP。Customer 提交有明確範圍的 Repository 任務，平台分析需求並配對 Agent，Provider 接受後由 outbound-only Worker 執行，最後由獨立的 Proof-of-Done 模組驗證證據。Agent 說「完成」並不會直接令任務變成 `COMPLETED`。

Canonical product documents:

- [Product North Star](docs/PRODUCT_NORTH_STAR.md)
- [Long-term Product Roadmap](docs/PRODUCT_ROADMAP.md)
- [Current Phase and authorized boundary](docs/CURRENT_PHASE.md)
- [Gate 4 Real Corpus Ramp](docs/GATE_4_REAL_CORPUS_RAMP.md)
- [Current Architecture reality view](CURRENT_ARCHITECTURE.md)

`docs/PRODUCT_ROADMAP.md` is the canonical long-term roadmap. DoneLayer's first
product wedge is Verified Work: an Agent saying "Done" is not sufficient without
independent outcome evidence. The broader destination spans task-scoped
Authority, Identity, evidence-based Reputation, controlled Payments, settlement,
and organizational trust. The platform remains off-chain first and independent
of tokens or blockchains. Roadmap items are not implementation claims.

Gate 4 now uses a staged Real Corpus ramp: first one externally accepted genuine
Real Verified Job, then at least five across two task types with negative
controls, then at least twenty plus a Reputation Readiness Review. Phase 4
Reputation starts only after all three corpus-entry Gates pass.

The bounded Agent Identity V1 Gate now adds an opaque internal Agent ID,
append-only profile revisions, a distinct execution identity, and coherent
Work Contract, Permission Lease, Evidence, and Receipt bindings. ERC-8004 and
HOL/UAID remain optional typed references only; no live external identity,
blockchain, token, or Reputation integration is claimed. See
`AGENT_IDENTITY_INTEROPERABILITY_V1_REPORT.md` for the exact evidence boundary.

本專案預設使用完全本機的 Demo Mode。沒有 Supabase、GitHub App、Codex CLI、Docker、Stripe、A2A Agent 或 MCP server，仍可展示以下完整流程：

```text
Customer 發布任務
-> 平台分析並配對 Agent
-> Provider 接受
-> Worker claim Job
-> Executor 產生 logs、diff 和 evidence
-> Proof-of-Done 驗證
-> Customer 接受
-> Test Ledger 以 80/20 比例放款
-> COMPLETED
```

Demo 不是單純的前端動畫。任務狀態、事件、Evidence、Verification Result 和 Ledger Entry 都會寫入本機 SQLite 資料庫，重新整理頁面後仍然存在。

## 先決條件

- Windows、macOS 或 Linux
- [Node.js](https://nodejs.org/) 24.15 或更新版本
- npm 11 或更新版本
- Git，建議安裝；Codex preview executor 必須使用
- 約 1 GB 可用磁碟空間供依賴、build cache 和 Worker 暫存資料使用

```powershell
node --version
npm --version
git --version
```

Windows PowerShell 若禁止執行 `npm.ps1`，請把以下所有 `npm` 改為 `npm.cmd`。

## 五分鐘啟動

在本專案根目錄 `<repo-root>` 執行：

```powershell
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。按 **Run the full demo**，再選擇 **Continue as customer**。

正式啟動 Demo 前建議建立本機設定檔：

```powershell
Copy-Item .env.example apps/web/.env.local
```

然後在 `apps/web/.env.local` 把 `DEMO_SESSION_SECRET` 改成至少 32 個隨機字元。所有外部整合欄位可以保留空白，`APP_MODE` 應保持為 `demo`。

若 3000 port 已被使用：

```powershell
npm run dev -- --port 3001
```

Worker 配對時也要把 API URL 改成 `http://localhost:3001`。

## 執行完整 Demo

1. 前往 [Sign in](http://localhost:3000/sign-in)。
2. 選擇 **Continue as customer**。
3. 在 Customer Dashboard 按 **Run Full Demo**。
4. 頁面會開啟新任務並逐步執行分析、配對、Provider 接受、Worker 執行、Evidence 上載、驗證和 Customer 接受。
5. 在 Task Detail 查看 **Timeline**、**Live Logs**、**Evidence**、**Verification** 和 **Payment**。
6. 等待狀態成為 **Completed**，付款狀態成為 **Released**。
7. 重新整理頁面，確認結果仍然存在。

這條自動流程使用 `DemoTaskAnalyzer`、規則匹配、`DemoExecutor`、獨立 verifier 和 Test Ledger 的本機實作，不會呼叫外部 AI 或付款服務。

## 三種角色

Demo 登入頁可隨時切換角色。角色會寫入簽名、HttpOnly、SameSite Cookie，伺服器端仍會檢查每個敏感操作。

| 角色 | Demo 身分 | 主要入口 | 可操作內容 |
| --- | --- | --- | --- |
| Customer | Nick Demo | `/customer` | 建立任務、查看配對和執行、審核 Evidence、接受或爭議 |
| Provider | Provider Alpha | `/provider` | 接受任務、建立 Agent、配對 Worker、查看工作和模擬收入 |
| Admin | DoneLayer Admin | `/admin` | 查看平台狀態、暫停 Agent/Worker、重新配對、處理爭議 |

Demo Seed 同時包含 Provider Beta、四個 Agent，以及 macOS、Windows 和 Linux Worker 範例。

## 建立第一個 Task

1. 以 Customer 登入。
2. 按右上角 **New task**，或前往 `/tasks/new`。
3. 完成 Scope、Requirements、Guardrails 和 Analyze 四個步驟。
4. Repository 可保留為 `demo://sample-org/react-auth`，不需要 GitHub App。
5. 設定預算、期限、技能、OS、工具和 Acceptance Criteria。
6. 選擇自動配對，或指定 Agent。
7. 先按分析，再建立任務。

Customer 不能提交任意 Shell Command。畫面產生的是結構化要求和預先定義的 workflow command ID，例如 `NPM_TEST` 與 `NPM_BUILD`。

## 建立第一個 Agent

1. 回到 `/sign-in`，選擇 **Continue as provider**。
2. 前往 **Agents**，按 **Create Agent**。
3. 選擇 `Local Worker`、`Webhook` 或 `A2A` endpoint type。
4. 填寫名稱、slug、技能、task type、語言、OS、工具、MCP metadata 和價格。
5. 按 **Create Agent**。

新 Agent 會保持 `PENDING` 並暫停接單，直到平台完成 endpoint 和 capability 審核。A2A 選項只會下載、驗證和正規化 Agent Card；MVP 沒有宣稱完整支援 A2A protocol execution。

## 配對第一個 Worker

Web 必須先在本機運行。

1. 以 Provider 登入。
2. 前往 **Worker nodes**，按 **Pair Worker**。
3. 選擇現有 node，或建立新 node。
4. 按 **Generate pairing code**。Code 只能使用一次，並在 10 分鐘後過期。
5. 在另一個終端執行畫面提供的指令：

```powershell
npm run worker:setup -- --api-url http://localhost:3000 --code YOUR-PAIRING-CODE --name "My Dev Worker"
```

6. 啟動 outbound polling：

```powershell
npm run worker:start
```

Worker 不會開放公共 inbound port。它只會主動呼叫平台 API、發送 heartbeat、claim 已分配 Job、續租 lease，以及上載 scoped evidence。

## Worker 指令

```powershell
# 檢查 OS、磁碟、Git、Docker、Codex、GitHub CLI、MCP 名稱和 executor
npm run worker:doctor

# 以 JSON 顯示診斷結果
npm run worker:doctor -- --json

# 配對 Worker；省略 --code 時會互動式詢問
npm run worker:setup -- --api-url http://localhost:3000

# 持續 heartbeat 和 polling
npm run worker:start

# 只嘗試 claim 一個 Job 後退出，適合受監督測試
npm run worker:start -- --once

# 查看本機配對狀態；不會顯示完整 token
npm run worker:status -- --json

# 在平台撤銷 token，並移除本機設定
npm run worker:logout
```

Worker 的設定預設位於使用者 home 下的 `.donelayer-worker`。MVP 會把 credential 與一般設定分開，並在支援的平台設定私人檔案權限，但目前仍是 development credential store，不是 Windows Credential Manager、macOS Keychain 或 Linux Secret Service。

完整說明見 [docs/worker-setup.md](docs/worker-setup.md)。

## Codex CLI Executor

Codex executor 是 opt-in preview，Demo 不需要啟用。它只會在 Git、Docker、Codex CLI 都可用，而且 Provider 明確啟用時被 Worker 宣告。

1. 在 Provider 的專用執行機器自行安裝並登入官方 Codex CLI。
2. 不要把 Codex token、登入檔案或 API key 提供給 DoneLayer。
3. 在啟動 Worker 的同一個終端設定：

```powershell
$env:DONELAYER_ENABLE_CODEX_EXECUTOR = "true"
npm run worker:doctor -- --strict
npm run worker:start
```

所有 Codex 參數集中在 `apps/worker/src/executors/codex.ts`。Adapter 優先使用 SDK，否則使用 `codex exec`，採用 `workspace-write`、`approvalPolicy: never`、disabled network/web search、timeout、取消訊號和 structured JSON output。它不使用已棄用的 `--full-auto`，也不會讀取或上載 Provider 的 Codex 憑證。

重要限制：目前 Docker availability 是真實 executor 的保守 eligibility gate，但 Codex container orchestration 和安全的 GitHub workspace materialization 尚未完成。Native `workspace-write` 不等同一次性 container。只應在專用 Provider 環境、人工接受每個任務後使用這個 preview。

完整說明見 [docs/codex-executor.md](docs/codex-executor.md)。

## GitHub App

Demo Repository 不需要 GitHub。正式整合必須使用 GitHub App，不接受 Customer 貼 Personal Access Token。

目前已有 GitHub webhook 的 raw-body HMAC 驗證、event allowlist、delivery replay protection、audit metadata，以及 GitHub App 設定文件。建立 App 時只選擇需要的 Repository，並依功能授予最低的 Contents、Pull requests、Checks、Actions、Commit statuses 和 Metadata 權限。

伺服器環境變數如下：

```text
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

Webhook URL 為：

```text
https://YOUR-DOMAIN/api/webhooks/github
```

完整的 permissions、events、private key、selected repositories 和 signature 步驟見 [docs/github-app-setup.md](docs/github-app-setup.md)。一個 owner-controlled public Fixture 已用 development GitHub identity 完成真實 clone、branch、Commit、open PR 與 fresh-Sandbox independent verification；這不等於 production GitHub App installation、任意 Customer repository access 或 general delivery 已接通。

## Supabase

`supabase/migrations/20260731235500_initial_schema.sql` 提供 production-oriented PostgreSQL schema，包括外鍵、constraints、indexes、transactional functions、RLS、explicit Data API grants 和私人 Evidence Storage policy。`supabase/migrations/20260908141623_agent_identity_production_persistence_v1.sql` 再加入 append-only Agent Identity history、全域 external identity ownership 與 service-only 原子命令。`supabase/seed.sql` 提供相應 Demo fixtures。

本 MVP 已有 Supabase Auth 的 server-side actor boundary，Agent 建立與 Agent Identity revision/link API 亦已接上受 RLS 保護的 Supabase/Postgres adapter 與 service-only 原子命令。其餘 Marketplace 任務服務仍使用本機 SQLite `DemoStore`；migration 尚未在連結的 Postgres 專案執行驗證，因此請勿把 `APP_MODE=supabase` 視為完整、可部署的 production backend。

要檢視或在開發 Supabase 專案試跑 schema，可安裝 Supabase CLI，連接一個非 production project，再執行：

```powershell
supabase db push
```

在套用 migration 前應先由資料庫管理員審核，並確認備份、RLS、Auth role metadata 和 Storage bucket 設定。優先使用 `SUPABASE_SECRET_KEY`；舊版 `SUPABASE_SERVICE_ROLE_KEY` 僅作相容 fallback。兩者都只能存在於伺服器 secret manager，永遠不能使用 `NEXT_PUBLIC_` 前綴，也不能交給 Worker 或瀏覽器。

## 測試與品質檢查

在根目錄執行：

```powershell
npm run lint
npm run typecheck
npm run test
npm run build
```

測試涵蓋：

- Matching 權重、排名、hard filters 和 heartbeat expiry
- Task state machine、非法轉換，以及不能跳過驗證直接完成
- Pairing code expiry/reuse、Worker lease、protocol schema 和 log redaction
- Webhook HMAC、timestamp、nonce、retry、replay 和 SSRF filtering
- Evidence SHA-256、大小，以及所有 Acceptance Check 的獨立判定
- Test Ledger reserve、80/20 release、refund 和 dispute hold
- Customer、Provider、Worker 的授權邊界
- 完整 persisted Demo lifecycle integration test
- Demo/Codex executor、Worker client 和 Worker runtime

Playwright E2E 指令為：

```powershell
npm run test:e2e
```

最近一次完整驗證為 lint、strict typecheck、35 個測試檔通過／4 個 live-gate 檔案 skipped、166 項 tests 通過／6 項 skipped，以及 Web 與 Worker production build 通過。歷史 Playwright 與 in-app browser walkthrough 及各 real Gate 的精確邊界見 [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)。

## 安全邊界

- Customer 文字不會被插入 Shell command。
- 真實工作必須先由 Provider 人工接受。
- Worker 使用 outbound HTTP(S)，不開公共 inbound port。
- Pairing code 一次性且有期限；平台只儲存 code/token digest。
- Job 操作綁定 Worker、Assignment、短期 lease token 和 fencing generation。
- Evidence 上載受 Job/Worker scope、MIME、大小和 SHA-256 驗證限制。
- Executor 只生產 Evidence；只有獨立 Verifier 可通過 Proof-of-Done。
- Server-side state machine 記錄 actor、時間、原因和 Task Event。
- Webhook 使用 HMAC、timestamp、nonce、constant-time comparison 和 replay receipt。
- Logs 和 structured payload 會進行 secret redaction 和大小限制。
- Supabase production schema 對所有 application table 啟用 RLS。
- Service Role Key、GitHub App private key、Codex authorization 和 MCP secrets 不會送到瀏覽器或 Worker payload。
- Docker 不可用時，Worker 只宣告 Demo executor；系統不會假裝 native execution 和 container 一樣安全。

詳細威脅與緩解措施見 [docs/security.md](docs/security.md) 和 [docs/threat-model.md](docs/threat-model.md)。

## 專案結構

```text
apps/
  web/                 Next.js UI、Route Handlers、Demo Auth
  worker/              Node.js TypeScript outbound Worker CLI
packages/
  shared/              Zod schemas、共用 domain types
  database/            SQLite DemoStore、seed、ledger、audit、leases
  matching/            規則過濾、七項透明加權評分
  task-state-machine/   嚴格 task transition graph 和 actor guards
  proof-of-done/        獨立 Acceptance Check evaluator 和 hashing
  agent-adapters/       Demo、Local Worker、Webhook、A2A adapters
  worker-protocol/      Pairing、heartbeat、job、lease、evidence contract
supabase/
  migrations/          PostgreSQL schema、functions、RLS、Storage policies
  seed.sql              Supabase Demo fixtures
tests/
  unit/                 Domain、Worker、Executor、Webhook tests
  integration/          完整 Demo lifecycle
  authorization/        Customer、Provider、Worker、state protection
docs/
  PRODUCT_NORTH_STAR.md
  PRODUCT_ROADMAP.md     Canonical long-term roadmap
  CURRENT_PHASE.md       Current authorization and stop boundary
  architecture.md
  adr/
  security.md
  threat-model.md
  worker-setup.md
  codex-executor.md
  github-app-setup.md
```

## Adapter 狀態

| Adapter / Provider | MVP 狀態 | 外部依賴 |
| --- | --- | --- |
| DemoTaskAnalyzer | 可用，deterministic Demo | 無 |
| RuleBasedTaskAnalyzer | 可用，可測試規則輸出 | 無 |
| LLMTaskAnalyzer | 只預留 interface | LLM provider，未接 |
| DemoExecutor / DemoAgentAdapter | 可用，完整本機生命週期 | 無 |
| LocalWorkerAdapter | 可用於 Worker protocol | 已配對 Worker |
| CodexCliExecutor | Opt-in preview | Git、Docker、已登入 Codex CLI |
| WebhookAgentAdapter | 已有簽名、retry、callback primitives | Allowlisted HTTPS endpoint 和 shared secret |
| A2AAdapter | Agent Card import/validation 和 interface skeleton | HTTPS Agent Card |
| Test Ledger | 可用，模擬 balance/reserve/release/refund | 無 |
| StripeConnectProvider | 只預留 feature flag/skeleton，不可用於真實付款 | 未接 |
| GitHub App / Git delivery | Webhook security 和設定骨架；exact public Fixture 的 owner-development-auth delivery 已驗證 | Production App installation、general repository grants/PR delivery 未接 |
| Supabase | Schema、RLS、seed、Auth boundary | Runtime persistence/storage adapter 未接 |

## 已知限制

- Demo Store 是單一 Web process 使用的本機 SQLite，不適合多 instance 或 production concurrency。
- Demo Executor 產生可重現的模擬 repository、diff、tests 和 Evidence；它不是外部 Agent。
- Codex preview 尚未在本環境以真實 Codex CLI 和 container 執行端到端驗收。
- Production GitHub App installation、短期 installation token、任意 Customer repository grant 和 generalized delivery 尚未完成；exact public Fixture 的 development-auth vertical slice 不應被泛化。
- Supabase migration 尚未在本環境套用到真實 Supabase project。
- Webhook Agent primitives 已完成，但未與外部 Provider endpoint 做 production interop test。
- A2A 只支援 Agent Card discovery/validation，不支援完整 task protocol。
- Agent Identity V1 目前是可驗證的 in-process profile/execution model；尚未接 production identity persistence、live ERC-8004/HOL linkage 或 legal identity verification。
- MCP 只儲存 server/tool capability metadata，不代管 server 或 secrets。
- Payment 是 Test Ledger，沒有真實收款、KYC、稅務或 payout。
- Worker credential store 尚未整合 OS keychain。
- 真實 repository 的安全解壓、ephemeral container、CPU/memory/disk/network enforcement 仍是 production hardening 工作。

## 重設本機 Demo

先停止 Web 和 Worker，然後刪除根目錄下的 `.data/donelayer.sqlite`。下一次啟動時會重新建立 schema 和 seed data。不要在需要保留 Demo 任務紀錄時執行這個步驟。

## 進一步文件

- [Architecture](docs/architecture.md)
- [Product North Star](docs/PRODUCT_NORTH_STAR.md)
- [Canonical Product Roadmap](docs/PRODUCT_ROADMAP.md)
- [Current Phase](docs/CURRENT_PHASE.md)
- [Current Architecture reality view](CURRENT_ARCHITECTURE.md)
- [Security design](docs/security.md)
- [Threat model](docs/threat-model.md)
- [Worker setup](docs/worker-setup.md)
- [Codex executor](docs/codex-executor.md)
- [GitHub App setup](docs/github-app-setup.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
