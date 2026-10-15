import { validateX402Challenge, formatQuoteSummary } from "./quoteService.ts";

/**
 * ============================================================================
 * TEST SUITE: x402 Payment Challenge Parser & Validator
 * (ALL DATA USED IN THIS FILE IS CLEARLY LABELED TEST DATA)
 * ============================================================================
 */

function runQuoteServiceTests(): void {
  console.log("=================================================");
  console.log("  Testing x402 Quote Service (Sample Test Data)  ");
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

  // TEST 1: Valid Official Celo Gateway x402 Challenge (Sample Test Data)
  const validSampleChallenge = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "celo",
        maxAmountRequired: "10000",
        resource: "https://gateway.usebuy.ai/cencori/v1/chat/completions",
        description: "Chat completion, maximo-atlas-1.3 (closed beta)",
        mimeType: "application/json",
        payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
        maxTimeoutSeconds: 60,
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        extra: {
          name: "USDC",
          version: "2",
          decimals: 6,
        },
      },
    ],
    error: "payment_required",
  };

  const validResult = validateX402Challenge(validSampleChallenge);
  assert("Validates authentic x402 challenge", validResult.isValid === true);
  if (validResult.isValid) {
    assert("Parses human-readable amount correctly (10000 / 10^6 = 0.01)", validResult.humanAmount === "0.01");
    assert("Identifies token symbol as USDC", validResult.tokenSymbol === "USDC");
    assert("Extracts recipient address safely", validResult.recipientAddress === "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B");
    console.log("\n  Sample Validated Summary Output:");
    console.log(formatQuoteSummary(validResult).split("\n").map(l => "    " + l).join("\n"));
    console.log();
  }

  // TEST 2: Untrusted Malformed Recipient Address (Sample Test Data)
  const invalidRecipientChallenge = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "celo",
        maxAmountRequired: "10000",
        payTo: "0xInvalidNotAValidEvmAddress1234",
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      },
    ],
  };

  const invalidRecipientResult = validateX402Challenge(invalidRecipientChallenge);
  assert(
    "Rejects invalid recipient address format",
    invalidRecipientResult.isValid === false && invalidRecipientResult.reason.includes("payTo")
  );

  // TEST 3: Untrusted Non-Numeric or Zero Amount (Sample Test Data)
  const invalidAmountChallenge = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: "celo",
        maxAmountRequired: "-500",
        payTo: "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B",
        asset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
      },
    ],
  };

  const invalidAmountResult = validateX402Challenge(invalidAmountChallenge);
  assert(
    "Rejects negative or invalid amount format",
    invalidAmountResult.isValid === false && invalidAmountResult.reason.includes("Amount required")
  );

  // TEST 4: Untrusted Empty/Missing Accepts Array (Sample Test Data)
  const missingAcceptsChallenge = {
    error: "payment_required",
  };

  const missingAcceptsResult = validateX402Challenge(missingAcceptsChallenge);
  assert(
    "Rejects payload with missing accepts list",
    missingAcceptsResult.isValid === false && missingAcceptsResult.reason.includes("accepts")
  );

  console.log(`\n=================================================`);
  console.log(`  Tests Completed: ${passed} / ${total} passed`);
  console.log(`=================================================\n`);
}

runQuoteServiceTests();
