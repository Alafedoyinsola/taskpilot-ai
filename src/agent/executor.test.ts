import { executePlan, SAMPLE_TEST_402_CHALLENGE } from "./executor.ts";
import { createPlan } from "./planner.ts";
import {
  validateCencoriQuote,
  executeCencoriInference,
  MAX_ALLOWED_ATOMIC_USDC,
  EXPECTED_USDC_CONTRACT,
  EXPECTED_NETWORK,
  EXPECTED_RECIPIENT,
  type CencoriRequestBody,
  type LiveChallengeResult,
} from "../services/cencoriService.ts";
import type { ValidatedQuote } from "../services/quoteService.ts";

/**
 * ============================================================================
 * TEST SUITE: Executor Safety Policies, Approval Gates & Cencori Execution Path
 * (100% Offline — Zero Network Calls, Zero Payments, Zero Private Keys)
 * ============================================================================
 */

async function runExecutorTests(): Promise<void> {
  console.log("=================================================");
  console.log("  Testing Executor Safety, Gates & x402 Path     ");
  console.log("=================================================\n");

  let passed = 0;
  let total = 0;

  function assert(testName: string, condition: boolean, details?: string): void {
    total++;
    if (condition) {
      console.log(`✔ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`✖ [FAIL] ${testName} - ${details ?? ""}`);
    }
  }

  const defaultValidQuote: ValidatedQuote = {
    isValid: true,
    network: EXPECTED_NETWORK,
    scheme: "exact",
    tokenSymbol: "USDC",
    tokenAddress: EXPECTED_USDC_CONTRACT,
    recipientAddress: EXPECTED_RECIPIENT,
    atomicAmount: "10000",
    humanAmount: "0.01",
    decimals: 6,
    description: "Chat completion, maximo-atlas-1.3 (closed beta)",
    resource: "https://gateway.usebuy.ai/cencori/v1/chat/completions",
    timeoutSeconds: 60,
  };

  // 1. Policy test: Valid quote passes
  const validCompliance = validateCencoriQuote(defaultValidQuote);
  assert("Policy accepts authentic compliant quote", validCompliance.isCompliant === true);

  // 2. Policy test: Amount over cap (10001 atomic units > 10000)
  const overCapQuote: ValidatedQuote = {
    ...defaultValidQuote,
    atomicAmount: "10001",
    humanAmount: "0.010001",
  };
  const overCapCompliance = validateCencoriQuote(overCapQuote);
  assert(
    "Policy strictly rejects atomic amount exceeding 10000 units (0.01 USDC)",
    overCapCompliance.isCompliant === false && overCapCompliance.reason?.includes("exceeds the strict 0.01 USDC safety cap") === true
  );

  // 3. Policy test: Invalid network
  const wrongNetworkQuote: ValidatedQuote = {
    ...defaultValidQuote,
    network: "ethereum",
  };
  const wrongNetworkCompliance = validateCencoriQuote(wrongNetworkQuote);
  assert(
    "Policy strictly rejects foreign network",
    wrongNetworkCompliance.isCompliant === false && wrongNetworkCompliance.reason?.includes("Invalid network") === true
  );

  // 4. Policy test: Invalid token/asset contract
  const wrongAssetQuote: ValidatedQuote = {
    ...defaultValidQuote,
    tokenAddress: "0x1111111111111111111111111111111111111111",
  };
  const wrongAssetCompliance = validateCencoriQuote(wrongAssetQuote);
  assert(
    "Policy strictly rejects non-USDC asset contract",
    wrongAssetCompliance.isCompliant === false && wrongAssetCompliance.reason?.includes("Invalid asset contract") === true
  );

  // 5. Policy test: Recipient address mismatch
  const wrongRecipientQuote: ValidatedQuote = {
    ...defaultValidQuote,
    recipientAddress: "0x2222222222222222222222222222222222222222",
  };
  const wrongRecipientCompliance = validateCencoriQuote(wrongRecipientQuote);
  assert(
    "Policy strictly rejects unauthorized recipient address",
    wrongRecipientCompliance.isCompliant === false && wrongRecipientCompliance.reason?.includes("Invalid recipient address") === true
  );

  // 6. Subprocess execution: Disabled by default
  const disabledExecResult = await executeCencoriInference({
    model: "maximo-atlas-1.3",
    max_tokens: 256,
    messages: [{ role: "user", content: "test" }],
  });
  assert(
    "executeCencoriInference refuses execution by default without flag",
    disabledExecResult.isExecuted === false && disabledExecResult.error?.includes("disabled by default") === true
  );

  // 7. Subprocess execution: Spawner arguments and cleanup verification
  let capturedCommand = "";
  let capturedArgs: string[] = [];
  const testSpawner = async (command: string, args: string[]) => {
    capturedCommand = command;
    capturedArgs = args;
    return {
      stdout: JSON.stringify({
        model: "maximo-atlas-1.3",
        choices: [{ message: { role: "assistant", content: "Mocked AI assessment content." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
      stderr: "",
      exitCode: 0,
    };
  };

  const enabledExecResult = await executeCencoriInference(
    {
      model: "maximo-atlas-1.3",
      max_tokens: 256,
      messages: [{ role: "user", content: "test" }],
    },
    {
      enablePaidExecution: true,
      accountName: "taskpilot-test",
      spawnFn: testSpawner,
    }
  );

  assert("executeCencoriInference executes successfully with flag and spawner", enabledExecResult.success === true);
  assert("Invokes correct CLI binary (npx or npx.cmd)", capturedCommand.includes("npx"));
  assert("Passes --max-amount 0.01 option in args array", capturedArgs.includes("--max-amount") && capturedArgs[capturedArgs.indexOf("--max-amount") + 1] === "0.01");
  assert("Passes --account taskpilot-test in args array", capturedArgs.includes("--account") && capturedArgs[capturedArgs.indexOf("--account") + 1] === "taskpilot-test");
  assert("Uses --data-file without shell interpolation", capturedArgs.includes("--data-file"));

  // 8. Integration test: User decline path
  const plan = createPlan("Research Celo DeFi protocols");
  const declineResult = await executePlan(
    plan,
    async () => false,
    { challengePayload: SAMPLE_TEST_402_CHALLENGE }
  );
  assert("Execution succeeds when user declines payment", declineResult.status === "success");
  const step3Decline = declineResult.results.find((r) => r.serviceType === "analysis");
  assert("Step 3 records user cancellation safely", step3Decline?.output.includes("[PAYMENT CANCELLED BY USER]") === true);
  const step4Decline = declineResult.results.find((r) => r.serviceType === "report");
  assert("Final report completes with DefiLlama data and notes payment skipped", step4Decline?.output.includes("Paid Service Status: Skipped") === true);

  // 9. Integration test: Missing approval callback
  const noCallbackResult = await executePlan(
    plan,
    undefined,
    { challengePayload: SAMPLE_TEST_402_CHALLENGE }
  );
  const step3NoCallback = noCallbackResult.results.find((r) => r.serviceType === "analysis");
  assert("Omitting approval callback safely skips payment", step3NoCallback?.output.includes("[PAYMENT CANCELLED BY USER]") === true);

  // 10. Integration test: Approval callback throws error
  const throwingCallbackResult = await executePlan(
    plan,
    async () => {
      throw new Error("Terminal connection dropped");
    },
    { challengePayload: SAMPLE_TEST_402_CHALLENGE }
  );
  const step3Throw = throwingCallbackResult.results.find((r) => r.serviceType === "analysis");
  assert("Approval callback exception caught and safely cancels payment", step3Throw?.output.includes("[PAYMENT CANCELLED BY USER]") === true);

  // 11. Integration test: Policy rejection before approval prompt
  const policyTracker = { prompted: false };
  const overCapChallenge = {
    x402Version: 1,
    accepts: [
      {
        ...SAMPLE_TEST_402_CHALLENGE.accepts![0],
        maxAmountRequired: "50000", // 0.05 USDC (> 0.01 USDC cap)
      },
    ],
  };
  const policyRejectionResult = await executePlan(
    plan,
    async () => {
      policyTracker.prompted = true;
      return true;
    },
    { challengePayload: overCapChallenge }
  );
  assert("User is NEVER prompted for approval when quote violates policy cap", policyTracker.prompted === false);
  const step3PolicyFail = policyRejectionResult.results.find((r) => r.serviceType === "analysis");
  assert("Step 3 reports quote rejection by safety policy", step3PolicyFail?.output.includes("[QUOTE REJECTED BY SAFETY POLICY]") === true);

  // 12. Integration test: Successful execution & report incorporation
  const mockAiOutput = "Celo ecosystem exhibits robust collateralization in Aave V3 alongside stable liquidity in Uniswap V3 pools.";
  const mockSuccessExecutor = async () => ({
    isExecuted: true,
    success: true,
    parsedResponse: {
      success: true as const,
      content: mockAiOutput,
      model: "maximo-atlas-1.3",
      usage: { promptTokens: 30, completionTokens: 20, totalTokens: 50 },
    },
  });

  const successResult = await executePlan(
    plan,
    async () => true,
    {
      challengePayload: SAMPLE_TEST_402_CHALLENGE,
      executorFn: mockSuccessExecutor,
    }
  );
  assert("Execution succeeds when paid call succeeds", successResult.status === "success");
  const step4Success = successResult.results.find((r) => r.serviceType === "report");
  assert(
    "Final report incorporates AI Market & Liquidity Assessment heading",
    step4Success?.output.includes("### AI Market & Liquidity Assessment (Cencori x402)") === true
  );
  assert("Final report includes model assessment output text", step4Success?.output.includes(mockAiOutput) === true);

  // 13. Integration test: Execution failure fallback
  const mockFailureExecutor = async () => ({
    isExecuted: true,
    success: false,
    error: "Gateway timeout (504)",
  });

  const failureResult = await executePlan(
    plan,
    async () => true,
    {
      challengePayload: SAMPLE_TEST_402_CHALLENGE,
      executorFn: mockFailureExecutor,
    }
  );
  assert("Execution completes partially/safely on gateway failure", failureResult.status === "partial");
  const step3Fail = failureResult.results.find((r) => r.serviceType === "analysis");
  assert("Step 3 records failure reason", step3Fail?.output.includes("[PAID INFERENCE FAILED] Gateway timeout (504)") === true);
  const step4Fail = failureResult.results.find((r) => r.serviceType === "report");
  assert("Step 4 gracefully completes report using DefiLlama data alone", step4Fail?.output.includes("[SYNTHESIZED REPORT]") === true);

  // 14. Live probe integration: Successful live probe flow
  const liveProbeTracker = { prompted: false };
  const mockSuccessProbe = async (): Promise<LiveChallengeResult> => ({
    success: true,
    statusCode: 402,
    challenge: SAMPLE_TEST_402_CHALLENGE,
  });

  const liveProbeSuccessResult = await executePlan(
    plan,
    async () => {
      liveProbeTracker.prompted = true;
      return true;
    },
    {
      fetchLiveChallengeFn: mockSuccessProbe,
      executorFn: mockSuccessExecutor,
    }
  );
  assert("Live probe success prompts user for approval", liveProbeTracker.prompted === true);
  assert("Live probe success executes and incorporates AI assessment", liveProbeSuccessResult.status === "success");

  // 15. Live probe integration: Gateway probe failure does NOT fall back to sample
  const fallbackTracker = { prompted: false };
  const mockFailingProbe = async (): Promise<LiveChallengeResult> => ({
    success: false,
    statusCode: 503,
    error: "Gateway temporarily unavailable (503)",
  });

  const liveProbeFailResult = await executePlan(
    plan,
    async () => {
      fallbackTracker.prompted = true;
      return true;
    },
    {
      fetchLiveChallengeFn: mockFailingProbe,
    }
  );
  assert("Probe failure NEVER prompts user for approval", fallbackTracker.prompted === false);
  const step3ProbeFail = liveProbeFailResult.results.find((r) => r.serviceType === "analysis");
  assert("Step 3 records probe failure without falling back to sample", step3ProbeFail?.output.includes("[LIVE PROBE FAILED]") === true);
  const step4ProbeFail = liveProbeFailResult.results.find((r) => r.serviceType === "report");
  assert("Final report completes with DefiLlama data alone when probe fails", step4ProbeFail?.output.includes("Paid Service Status: Skipped") === true);

  // 16. Live probe integration: Network error probe failure
  const mockNetworkFailProbe = async (): Promise<LiveChallengeResult> => ({
    success: false,
    error: "Unpaid probe to gateway failed: fetch failed (ENOTFOUND)",
  });

  const networkFailResult = await executePlan(
    plan,
    async () => true,
    {
      fetchLiveChallengeFn: mockNetworkFailProbe,
    }
  );
  const step3NetFail = networkFailResult.results.find((r) => r.serviceType === "analysis");
  assert("Step 3 safely catches network failure during probe", step3NetFail?.output.includes("ENOTFOUND") === true);

  console.log(`\n=================================================`);
  console.log(`  Tests Completed: ${passed} / ${total} passed`);
  console.log(`=================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runExecutorTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
