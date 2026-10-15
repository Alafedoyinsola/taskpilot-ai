import { toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_TAG } from "./attribution.ts";

/**
 * ============================================================================
 * OFFLINE UNIT TEST: Celo Attribution Tag Encoding & Decoding
 * Standard: ERC-8021
 * Target Tag: celo_c386b0979578 (Loops House)
 * ============================================================================
 */

function runAttributionSdkTest(): void {
  console.log("=================================================");
  console.log("   Celo Attribution SDK — Offline Unit Test     ");
  console.log("=================================================\n");

  let passed = 0;
  let total = 0;

  function assert(name: string, condition: boolean, details?: string): void {
    total++;
    if (condition) {
      console.log(`✔ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`✖ [FAIL] ${name} - ${details ?? ""}`);
    }
  }

  console.log(`Testing assigned Loops House attribution tag: "${ATTRIBUTION_TAG}"\n`);

  // 1. Encode the attribution tag into an ERC-8021 data suffix
  const encodedSuffix = toDataSuffix(ATTRIBUTION_TAG);

  assert(
    "toDataSuffix produces valid hex string",
    typeof encodedSuffix === "string" && encodedSuffix.startsWith("0x"),
    `Produced: ${encodedSuffix}`
  );

  // 2. Decode the suffix back to original tags using fromDataSuffix
  const decoded = fromDataSuffix(encodedSuffix);

  assert("fromDataSuffix successfully parses the encoded suffix", decoded !== null);

  if (decoded) {
    assert(
      "Decoded codes array contains assigned tag",
      Array.isArray(decoded.codes) && decoded.codes.includes(ATTRIBUTION_TAG),
      `Expected "${ATTRIBUTION_TAG}", received: ${JSON.stringify(decoded.codes)}`
    );

    assert(
      "Decoded schemaId is Schema 0 (standard ERC-8021 app attribution)",
      decoded.schemaId === 0,
      `Received schemaId: ${decoded.schemaId}`
    );
  }

  console.log("\n-------------------------------------------------");
  console.log("Encoded ERC-8021 Suffix Hex:");
  console.log(`  ${encodedSuffix}`);
  console.log("\nDecoded Result Object:");
  console.log(`  Codes    : ${JSON.stringify(decoded?.codes)}`);
  console.log(`  Schema ID: ${decoded?.schemaId}`);
  console.log("-------------------------------------------------");

  console.log(`\n=================================================`);
  console.log(`  Result: ${passed} / ${total} tests passed (100% offline, $0 spent)`);
  console.log(`=================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runAttributionSdkTest();
