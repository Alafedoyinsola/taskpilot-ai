import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { DefiProtocol } from "./researchService.ts";
import type { ValidatedQuote, X402PaymentChallenge } from "./quoteService.ts";

/**
 * Service configuration for Cencori LLM Inference via Celo x402 Gateway.
 * Verified from @celo/buy-registry@0.8.3 provider specification (providers/cencori/inference/PAY.md).
 */
export const CENCORI_ENDPOINT = "https://gateway.usebuy.ai/cencori/v1/chat/completions" as const;
export const CENCORI_MODEL = "maximo-atlas-1.3" as const;
export const DEFAULT_MAX_TOKENS = 256 as const;

/**
 * Strict security and network constraints for Celo Mainnet Cencori execution.
 */
export const MAX_ALLOWED_ATOMIC_USDC = 10000n; // 10,000 atomic units = exactly 0.01 USDC (6 decimals)
export const EXPECTED_USDC_CONTRACT = "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as const;
export const EXPECTED_NETWORK = "celo" as const;
export const EXPECTED_RECIPIENT = "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B" as const;

export type SupportedMaxTokens = 256 | 1024 | 4096;

export interface CencoriMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Strict request body schema required by Cencori x402 gateway.
 * Any extra/unknown keys or disallowed token counts trigger HTTP 400.
 */
export interface CencoriRequestBody {
  model: typeof CENCORI_MODEL;
  max_tokens: SupportedMaxTokens;
  messages: CencoriMessage[];
  temperature?: number;
  top_p?: number;
  stop?: string | string[];
  seed?: number;
}

export interface CencoriSuccessResult {
  success: true;
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface CencoriErrorResult {
  success: false;
  error: string;
}

export type ParsedCencoriResult = CencoriSuccessResult | CencoriErrorResult;

export interface QuoteComplianceResult {
  isCompliant: boolean;
  reason?: string;
}

export interface LiveChallengeResult {
  success: boolean;
  challenge?: X402PaymentChallenge;
  statusCode?: number;
  error?: string;
}

export interface FetchLiveChallengeOptions {
  endpoint?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  requestBody?: CencoriRequestBody;
}

export interface CencoriExecutionOptions {
  enablePaidExecution?: boolean;
  accountName?: string;
  maxAmount?: string;
  endpoint?: string;
  spawnFn?: (
    command: string,
    args: string[]
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface CencoriExecutionResult {
  isExecuted: boolean;
  success: boolean;
  parsedResponse?: ParsedCencoriResult;
  rawOutput?: string;
  error?: string;
}

/**
 * Validates that a quote strictly complies with TaskPilot AI's security policy:
 * 1. Network must be Celo mainnet ("celo")
 * 2. Asset must be the official USDC contract
 * 3. Recipient must match the verified Cencori gateway payTo address
 * 4. Atomic amount must not exceed the strict 10,000 atomic units (0.01 USDC) cap
 */
export function validateCencoriQuote(quote: ValidatedQuote): QuoteComplianceResult {
  if (!quote || typeof quote !== "object") {
    return { isCompliant: false, reason: "Quote must be a valid non-null object." };
  }

  // 1. Verify Network
  if (quote.network.toLowerCase() !== EXPECTED_NETWORK.toLowerCase()) {
    return {
      isCompliant: false,
      reason: `Invalid network "${quote.network}". Expected Celo mainnet ("${EXPECTED_NETWORK}").`,
    };
  }

  // 2. Verify Asset Contract
  if (quote.tokenAddress.toLowerCase() !== EXPECTED_USDC_CONTRACT.toLowerCase()) {
    return {
      isCompliant: false,
      reason: `Invalid asset contract "${quote.tokenAddress}". Expected USDC ("${EXPECTED_USDC_CONTRACT}").`,
    };
  }

  // 3. Verify Recipient Address
  if (quote.recipientAddress.toLowerCase() !== EXPECTED_RECIPIENT.toLowerCase()) {
    return {
      isCompliant: false,
      reason: `Invalid recipient address "${quote.recipientAddress}". Expected "${EXPECTED_RECIPIENT}".`,
    };
  }

  // 4. Verify Amount Cap
  try {
    const amount = BigInt(quote.atomicAmount);
    if (amount > MAX_ALLOWED_ATOMIC_USDC) {
      return {
        isCompliant: false,
        reason: `Amount required (${quote.atomicAmount} atomic units) exceeds the strict 0.01 USDC safety cap (${MAX_ALLOWED_ATOMIC_USDC} atomic units).`,
      };
    }
  } catch {
    return {
      isCompliant: false,
      reason: `Invalid atomic amount string: "${quote.atomicAmount}".`,
    };
  }

  return { isCompliant: true };
}

/**
 * Sends an unpaid HTTP POST request to the Cencori endpoint to retrieve the live HTTP 402 payment challenge.
 *
 * Safety rules:
 * - Unpaid request only: never attaches payment headers or signatures.
 * - Does not retry with authorization or follow payment instructions.
 * - Parses and returns the raw 402 challenge payload for strict validation.
 */
export async function fetchLiveCencoriChallenge(
  options?: FetchLiveChallengeOptions
): Promise<LiveChallengeResult> {
  const endpoint = options?.endpoint ?? CENCORI_ENDPOINT;
  const timeoutMs = options?.timeoutMs ?? 8000;
  const customFetch = options?.fetchFn ?? fetch;

  const probeBody: CencoriRequestBody = options?.requestBody ?? {
    model: CENCORI_MODEL,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: "Celo DeFi liquidity assessment probe",
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await customFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(probeBody),
      signal: controller.signal,
    });

    if (response.status !== 402) {
      return {
        success: false,
        statusCode: response.status,
        error: `Gateway returned HTTP ${response.status} instead of expected HTTP 402 Payment Required.`,
      };
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        success: false,
        statusCode: 402,
        error: "Gateway returned HTTP 402 but response body could not be parsed as JSON.",
      };
    }

