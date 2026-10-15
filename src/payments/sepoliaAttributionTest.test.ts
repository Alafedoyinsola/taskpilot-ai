import {
  isValidPrivateKeyFormat,
  validateSignerAddress,
  calculateGasSafetyMargin,
  isExecutionAllowed,
} from "./sepoliaAttributionTest.ts";
import { AGENT_WALLET_ADDRESS } from "../config/attribution.ts";

/**
 * ============================================================================
 * OFFLINE UNIT TEST: Sepolia Attribution Test Safety Guards
 * (ALL STRINGS IN THIS TEST SUITE ARE DUMMY SYNTHETIC TEST STRINGS)
 * ============================================================================
 */

function runSafetyGuardTests(): void {
  console.log("=================================================");
  console.log("  Testing Sepolia Attribution Safety Guards      ");
  console.log("  (100% Offline — Synthetic Test Data Only)      ");
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

  // 1. TEST: Execution Flag Gate
  assert("Refuses execution when flag is undefined", isExecutionAllowed(undefined) === false);
  assert("Refuses execution when flag is empty string", isExecutionAllowed("") === false);
  assert("Refuses execution when flag is 'false'", isExecutionAllowed("false") === false);
  assert("Allows execution only when flag is strictly 'true'", isExecutionAllowed("true") === true);

  // 2. TEST: Private Key Format Validation (Synthetic Dummy Strings Only)
  const dummy64Hex = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const dummy0x64Hex = `0x${dummy64Hex}`;

  assert("Accepts valid 64-character hex string", isValidPrivateKeyFormat(dummy64Hex) === true);
  assert("Accepts valid 0x-prefixed 64-character hex string", isValidPrivateKeyFormat(dummy0x64Hex) === true);
  assert("Rejects too-short hex string (63 chars)", isValidPrivateKeyFormat(dummy64Hex.slice(0, 63)) === false);
  assert("Rejects too-long hex string (65 chars)", isValidPrivateKeyFormat(`${dummy64Hex}a`) === false);
  assert("Rejects non-hex characters (contains 'g' or 'z')", isValidPrivateKeyFormat(dummy64Hex.replace("a", "z")) === false);
  assert("Rejects empty string", isValidPrivateKeyFormat("") === false);
  assert("Rejects non-string types", isValidPrivateKeyFormat(12345) === false);

  // 3. TEST: Signer Address Enforcement
  assert(
    "Accepts exact match for approved AGENT_WALLET_ADDRESS",
    validateSignerAddress(AGENT_WALLET_ADDRESS, AGENT_WALLET_ADDRESS) === true
  );

  assert(
    "Accepts case-insensitive match for approved AGENT_WALLET_ADDRESS",
    validateSignerAddress(AGENT_WALLET_ADDRESS.toLowerCase(), AGENT_WALLET_ADDRESS.toUpperCase()) === true
  );

  const unauthorizedDummyAddress = "0x0000000000000000000000000000000000000001";
  assert(
    "Strictly rejects unauthorized derived address",
    validateSignerAddress(unauthorizedDummyAddress, AGENT_WALLET_ADDRESS) === false
  );

  // 4. TEST: Gas Safety Margin Calculation
  const sampleGasUnits = 21000n;
  const sampleGasPrice = 5000000000n; // 5 Gwei
  const baseCost = sampleGasUnits * sampleGasPrice; // 105,000,000,000,000 wei

  const thresholdWith20Percent = calculateGasSafetyMargin(sampleGasUnits, sampleGasPrice, 20n);
  const expectedThreshold = (baseCost * 120n) / 100n; // 126,000,000,000,000 wei

  assert(
    "Correctly calculates gas threshold with 20% safety margin",
    thresholdWith20Percent === expectedThreshold && thresholdWith20Percent > baseCost
  );

  console.log(`\n=================================================`);
  console.log(`  Result: ${passed} / ${total} tests passed (100% offline, $0 spent)`);
  console.log(`=================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runSafetyGuardTests();
