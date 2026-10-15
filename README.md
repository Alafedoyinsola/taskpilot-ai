# TaskPilot AI

**Autonomous Task Planning & DeFi Intelligence with Celo x402 Micropayments**

> **Hackathon**: Celo — Agents on Open Rails<br>
> **Track**: Build with buy<br>
> **Status**: Core pipeline, safety controls, offline test suite (83/83 passing), and `@celo/buy` x402 integration complete. Live payment execution is disabled by default behind an explicit feature flag and user approval gate.

---

## 1. Project Overview & The Problem

Autonomous AI agents frequently need access to external specialized capabilities—such as real-time market data, deep research models, or compute resources. However, traditional Web2 and SaaS infrastructures impose severe barriers on autonomous agents:
* **Prepaid Subscriptions & Monthly Minimums**: Require credit card KYC, recurring billing, and long-term commitments for intermittent tasks.
* **API Key Exposure & Custody Risks**: Storing high-privilege API keys with unlimited billing limits creates massive liability for autonomous agents.
* **Mismatch with Traditional Payment Rails**: Traditional payment and subscription workflows are poorly suited to autonomous, per-request agent payments, while x402 provides a standardized payment flow.

**TaskPilot AI** solves this problem by combining open DeFi data aggregation with pay-per-use AI intelligence powered by Celo's x402 micropayment standard:
1. It queries free public analytics (DefiLlama) to establish baseline DeFi protocol facts.
2. When deeper analysis is beneficial, it probes a configured Cencori x402 endpoint and validates the returned payment challenge.
3. It enforces strict local policy constraints (asset, recipient, network, and a $0.01 USDC hard cap), prompts the user for explicit interactive approval, and pays micro-amounts of USDC per call via `@celo/buy`.
4. If payment is declined, disabled, or unavailable, the agent gracefully completes its report using free data alone without crashing.

---

## 2. Four-Step Workflow

TaskPilot AI executes research tasks through a structured four-step pipeline:

```
┌─────────────────────────────────┐
│ 1. Task Planning & Decomposition│  Decomposes natural language prompt into actionable steps
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 2. External DeFi Querying       │  Fetches live Celo TVL and protocol metrics from DefiLlama
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│ 3. x402 Probe & Approval Gate   │  Probes Cencori gateway, validates 402 quote, requests user approval
└──────────────┬──────────────────┘
               │
       ┌───────┴───────┐
       ▼               ▼
[Approved & Enabled]  [Declined / Disabled / Offline]
       │               │
       ▼               ▼
 Paid x402 Inference   Fallback: DefiLlama Only
       │               │
       └───────┬───────┘
               ▼
┌─────────────────────────────────┐
│ 4. Report Synthesis             │  Synthesizes comprehensive DeFi report with liquidity insights
└─────────────────────────────────┘
```

1. **Step 1: Task Planning & Decomposition**: Analyzes the user's objective (e.g., *"Research Celo DeFi protocols"*) and breaks it down into structured research, querying, verification, and synthesis phases.
2. **Step 2: External Data Querying (DefiLlama)**: Queries live protocol metrics from DefiLlama's public API to identify top active Celo protocols by Total Value Locked (TVL), categories, and official endpoints.
3. **Step 3: Untrusted x402 Challenge Probing & User Approval Gate**:
   * Sends an **unpaid probe** to the Cencori x402 gateway with a valid request payload to capture the live HTTP 402 Payment Required challenge without attaching payment authorizations.
   * Validates the untrusted challenge against local security policy (network, token address, recipient address, and max price).
   * Halts and requests **explicit interactive approval** from the user (`[y/N]`).
   * If approved and enabled (`ENABLE_PAID_EXECUTION=true`), dispatches `@celo/buy curl` to execute the payment and inference.
4. **Step 4: Report Synthesis & Fallback**:
   * If paid inference succeeds, parses the OpenAI-compatible response and embeds an *"AI Market & Liquidity Assessment"* section into the report.
   * If payment is declined, disabled, or the live probe is unreachable, completes the report cleanly using DefiLlama data alone at zero cost.

---

## 3. `@celo/buy` & Cencori x402 Integration

TaskPilot AI integrates with the official `@celo/buy@0.8.3` CLI to execute HTTP 402 stablecoin payments on Celo Mainnet:

* **Inference Gateway**: `https://gateway.usebuy.ai/cencori/v1/chat/completions`
* **Model**: `maximo-atlas-1.3` (closed beta)
* **Gas Sponsorship**: Settlement gas on Celo is sponsored by the x402 facilitator; the buyer wallet only requires USDC (no CELO balance required for payments).
* **CLI Execution Safety**:
  * Avoids shell string interpolation by passing arguments as an explicit array directly to Node's `child_process.spawn`.
  * Writes request payloads to a secure temporary file in the OS temp directory and passes `--data-file <path>` to prevent PowerShell UTF-8 BOM corruption and argument splitting.
  * Guarantees temporary file removal inside a `finally` block.
  * Invokes `@celo/buy curl` with `--token USDC` and `--max-amount 0.01`.

---

## 4. Safety Controls & Policy Enforcement

To ensure autonomous execution never results in unexpected loss of funds or unauthorized transactions, TaskPilot AI implements defense-in-depth safety controls:

| Control | Implementation | Guarantee |
| :--- | :--- | :--- |
| **$0.01 USDC Spending Cap** | Dual-layer: checked in code ($\le 10,000$ atomic units) before CLI invocation, and passed as `--max-amount 0.01` to `@celo/buy`. | Prevents decimal unit mistakes and limits the configured maximum payment to 0.01 USDC per invocation. |
| **Challenge Validation** | Verifies network (`celo`), token (`0xcebA9300f2b948710d2653dD7B07f33A8B32118C`), recipient (`0x20faAca5F980E29639A0FCC6dcA6988E18ed333B`), and price before asking for approval. | Rejects malformed quotes, wrong assets, or unverified recipient addresses before user prompt. |
| **Explicit Approval Gate** | Terminal prompt requiring explicit `"y"` or `"yes"` confirmation from the user. | Payments can never execute silently in the background. |
| **Disabled by Default** | `ENABLE_PAID_EXECUTION=true` environment flag required for live payments. | Default development and testing runs operate in dry-run mode without moving funds. |
| **Graceful Fallback** | Non-200 responses, network timeouts, probe errors, or declined approvals fall back to DefiLlama data alone. | Research reports always complete successfully even when paid services are unavailable. |
| **Credential Protection** | Private keys are never accepted as CLI flags, logged, or written to temporary files; keys reside in the OS credential manager. | Zero secret exposure in process lists, shell history, or logs. |

---

## 5. Installation, Configuration & Testing

### Prerequisites
* **Node.js**: v20.x or newer
* **npm**: v10.x or newer

### Installation
```bash
git clone https://github.com/Alafedoyinsola/taskpilot-ai.git
cd taskpilot-ai
npm install
```

### Configuration
Copy the sample environment file:
```bash
cp .env.example .env
```
By default, `ENABLE_PAID_EXECUTION` is omitted or set to `false`, keeping paid execution disabled.

### TypeScript Compilation Check
Verify type integrity with zero errors:
```bash
npx tsc --noEmit
```

### Running Offline Unit Tests
Run the entire offline test suite (83 tests across 5 test suites, 100% mocked, $0 spent):
```bash
npx tsx --test src/agent/executor.test.ts src/services/cencoriService.test.ts src/services/quoteService.test.ts src/config/attribution.test.ts src/payments/sepoliaAttributionTest.test.ts
```

Test coverage includes:
* **Executor**: 30 tests covering step planning, probe error handling, approval decline, disabled flag, and report synthesis.
* **Cencori Service**: 27 tests covering request construction, prompt generation, quote caps, response parsing, and error envelopes.
* **Sepolia Attribution Guards**: 15 tests covering address matching, hex formatting, and gas threshold validation.
* **Quote Service**: 7 tests covering 402 challenge parsing, amount math, and recipient validation.
* **Attribution**: 4 tests covering ERC-8021 metadata encoding and decoding via `@celo/attribution-tags`.

### Running the Interactive Agent
Run the interactive terminal interface:
```bash
npm start
# or: npx tsx src/index.ts
```
1. Enter your research objective (e.g., *"Research Celo DeFi protocols"*).
2. The agent plans 4 steps, fetches live DefiLlama data, probes Cencori, and requests approval:
   ```text
   Do you authorize TaskPilot to spend 0.01 USDC for this service? [y/N]:
   ```
3. Enter `y` to authorize or `n` to decline. In default mode, spend authorization is recorded in dry-run mode and the report completes.

### Optional: Enabling Live Paid Execution
To enable real mainnet inference calls:
1. Ensure your local `@celo/buy` profile has a small USDC balance on Celo Mainnet:
   ```bash
   npx --yes @celo/buy@0.8.3 whoami
   ```
2. Set the environment variable:
   ```env
   ENABLE_PAID_EXECUTION=true
   ```
3. Run `npm start` and enter `y` when prompted for approval.

---

## 6. Attribution & Ecosystem Integration

* **Hackathon**: Celo — Agents on Open Rails
* **Track**: Build with buy
* **Assigned Attribution Tag**: `celo_c386b0979578` (Loops House)
* **Standard**: ERC-8021 metadata suffix (Schema 0) encoded via `@celo/attribution-tags`.

### Attribution Architecture & Limitations
* **Unit-Tested Encoding**: Byte-level ERC-8021 suffix formatting is unit-tested in `src/config/attribution.test.ts` and `src/payments/sepoliaAttributionTest.test.ts`, confirming valid suffix bytes (`0x63656c6f5f633338366230393739353738110080218021...`) and lossless decoding back to tag `celo_c386b0979578`.
* **Facilitator-Relayed Payment Limitation**: In `@celo/buy@0.8.3`, payment settlement is executed via off-chain EIP-3009 authorizations (`transferWithAuthorization`) relayed to the facilitator. Because the facilitator constructs and broadcasts the settlement transaction on-chain, client-side calldata suffix injection is governed by the facilitator relay service. While TaskPilot AI implements and tests ERC-8021 suffix encoding for direct on-chain contract transactions, confirmed on-chain attribution for facilitator-relayed payments remains subject to facilitator-level support.

---

## 7. License

MIT License. See [LICENSE](LICENSE) for details.