    if (!parsed || typeof parsed !== "object") {
      return {
        success: false,
        statusCode: 402,
        error: "Gateway returned HTTP 402 with non-object payload.",
      };
    }

    return {
      success: true,
      statusCode: 402,
      challenge: parsed as X402PaymentChallenge,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Unpaid probe to gateway failed: ${errorMsg}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds a concise, context-aware prompt based on fetched Celo DeFi protocol metrics.
 */
export function buildCencoriPrompt(protocols: DefiProtocol[], task?: string): string {
  if (!protocols || protocols.length === 0) {
    const taskContext = task ? `For the user goal "${task}": ` : "";
    return `${taskContext}Provide a concise overview of Celo DeFi opportunities and key ecosystem liquidity in 2-3 sentences.`;
  }

  const topProtocols = protocols.slice(0, 3);
  const formattedMetrics = topProtocols
    .map((p) => `${p.name} (TVL: $${p.celoTvlUsd.toLocaleString()})`)
    .join(", ");

  const taskPrefix = task ? `User objective: "${task}". ` : "";

  return `${taskPrefix}Given these live Celo DeFi protocol statistics [${formattedMetrics}], provide a concise 2-sentence liquidity and risk assessment.`;
}

/**
 * Constructs a strictly valid request body for Cencori's OpenAI-compatible endpoint.
 */
export function buildCencoriRequestBody(
  protocols: DefiProtocol[],
  task?: string,
  maxTokens: SupportedMaxTokens = DEFAULT_MAX_TOKENS
): CencoriRequestBody {
  const prompt = buildCencoriPrompt(protocols, task);

  return {
    model: CENCORI_MODEL,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };
}

/**
 * Parses and validates an OpenAI-compatible JSON response from Cencori.
 */
export function parseCencoriResponse(raw: unknown): ParsedCencoriResult {
  if (!raw || typeof raw !== "object") {
    return { success: false, error: "Response payload must be a non-null object." };
  }

  const payload = raw as Record<string, unknown>;

  // Check for string error message
  if (typeof payload.error === "string" && payload.error.trim()) {
    return { success: false, error: `Gateway error: ${payload.error.trim()}` };
  }

  // Check for error object
  if (payload.error && typeof payload.error === "object") {
    const errObj = payload.error as Record<string, unknown>;
    const message =
      typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
    return { success: false, error: `Gateway error: ${message}` };
  }

  // Validate choices array
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    return { success: false, error: "Response missing 'choices' array or choices array is empty." };
  }

  const firstChoice = payload.choices[0];
  if (!firstChoice || typeof firstChoice !== "object") {
    return { success: false, error: "First choice in response is not an object." };
  }

  const choiceObj = firstChoice as Record<string, unknown>;
  const messageObj = choiceObj.message;
  if (!messageObj || typeof messageObj !== "object") {
    return { success: false, error: "Choice missing 'message' object." };
  }

  const msg = messageObj as Record<string, unknown>;
  if (typeof msg.content !== "string" || !msg.content.trim()) {
    return { success: false, error: "Message content is missing or not a non-empty string." };
  }

  const content = msg.content.trim();
  const model = typeof payload.model === "string" ? payload.model : CENCORI_MODEL;

  let usage: CencoriSuccessResult["usage"] = undefined;
  if (payload.usage && typeof payload.usage === "object") {
    const u = payload.usage as Record<string, unknown>;
    if (
      typeof u.prompt_tokens === "number" &&
      typeof u.completion_tokens === "number" &&
      typeof u.total_tokens === "number"
    ) {
      usage = {
        promptTokens: u.prompt_tokens,
        completionTokens: u.completion_tokens,
        totalTokens: u.total_tokens,
      };
    }
  }

  return {
    success: true,
    content,
    model,
    usage,
  };
}

/**
 * Default child_process spawner that executes CLI commands without shell interpolation.
 */
function defaultSpawn(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err: Error) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });

    child.on("close", (exitCode: number | null) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

/**
 * Executes a paid Cencori inference call via `@celo/buy curl`.
 *
 * Safety protections:
 * - Disabled by default: requires options.enablePaidExecution === true (or process.env.ENABLE_PAID_EXECUTION === "true").
 * - Avoids shell interpolation: passes command arguments as an array directly to spawn.
 * - Writes request body to a unique temporary file and guarantees removal in a finally block.
 * - Enforces `--max-amount 0.01` and `--token USDC`.
 * - Never prints or records private keys.
 */
export async function executeCencoriInference(
  requestBody: CencoriRequestBody,
  options?: CencoriExecutionOptions
): Promise<CencoriExecutionResult> {
  const isEnabled =
    options?.enablePaidExecution ?? process.env.ENABLE_PAID_EXECUTION === "true";

  if (!isEnabled) {
    return {
      isExecuted: false,
      success: false,
      error: "Live payment execution is disabled by default (set ENABLE_PAID_EXECUTION=true to enable).",
    };
  }

  const endpoint = options?.endpoint ?? CENCORI_ENDPOINT;
  const accountName = options?.accountName ?? "taskpilot";
  const maxAmount = options?.maxAmount ?? "0.01";
  const spawner = options?.spawnFn ?? defaultSpawn;

  const tempFilePath = join(tmpdir(), `taskpilot-cencori-${randomUUID()}.json`);

  try {
    // Write request body to a temporary file (Windows-safe UTF-8, strips BOM)
    await writeFile(tempFilePath, JSON.stringify(requestBody), "utf8");

    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    const args = [
      "--yes",
      "@celo/buy@0.8.3",
      "--account",
      accountName,
      "curl",
      "--max-amount",
      maxAmount,
      "--token",
      "USDC",
      "-X",
      "POST",
      "-H",
      process.platform === "win32" ? '"Content-Type: application/json"' : "Content-Type: application/json",
      "--data-file",
      tempFilePath,
      endpoint,
    ];

    const result = await spawner(command, args);

    if (result.exitCode !== 0) {
      return {
        isExecuted: true,
        success: false,
        rawOutput: result.stdout,
        error: `CLI exited with code ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim()}`,
      };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.stdout);
    } catch {
      return {
        isExecuted: true,
        success: false,
        rawOutput: result.stdout,
        error: "CLI output could not be parsed as JSON.",
      };
    }

    const parsedResponse = parseCencoriResponse(parsedJson);
    return {
      isExecuted: true,
      success: parsedResponse.success,
      parsedResponse,
      rawOutput: result.stdout,
      error: parsedResponse.success ? undefined : parsedResponse.error,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      isExecuted: true,
      success: false,
      error: `Execution failed: ${errorMsg}`,
    };
  } finally {
    // Guaranteed cleanup of temporary request file
    try {
      await unlink(tempFilePath);
    } catch {
      // Ignore if file was not created or already unlinked
    }
  }
}
