import * as http from "node:http";
import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { createPlan, type TaskPlan } from "./agent/planner.ts";
import { fetchCeloDefiProjects, type RealResearchResult } from "./services/researchService.ts";

/**
 * TaskPilot AI - Browser-Based Demo Web Server
 *
 * Implemented using Node.js built-in `node:http` module (strictly zero new dependencies).
 * Provides:
 *  - GET  /             : Polished, responsive, self-contained single-page web UI
 *  - GET  /api/health   : Server status, configuration metadata, and safety assurances
 *  - POST /api/plan     : Deterministic 4-step task planning via createPlan()
 *  - POST /api/research : 4-step task planning + live Celo DeFi research via fetchCeloDefiProjects()
 *
 * STRICT SAFETY BOUNDARY:
 *  - Strictly free and read-only.
 *  - Does NOT call executePlan() or executeCencoriInference().
 *  - Does NOT make paid x402 requests or require wallet credentials.
 *  - Does NOT access or expose any .env secrets.
 */

const PORT = Number(process.env.PORT) || 3000;

// Maximum allowed request body size (16 KB) to prevent memory exhaustion
const MAX_BODY_BYTES = 16 * 1024;

/**
 * Embedded single-page application HTML/CSS/JS.
 * Pure modern HTML5 + CSS + vanilla JavaScript with zero external CDN dependencies.
 */
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TaskPilot AI — Celo Ecosystem Research & Task Planning</title>
  <style>
    :root {
      --bg: #0B0F19;
      --surface: #111827;
      --surface-card: #1F2937;
      --surface-hover: #263345;
      --border: #374151;
      --border-accent: rgba(53, 208, 127, 0.35);
      --celo-green: #35D07F;
      --celo-glow: rgba(53, 208, 127, 0.15);
      --celo-dark-green: #1F8A52;
      --accent-cyan: #38BDF8;
      --accent-amber: #F59E0B;
      --accent-rose: #F43F5E;
      --text-main: #F9FAFB;
      --text-muted: #9CA3AF;
      --text-dim: #6B7280;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font);
      min-height: 100vh;
      line-height: 1.5;
      padding: 24px 16px;
      -webkit-font-smoothing: antialiased;
    }

    .container {
      max-width: 920px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    /* Header */
    header {
      background: linear-gradient(180deg, #162032 0%, var(--surface) 100%);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px 28px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }

    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: radial-gradient(circle at 30% 30%, #35D07F, #0E7490);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 15px var(--celo-glow);
    }

    .logo-icon svg {
      width: 22px;
      height: 22px;
      fill: #ffffff;
    }

    h1 {
      font-size: 1.65rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #FFFFFF 40%, var(--celo-green) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
      margin-bottom: 16px;
    }

    .badges-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.78rem;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 20px;
      background: var(--surface-card);
      border: 1px solid var(--border);
      color: var(--text-main);
      text-decoration: none;
    }

    .badge-green {
      background: rgba(53, 208, 127, 0.12);
      border-color: rgba(53, 208, 127, 0.3);
      color: #35D07F;
    }

    .badge-cyan {
      background: rgba(56, 189, 248, 0.12);
      border-color: rgba(56, 189, 248, 0.3);
      color: #38BDF8;
    }

    .badge-amber {
      background: rgba(245, 158, 11, 0.12);
      border-color: rgba(245, 158, 11, 0.3);
      color: #FBBF24;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background-color: var(--celo-green);
      box-shadow: 0 0 8px var(--celo-green);
      display: inline-block;
    }

    /* Safety Notice Box */
    .notice-box {
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 12px;
      padding: 16px 20px;
      display: flex;
      gap: 12px;
      font-size: 0.88rem;
      line-height: 1.45;
    }

    .notice-icon {
      font-size: 1.25rem;
      line-height: 1;
      flex-shrink: 0;
    }

    .notice-box strong {
      color: #FCD34D;
    }

    /* Main Cards */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 24px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }

    .card-title {
      font-size: 1.15rem;
      font-weight: 600;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .card-title .step-pill {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 2px 8px;
      background: var(--celo-glow);
      color: var(--celo-green);
      border: 1px solid var(--border-accent);
      border-radius: 12px;
    }

    /* Input Section */
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 16px;
    }

    label {
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-muted);
    }

    textarea {
      width: 100%;
      background: #090D15;
      border: 1px solid var(--border);
      border-radius: 10px;
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.95rem;
      padding: 14px 16px;
      resize: vertical;
      min-height: 80px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    textarea:focus {
      border-color: var(--celo-green);
      box-shadow: 0 0 0 3px var(--celo-glow);
    }

    .suggestions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.82rem;
      color: var(--text-dim);
    }

    .suggestion-btn {
      background: var(--surface-card);
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .suggestion-btn:hover {
      background: var(--surface-hover);
      color: var(--text-main);
      border-color: var(--celo-green);
    }

    /* Action Buttons */
    .actions-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      font-size: 0.92rem;
      font-weight: 600;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s ease-in-out;
      font-family: inherit;
    }

    .btn-primary {
      background: var(--celo-green);
      color: #071E12;
      box-shadow: 0 4px 14px rgba(53, 208, 127, 0.3);
    }

    .btn-primary:hover:not(:disabled) {
      background: #40DF8C;
      box-shadow: 0 6px 18px rgba(53, 208, 127, 0.45);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: var(--surface-card);
      border-color: var(--border);
      color: var(--text-main);
    }

    .btn-secondary:hover:not(:disabled) {
      background: var(--surface-hover);
      border-color: var(--text-muted);
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }

    /* Loading State */
    .loading-state {
      display: none;
      align-items: center;
      gap: 14px;
      padding: 16px 20px;
      background: rgba(56, 189, 248, 0.08);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 10px;
      margin-top: 14px;
    }

    .spinner {
      width: 22px;
      height: 22px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: var(--accent-cyan);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      font-size: 0.88rem;
      color: var(--text-main);
    }

    /* Error Banner */
    .error-banner {
      display: none;
      background: rgba(244, 63, 94, 0.1);
      border: 1px solid rgba(244, 63, 94, 0.35);
      border-radius: 10px;
      padding: 14px 18px;
      color: #FDA4AF;
      font-size: 0.88rem;
      line-height: 1.4;
      margin-top: 14px;
    }

    /* Plan Visualizer */
    .plan-section {
      display: none;
    }

    .plan-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }

    .step-card {
      background: var(--surface-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
      transition: border-color 0.2s;
    }

    .step-card:hover {
      border-color: var(--border-accent);
    }

    .step-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .step-number {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--celo-green);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .service-tag {
      font-size: 0.7rem;
      padding: 2px 7px;
      border-radius: 4px;
      font-weight: 600;
      text-transform: uppercase;
      background: #111827;
      border: 1px solid var(--border);
      color: var(--accent-cyan);
    }

    .step-title {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-main);
    }

    .step-desc {
      font-size: 0.82rem;
      color: var(--text-muted);
      line-height: 1.4;
    }

    /* Research Results Section */
    .results-section {
      display: none;
    }

    .results-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 0.82rem;
      color: var(--text-muted);
      margin-bottom: 16px;
      padding: 10px 14px;
      background: #090D15;
      border-radius: 8px;
      border: 1px solid var(--border);
    }

    .results-meta a {
      color: var(--accent-cyan);
      text-decoration: none;
    }

    .results-meta a:hover {
      text-decoration: underline;
    }

    .protocols-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }

    .protocol-card {
      background: var(--surface-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
      transition: transform 0.2s, border-color 0.2s;
    }

    .protocol-card:hover {
      transform: translateY(-2px);
      border-color: var(--border-accent);
    }

    .protocol-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .protocol-name {
      font-size: 1.05rem;
      font-weight: 700;
      color: #FFFFFF;
    }

    .protocol-rank {
      font-size: 0.72rem;
      font-weight: 700;
      background: #111827;
      color: var(--celo-green);
      padding: 2px 7px;
      border-radius: 12px;
      border: 1px solid var(--border-accent);
    }

    .category-badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 6px;
      background: rgba(56, 189, 248, 0.12);
      color: var(--accent-cyan);
      border: 1px solid rgba(56, 189, 248, 0.25);
    }

    .tvl-block {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tvl-label {
      font-size: 0.72rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .tvl-amount {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--celo-green);
      letter-spacing: -0.01em;
    }

    .protocol-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--accent-cyan);
      text-decoration: none;
      margin-top: 4px;
    }

    .protocol-link:hover {
      text-decoration: underline;
    }

    .summary-box {
      background: #090D15;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 20px;
      font-size: 0.88rem;
      color: var(--text-main);
      line-height: 1.5;
    }

    .summary-box pre {
      white-space: pre-wrap;
      font-family: inherit;
    }

    /* Footer */
    footer {
      text-align: center;
      padding: 20px 0;
      font-size: 0.82rem;
      color: var(--text-dim);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    footer a {
      color: var(--text-muted);
      text-decoration: none;
    }

    footer a:hover {
      color: var(--celo-green);
    }

    @media (max-width: 640px) {
      body {
        padding: 12px 8px;
      }
      header {
        padding: 18px 16px;
      }
      .card {
        padding: 18px 16px;
      }
      .actions-row {
        flex-direction: column;
        align-items: stretch;
      }
      .btn {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="header-top">
        <div class="brand">
          <div class="logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <h1>TaskPilot AI</h1>
            <div class="subtitle">Autonomous Task Planner & Celo Ecosystem Research Agent</div>
          </div>
        </div>
      </div>
      <div class="badges-row">
        <span class="badge badge-green">
          <span class="status-dot"></span>
          Celo Mainnet (42220)
        </span>
        <span class="badge badge-cyan">
          ERC-8004 Agent ID: 9964
        </span>
        <span class="badge badge-cyan">
          Registry: 0x8004...a432
        </span>
        <span class="badge badge-amber">
          Browser Demo: Free & Read-Only
        </span>
      </div>
    </header>

    <!-- Mandatory Safety Disclosure -->
    <div class="notice-box" role="region" aria-label="Demo Safety Notice">
      <div class="notice-icon">🛡️</div>
      <div>
        <strong>Deterministic Planning & Read-Only DeFi Research:</strong>
        This interactive browser demo generates deterministic 4-step execution plans and fetches live, verified Celo DeFi protocol statistics via DefiLlama's public API. Paid x402 inference, autonomous wallet signing, and USDC micropayments are <strong>strictly disabled</strong> in this web interface. No private keys, wallet connections, or paid transactions are performed.
      </div>
    </div>

    <!-- Task Input Card -->
    <section class="card">
      <div class="card-header">
        <h2 class="card-title">
          <span>Task Objective</span>
          <span class="step-pill">DeFi Research</span>
        </h2>
      </div>

      <div class="input-group">
        <label for="task-input">What task would you like TaskPilot AI to analyze?</label>
        <textarea
          id="task-input"
          placeholder="e.g., Research top Celo DeFi protocols, category distribution, and total value locked"
          rows="3"
        >Research top Celo DeFi protocols by TVL</textarea>
      </div>

      <div class="suggestions">
        <span>Suggested:</span>
        <button type="button" class="suggestion-btn" onclick="setTask('Research top Celo DeFi protocols by TVL')">Top DeFi Protocols</button>
        <button type="button" class="suggestion-btn" onclick="setTask('Analyze Celo DEXes and liquid staking platforms')">DEXes & Staking</button>
        <button type="button" class="suggestion-btn" onclick="setTask('Evaluate active Celo DeFi ecosystem protocols and liquidity')">Liquidity & Yield</button>
      </div>

      <div class="actions-row" style="margin-top: 18px;">
        <button type="button" id="btn-research" class="btn btn-primary" onclick="runAction('research')">
          <span id="btn-research-text">Run Research</span>
        </button>
        <button type="button" id="btn-plan" class="btn btn-secondary" onclick="runAction('plan')">
          <span>Generate Plan Only</span>
        </button>
      </div>

      <!-- Loading Indicator -->
      <div id="loading-indicator" class="loading-state" role="status" aria-live="polite">
        <div class="spinner"></div>
        <div id="loading-text" class="loading-text">Decomposing task and connecting to Celo DeFi data sources...</div>
      </div>

      <!-- Error Banner -->
      <div id="error-banner" class="error-banner" role="alert"></div>
    </section>

    <!-- 4-Step Plan Visualizer -->
    <section id="plan-section" class="card plan-section" aria-live="polite">
      <div class="card-header">
        <h2 class="card-title">
          <span>Decomposed Task Plan</span>
          <span class="step-pill" id="plan-step-count">4 Steps</span>
        </h2>
        <span class="badge badge-green">Deterministic Breakdown</span>
      </div>
      <div id="plan-grid" class="plan-grid"></div>
    </section>

    <!-- Research Results Section -->
    <section id="results-section" class="card results-section" aria-live="polite">
      <div class="card-header">
        <h2 class="card-title">
          <span>Celo DeFi Protocol Research Results</span>
          <span class="step-pill">Verified Live Data</span>
        </h2>
        <span class="badge badge-cyan" id="results-count-badge">5 Protocols Found</span>
      </div>

      <div class="results-meta">
        <div>
          <strong>Data Source:</strong>
          <a href="https://defillama.com/chain/Celo" target="_blank" rel="noopener noreferrer">DefiLlama Public Protocols API ↗</a>
        </div>
        <div id="results-timestamp"></div>
      </div>

      <div id="protocols-grid" class="protocols-grid"></div>

      <div class="summary-box">
        <strong style="color: var(--celo-green); display: block; margin-bottom: 6px;">Synthesized Findings:</strong>
        <pre id="summary-text"></pre>
      </div>
    </section>

    <!-- Footer -->
    <footer>
      <div>
        <strong>TaskPilot AI</strong> • Celo Hackathon 2026: Build with Buy Track
      </div>
      <div>
        Registered ERC-8004 Agent ID: <code>9964</code> | Network: Celo Mainnet (Chain ID 42220)
      </div>
      <div style="margin-top: 4px;">
        To execute the full agent CLI with user-authorized x402 payment: <code>npm start</code>
      </div>
    </footer>
  </div>

  <script>
    function setTask(text) {
      const input = document.getElementById("task-input");
      if (input) {
        input.value = text;
        input.focus();
      }
    }

    function showError(message) {
      const banner = document.getElementById("error-banner");
      if (banner) {
        banner.textContent = message;
        banner.style.display = "block";
      }
    }

    function clearError() {
      const banner = document.getElementById("error-banner");
      if (banner) {
        banner.textContent = "";
        banner.style.display = "none";
      }
    }

    function setLoading(isLoading, text) {
      const loader = document.getElementById("loading-indicator");
      const loadText = document.getElementById("loading-text");
      const btnResearch = document.getElementById("btn-research");
      const btnPlan = document.getElementById("btn-plan");

      if (loader && loadText) {
        loadText.textContent = text || "Processing...";
        loader.style.display = isLoading ? "flex" : "none";
      }
      if (btnResearch) btnResearch.disabled = isLoading;
      if (btnPlan) btnPlan.disabled = isLoading;
    }

    function renderPlan(plan) {
      const planSection = document.getElementById("plan-section");
      const planGrid = document.getElementById("plan-grid");
      const planCount = document.getElementById("plan-step-count");

      if (!planSection || !planGrid || !plan) return;

      planCount.textContent = (plan.totalSteps || 0) + " Steps";
      planGrid.innerHTML = "";

      plan.steps.forEach(function(step) {
        const card = document.createElement("div");
        card.className = "step-card";

        const header = document.createElement("div");
        header.className = "step-header";

        const num = document.createElement("span");
        num.className = "step-number";
        num.textContent = "Step " + step.stepNumber;

        const tag = document.createElement("span");
        tag.className = "service-tag";
        tag.textContent = step.serviceType;

        header.appendChild(num);
        header.appendChild(tag);

        const title = document.createElement("div");
        title.className = "step-title";
        title.textContent = step.title;

        const desc = document.createElement("div");
        desc.className = "step-desc";
        desc.textContent = step.description;

        card.appendChild(header);
        card.appendChild(title);
        card.appendChild(desc);

        planGrid.appendChild(card);
      });

      planSection.style.display = "block";
    }

    function renderResearch(research) {
      const resultsSection = document.getElementById("results-section");
      const protocolsGrid = document.getElementById("protocols-grid");
      const summaryText = document.getElementById("summary-text");
      const timestampEl = document.getElementById("results-timestamp");
      const countBadge = document.getElementById("results-count-badge");

      if (!resultsSection || !protocolsGrid || !research) return;

      protocolsGrid.innerHTML = "";
      const protocols = research.protocols || [];
      countBadge.textContent = protocols.length + " Protocols Found";

      if (research.fetchedAt && timestampEl) {
        try {
          const d = new Date(research.fetchedAt);
          timestampEl.textContent = "Fetched: " + d.toLocaleTimeString() + " (" + d.toLocaleDateString() + ")";
        } catch {
          timestampEl.textContent = "Fetched: " + research.fetchedAt;
        }
      }

      protocols.forEach(function(p, idx) {
        const card = document.createElement("div");
        card.className = "protocol-card";

        const header = document.createElement("div");
        header.className = "protocol-header";

        const name = document.createElement("div");
        name.className = "protocol-name";
        name.textContent = p.name;

        const rank = document.createElement("span");
        rank.className = "protocol-rank";
        rank.textContent = "#" + (idx + 1);

        header.appendChild(name);
        header.appendChild(rank);

        const category = document.createElement("span");
        category.className = "category-badge";
        category.textContent = p.category;

        const tvlBlock = document.createElement("div");
        tvlBlock.className = "tvl-block";

        const tvlLabel = document.createElement("span");
        tvlLabel.className = "tvl-label";
        tvlLabel.textContent = "Celo TVL (USD)";

        const tvlAmount = document.createElement("span");
        tvlAmount.className = "tvl-amount";
        tvlAmount.textContent = "$" + Number(p.celoTvlUsd || 0).toLocaleString();

        tvlBlock.appendChild(tvlLabel);
        tvlBlock.appendChild(tvlAmount);

        card.appendChild(header);
        card.appendChild(category);
        card.appendChild(tvlBlock);

        if (p.url) {
          const link = document.createElement("a");
          link.className = "protocol-link";
          link.href = p.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Visit Official Site ↗";
          card.appendChild(link);
        }

        protocolsGrid.appendChild(card);
      });

      if (summaryText) {
        summaryText.textContent = research.summary || "No summary provided.";
      }

      resultsSection.style.display = "block";
    }

    async function runAction(action) {
      clearError();
      const input = document.getElementById("task-input");
      const task = input ? input.value.trim() : "";

      if (!task) {
        showError("Please enter a task description before running.");
        return;
      }

      const resultsSection = document.getElementById("results-section");

      if (action === "plan") {
        setLoading(true, "Generating deterministic 4-step plan...");
        if (resultsSection) resultsSection.style.display = "none";

        try {
          const res = await fetch("/api/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: task })
          });

          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || "Failed to generate plan.");
          }

          renderPlan(data.plan);
        } catch (err) {
          showError("Plan generation failed: " + (err.message || String(err)));
        } finally {
          setLoading(false);
        }
      } else if (action === "research") {
        setLoading(true, "Decomposing task & fetching live Celo DeFi statistics from DefiLlama...");

        try {
          const res = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task: task })
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || "Research query failed.");
          }

          if (data.plan) {
            renderPlan(data.plan);
          }

          if (data.research) {
            renderResearch(data.research);
          }

          if (!data.success && data.error) {
            showError("Research service note: " + data.error);
          }
        } catch (err) {
          showError("Research execution failed: " + (err.message || String(err)));
        } finally {
          setLoading(false);
        }
      }
    }
  </script>
