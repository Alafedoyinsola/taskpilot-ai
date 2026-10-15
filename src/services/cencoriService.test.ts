import {
  CENCORI_ENDPOINT,
  CENCORI_MODEL,
  DEFAULT_MAX_TOKENS,
  buildCencoriPrompt,
  buildCencoriRequestBody,
  parseCencoriResponse,
  fetchLiveCencoriChallenge,
} from "./cencoriService.ts";
import type { DefiProtocol } from "./researchService.ts";

/**
 * ============================================================================
 * TEST SUITE: Cencori x402 Inference Request Builder & Response Parser
 * (100% Offline Unit Tests — Zero Network Calls, Zero Payments, Zero Secrets)
 * ============================================================================
 */

async function runCencoriServiceTests(): Promise<void> {
  console.log("=================================================");
  console.log("  Testing Cencori x402 Service (Offline Unit Tests)");
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

  const sampleProtocols: DefiProtocol[] = [
    {
      name: "Uniswap V3",
      category: "Dexes",
      celoTvlUsd: 14750000,
      url: "https://uniswap.org",
    },
    {
      name: "Aave V3",
      category: "Lending",
      celoTvlUsd: 11200000,
      url: "https://aave.com",
    },
    {
      name: "Mento V2",
      category: "Dexes",
      celoTvlUsd: 4900000,
      url: "https://mento.org",
    },
  ];

  // 1. Constants verification
  assert("Cencori endpoint points to official gateway", CENCORI_ENDPOINT === "https://gateway.usebuy.ai/cencori/v1/chat/completions");
  assert("Default model is maximo-atlas-1.3", CENCORI_MODEL === "maximo-atlas-1.3");
  assert("Default max_tokens is 256", DEFAULT_MAX_TOKENS === 256);

  // 2. Prompt builder with metrics
  const promptWithMetrics = buildCencoriPrompt(sampleProtocols, "Analyze Celo DeFi liquidity");
  assert(
    "Prompt builder incorporates protocol names and TVL figures",
    promptWithMetrics.includes("Uniswap V3") &&
      promptWithMetrics.includes("Aave V3") &&
      promptWithMetrics.includes("14,750,000")
  );
  assert("Prompt builder includes user objective context", promptWithMetrics.includes("Analyze Celo DeFi liquidity"));

  // 3. Prompt builder with empty metrics fallback
  const emptyPrompt = buildCencoriPrompt([], "General inquiry");
  assert("Empty protocol list generates safe fallback prompt", emptyPrompt.includes("Provide a concise overview"));

  // 4. Request body construction (default max_tokens: 256)
  const requestBody = buildCencoriRequestBody(sampleProtocols, "Analyze Celo liquidity");
  assert("Request body specifies exact model maximo-atlas-1.3", requestBody.model === "maximo-atlas-1.3");
  assert("Request body sets max_tokens to 256", requestBody.max_tokens === 256);
  assert("Request body has exactly one user message", requestBody.messages.length === 1 && requestBody.messages[0].role === "user");
  assert("Message content is non-empty string", requestBody.messages[0].content.length > 20);

  // 5. Request body construction with custom token limit (1024)
  const requestBody1024 = buildCencoriRequestBody(sampleProtocols, "Detailed analysis", 1024);
  assert("Accepts valid 1024 max_tokens limit", requestBody1024.max_tokens === 1024);

  // 6. Response parsing: Valid OpenAI-compatible response with usage
  const validApiResponse = {
    id: "chatcmpl-test-12345",
    object: "chat.completion",
    created: 1791931200,
    model: "maximo-atlas-1.3",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "Uniswap V3 and Aave V3 represent over 80% of Celo TVL, indicating high liquidity concentration but strong collateral backing.",
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 45,
      completion_tokens: 28,
      total_tokens: 73,
    },
  };

  const parsedValid = parseCencoriResponse(validApiResponse);
  assert("Parses valid OpenAI-compatible response successfully", parsedValid.success === true);
  if (parsedValid.success) {
    assert(
      "Extracts response text correctly",
      parsedValid.content.includes("Uniswap V3 and Aave V3 represent over 80%")
    );
    assert("Identifies model correctly", parsedValid.model === "maximo-atlas-1.3");
    assert("Extracts usage tokens correctly", parsedValid.usage?.totalTokens === 73);
  }

  // 7. Response parsing: Valid response without usage block
  const validNoUsage = {
    choices: [
      {
        message: {
          role: "assistant",
          content: "Concise summary generated successfully.",
        },
      },
    ],
  };
  const parsedNoUsage = parseCencoriResponse(validNoUsage);
  assert("Parses response without usage block", parsedNoUsage.success === true && parsedNoUsage.content === "Concise summary generated successfully.");

  // 8. Response parsing: Gateway string error
  const stringErrorResponse = {
    error: "bad_request: max_tokens must be one of 256, 1024, 4096 (missing)",
  };
  const parsedStringError = parseCencoriResponse(stringErrorResponse);
  assert("Detects gateway string error", parsedStringError.success === false && parsedStringError.error.includes("max_tokens must be"));

  // 9. Response parsing: Gateway object error
  const objErrorResponse = {
    error: {
      message: "rate limit exceeded, retry in 5s",
      code: "rate_limited",
    },
  };
  const parsedObjError = parseCencoriResponse(objErrorResponse);
  assert("Detects gateway object error", parsedObjError.success === false && parsedObjError.error.includes("rate limit exceeded"));

  // 10. Response parsing: Malformed payload (null or not object)
  const nullParsed = parseCencoriResponse(null);
  assert("Rejects null response", nullParsed.success === false && nullParsed.error.includes("non-null object"));

  // 11. Response parsing: Missing choices array
  const missingChoices = { model: "maximo-atlas-1.3" };
  const parsedMissingChoices = parseCencoriResponse(missingChoices);
  assert("Rejects response with missing choices array", parsedMissingChoices.success === false && parsedMissingChoices.error.includes("choices"));

  // 12. Response parsing: Empty choices array
  const emptyChoices = { choices: [] };
  const parsedEmptyChoices = parseCencoriResponse(emptyChoices);
  assert("Rejects response with empty choices array", parsedEmptyChoices.success === false && parsedEmptyChoices.error.includes("choices"));

  // 13. Response parsing: Choice missing content or empty content
  const emptyContentChoice = {
    choices: [{ message: { role: "assistant", content: "   " } }],
  };
  const parsedEmptyContent = parseCencoriResponse(emptyContentChoice);
  assert("Rejects choice with empty string content", parsedEmptyContent.success === false && parsedEmptyContent.error.includes("Message content"));

  // 14. fetchLiveCencoriChallenge: Successful 402 challenge response
  const mock402Response = {
    status: 402,
    json: async () => ({
      x402Version: 1,
      accepts: [
        {
          scheme: "exact",
          network: "celo",
          maxAmountRequired: "10000",
          resource: "https://gateway.usebuy.ai/cencori/v1/chat/completions",
          payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
          asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        },
      ],
    }),
  };
  const liveProbeSuccess = await fetchLiveCencoriChallenge({
    fetchFn: (async () => mock402Response) as unknown as typeof fetch,
  });
  assert("fetchLiveCencoriChallenge parses HTTP 402 challenge correctly", liveProbeSuccess.success === true && liveProbeSuccess.challenge?.accepts?.length === 1);
  assert("fetchLiveCencoriChallenge records status code 402", liveProbeSuccess.statusCode === 402);

  // 15. fetchLiveCencoriChallenge: Unexpected HTTP status (e.g. 200 or 503)
  const mock200Response = {
    status: 200,
    json: async () => ({ message: "unexpected" }),
  };
  const liveProbe200 = await fetchLiveCencoriChallenge({
    fetchFn: (async () => mock200Response) as unknown as typeof fetch,
  });
  assert(
    "fetchLiveCencoriChallenge rejects non-402 status code",
    liveProbe200.success === false && liveProbe200.statusCode === 200 && liveProbe200.error?.includes("HTTP 200") === true
  );

  // 16. fetchLiveCencoriChallenge: Non-JSON response body
  const mockNonJsonResponse = {
    status: 402,
    json: async () => {
      throw new Error("Unexpected end of JSON input");
    },
  };
  const liveProbeNonJson = await fetchLiveCencoriChallenge({
    fetchFn: (async () => mockNonJsonResponse) as unknown as typeof fetch,
  });
  assert(
    "fetchLiveCencoriChallenge detects unparseable response body",
    liveProbeNonJson.success === false && liveProbeNonJson.error?.includes("could not be parsed as JSON") === true
  );

  // 17. fetchLiveCencoriChallenge: Network failure / abort
  const failingFetch = (async () => {
    throw new Error("getaddrinfo ENOTFOUND gateway.usebuy.ai");
  }) as unknown as typeof fetch;
  const liveProbeNetFail = await fetchLiveCencoriChallenge({
    fetchFn: failingFetch,
  });
  assert(
    "fetchLiveCencoriChallenge handles network failure gracefully",
    liveProbeNetFail.success === false && liveProbeNetFail.error?.includes("ENOTFOUND") === true
  );

  console.log(`\n=================================================`);
  console.log(`  Tests Completed: ${passed} / ${total} passed`);
  console.log(`=================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runCencoriServiceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