</body>
</html>
`;

/**
 * Safely parses JSON request body with a hard size cap.
 */
function parseJsonBody(req: http.IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    let byteLength = 0;
    let exceeded = false;

    req.on("data", (chunk: Buffer) => {
      if (exceeded) return;
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        exceeded = true;
        reject(new Error("Payload too large: request body exceeds 16KB limit."));
        return;
      }
      body += chunk.toString("utf-8");
    });

    req.on("end", () => {
      if (exceeded) return;
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed);
      } catch {
        reject(new Error("Malformed JSON: invalid syntax in request body."));
      }
    });

    req.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Sends a structured JSON HTTP response with security headers.
 */
function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const json = JSON.stringify(data);
  const buf = Buffer.from(json, "utf-8");
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(buf);
}

/**
 * Sends the embedded HTML single-page application with security headers.
 */
function sendHtml(res: http.ServerResponse, html: string): void {
  const buf = Buffer.from(html, "utf-8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buf.length,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  res.end(buf);
}

/**
 * Core HTTP Request Handler for TaskPilot AI Browser Demo.
 */
export async function requestHandler(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const method = req.method?.toUpperCase() || "GET";
  const urlPath = (req.url?.split("?")[0] || "/").toLowerCase();

  // Root UI endpoint
  if (method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    sendHtml(res, HTML_CONTENT);
    return;
  }

  // Read-only Health & Status API
  if (method === "GET" && urlPath === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
      service: "taskpilot-browser-demo",
      network: "celo-mainnet",
      chainId: 42220,
      agentId: 9964,
      paidExecution: false,
      readOnly: true,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // POST /api/plan - Deterministic task planning
  if (method === "POST" && urlPath === "/api/plan") {
    try {
      const body = (await parseJsonBody(req)) as Record<string, unknown>;
      const task = typeof body?.task === "string" ? body.task.trim() : "";

      if (!task) {
        sendJson(res, 400, {
          success: false,
          error: "Task description must be a non-empty string.",
        });
        return;
      }

      if (task.length > 500) {
        sendJson(res, 400, {
          success: false,
          error: "Task description is too long (maximum 500 characters).",
        });
        return;
      }

      const plan: TaskPlan = createPlan(task);
      sendJson(res, 200, {
        success: true,
        plan,
      });
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Invalid request.";
      const status = message.includes("too large") ? 413 : 400;
      sendJson(res, status, { success: false, error: message });
      return;
    }
  }

  // POST /api/research - Deterministic task planning + Live Celo DeFi research
  if (method === "POST" && urlPath === "/api/research") {
    try {
      const body = (await parseJsonBody(req)) as Record<string, unknown>;
      const task = typeof body?.task === "string" ? body.task.trim() : "";

      if (!task) {
        sendJson(res, 400, {
          success: false,
          error: "Task description must be a non-empty string.",
        });
        return;
      }

      if (task.length > 500) {
        sendJson(res, 400, {
          success: false,
          error: "Task description is too long (maximum 500 characters).",
        });
        return;
      }

      // Step 1: Create 4-step plan
      const plan: TaskPlan = createPlan(task);

      // Step 2: Fetch verified live DeFi data from DefiLlama (timeout 8000ms)
      const research: RealResearchResult = await fetchCeloDefiProjects(8000);

      sendJson(res, 200, {
        success: research.success,
        plan,
        research,
        error: research.error,
      });
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error.";
      const status = message.includes("too large") ? 413 : 400;
      sendJson(res, status, { success: false, error: message });
      return;
    }
  }

  // Reject unsupported methods on known API endpoints
  if (
    urlPath === "/api/plan" ||
    urlPath === "/api/research" ||
    urlPath === "/api/health" ||
    urlPath === "/"
  ) {
    res.setHeader("Allow", urlPath.startsWith("/api/health") || urlPath === "/" ? "GET" : "POST");
    sendJson(res, 405, {
      success: false,
      error: `Method ${method} not allowed for endpoint ${urlPath}.`,
    });
    return;
  }

  // 404 for any other route
  sendJson(res, 404, {
    success: false,
    error: `Endpoint not found: ${urlPath}`,
  });
}

/**
 * Factory function creating an HTTP server instance using Node.js built-in `http`.
 */
export function createServer(): http.Server {
  return http.createServer((req, res) => {
    requestHandler(req, res).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "Unexpected internal error.";
      if (!res.headersSent) {
        sendJson(res, 500, { success: false, error: message });
      }
    });
  });
}

/**
 * Starts the HTTP server on the configured port.
 */
export function startServer(port: number = PORT): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(port, () => {
      console.log("==========================================");
      console.log("   TaskPilot AI — Browser Demo Server     ");
      console.log("==========================================");
      console.log(`  Local URL      : http://localhost:${port}`);
      console.log("  Network        : Celo Mainnet (42220)");
      console.log("  Agent ID       : 9964 (ERC-8004 Canonical)");
      console.log("  Mode           : Free & Read-Only Demo");
      console.log("  Paid Execution : DISABLED (Safety Enforced)");
      console.log("==========================================\n");
      resolve(server);
    });
    server.on("error", reject);
  });
}

// Check if this file is executed directly (via tsx or node)
const currentFilePath = fileURLToPath(import.meta.url);
const invokedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isMain = invokedFilePath === path.resolve(currentFilePath);

if (isMain) {
  startServer().catch((error: unknown) => {
    console.error("Failed to start TaskPilot demo server:", error);
    process.exit(1);
  });
}
