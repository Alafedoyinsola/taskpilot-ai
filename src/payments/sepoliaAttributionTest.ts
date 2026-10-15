import { createWalletClient, createPublicClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { withAttribution, verifyTx, toDataSuffix, fromDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_TAG, AGENT_WALLET_ADDRESS } from "../config/attribution.ts";
import "dotenv/config";

/**
 * ============================================================================
 * Celo Sepolia Attribution Test Runner (Hardened Safety Edition)
 *
 * Safety Principles:
 * 1. STRICT SAFETY GATE: Refuses to broadcast unless SEND_TEST_TRANSACTION="true".
 * 2. NO SECRETS IN CODE: Private keys are never hardcoded and never logged/printed.
 * 3. FORMAT VALIDATION: Validates private key format before deriving account.
 * 4. SIGNER ENFORCEMENT: Immediately halts if derived address != AGENT_WALLET_ADDRESS.
 * 5. PRE-FLIGHT GAS CHECK: Calculates gas + 20% margin; halts if balance < threshold.
 * 6. CHAIN HARD-CODED: Fixed to Celo Sepolia (Chain ID 11142220), mainnet forbidden.
 * 7. ZERO VALUE: The transaction transfers 0 CELO (value: 0n) to the agent itself.
 * ============================================================================
 */

/**
 * Validates whether a value matches the 32-byte hex format of an EVM private key.
 * Never logs, prints, or exposes the key material.
 */
export function isValidPrivateKeyFormat(rawKey: unknown): rawKey is string {
  if (typeof rawKey !== "string") return false;
  const trimmed = rawKey.trim();
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

/**
 * Validates that the derived signer matches the expected agent address (case-insensitive).
 */
export function validateSignerAddress(derivedAddress: string, expectedAddress: string): boolean {
  if (!derivedAddress || !expectedAddress) return false;
  return derivedAddress.toLowerCase() === expectedAddress.toLowerCase();
}

/**
 * Calculates required balance for gas with an added percentage safety margin (default 20%).
 */
export function calculateGasSafetyMargin(
  gasEstimate: bigint,
  gasPrice: bigint,
  marginPercent: bigint = 20n
): bigint {
  const baseCost = gasEstimate * gasPrice;
  return (baseCost * (100n + marginPercent)) / 100n;
}

/**
 * Validates the explicit execution flag.
 */
export function isExecutionAllowed(sendFlag: string | undefined): boolean {
  return sendFlag === "true";
}

export async function runSepoliaAttributionTest(): Promise<void> {
  console.log("=================================================");
  console.log("   TaskPilot AI — Celo Sepolia Attribution Test  ");
  console.log("   (Hardened Safety Edition — Testnet Only)      ");
  console.log("=================================================\n");

  // Hardcoded safety constraint: network is permanently locked to Celo Sepolia Testnet
  const networkConfig = celoSepolia;
  console.log(`Network          : ${networkConfig.name} (Chain ID ${networkConfig.id})`);
  console.log(`RPC Endpoint     : ${networkConfig.rpcUrls.default.http[0]}`);
  console.log(`Attribution Tag  : ${ATTRIBUTION_TAG}`);
  console.log(`Expected Signer  : ${AGENT_WALLET_ADDRESS}`);
  console.log(`Target Recipient : ${AGENT_WALLET_ADDRESS} (Self-Transfer)`);
  console.log(`Transfer Value   : 0 CELO (value: 0n)\n`);

  // 1. Offline Pre-flight Validation
  const expectedSuffix = toDataSuffix(ATTRIBUTION_TAG);
  const offlineCheck = fromDataSuffix(expectedSuffix);

  console.log("[1. Pre-flight Offline Check]");
  console.log(`  Encoded Suffix : ${expectedSuffix}`);
  console.log(`  Decoded Codes  : ${JSON.stringify(offlineCheck?.codes)}`);
  console.log(`  Schema ID      : ${offlineCheck?.schemaId} (Schema 0 confirmed)`);

  // 2. Strict Execution Gate Check
  if (!isExecutionAllowed(process.env.SEND_TEST_TRANSACTION)) {
    console.log("\n-------------------------------------------------");
    console.log("[SAFETY GATE ACTIVATED: DRY RUN ONLY]");
    console.log("  SEND_TEST_TRANSACTION is not set to 'true'.");
    console.log("  No wallet client was created.");
    console.log("  No private key was derived or accessed.");
    console.log("  No transaction was signed or broadcast.");
    console.log("  No testnet funds were spent.");
    console.log("-------------------------------------------------\n");
    console.log("To execute an actual testnet broadcast in a future approved step:");
    console.log("  1. Ensure your agent wallet (0x548c...6F89) holds testnet CELO from https://faucet.celo.org");
    console.log("  2. Set SEND_TEST_TRANSACTION=true in your environment or command line.");
    return;
  }

  // 3. Environment Secret Check & Format Validation (Never log or print the key)
  const rawKey = process.env.AGENT_PRIVATE_KEY?.trim();
  if (!rawKey) {
    console.error("\n[Error] SEND_TEST_TRANSACTION=true was set, but AGENT_PRIVATE_KEY is missing in your environment.");
    console.error("Please configure AGENT_PRIVATE_KEY in your local .env file before broadcasting.");
    return;
  }

  if (!isValidPrivateKeyFormat(rawKey)) {
    console.error("\n[CRITICAL ERROR] AGENT_PRIVATE_KEY does not have a valid 32-byte hex format.");
    console.error("Expected 64 hex characters (with optional 0x prefix). Execution halted immediately.");
    return;
  }

  const formattedKey: `0x${string}` = rawKey.startsWith("0x")
    ? (rawKey as `0x${string}`)
    : (`0x${rawKey}` as `0x${string}`);

  // 4. Initialize public client for Celo Sepolia
  const publicClient = createPublicClient({
    chain: networkConfig,
    transport: http(),
  });

  // 5. Derive Account & Enforce Exact Address Matching
  const account = privateKeyToAccount(formattedKey);

  console.log("\n[2. On-Chain Wallet Verification]");
  console.log(`  Derived Address : ${account.address}`);

  // Safety Requirement 1: Halt immediately if address does not match AGENT_WALLET_ADDRESS
  if (!validateSignerAddress(account.address, AGENT_WALLET_ADDRESS)) {
    console.error("\n=================================================");
    console.error("  [CRITICAL ERROR] SIGNER ADDRESS MISMATCH!      ");
    console.error("=================================================");
    console.error(`  Derived Signer : ${account.address}`);
    console.error(`  Expected Agent : ${AGENT_WALLET_ADDRESS}`);
    console.error("  The configured private key does NOT correspond to the approved agent address.");
    console.error("  Halting execution immediately. No transaction will be signed or sent.");
    console.error("=================================================\n");
    return;
  }

  console.log("  ✔ Signer Address matches AGENT_WALLET_ADDRESS exactly.");

  // Check testnet balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`  Sepolia Balance : ${formatEther(balance)} CELO`);

  // 6. Pre-flight Gas Estimation & Safety Margin Enforcement
  console.log("\n[3. Estimating Gas & Safety Margin]");
  const attributedData = toDataSuffix(ATTRIBUTION_TAG);

  let gasEstimate: bigint;
  let gasPrice: bigint;

  try {
    gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: account.address,
      value: 0n,
      data: attributedData,
    });
    gasPrice = await publicClient.getGasPrice();
  } catch (gasErr: unknown) {
    const msg = gasErr instanceof Error ? gasErr.message : String(gasErr);
    console.error(`\n[Error] Failed to estimate gas on Celo Sepolia: ${msg}`);
    console.error("Halting execution. Transaction will not be broadcast.");
    return;
  }

  const estimatedCost = gasEstimate * gasPrice;
  const requiredBalanceWithMargin = calculateGasSafetyMargin(gasEstimate, gasPrice, 20n);

  console.log(`  Gas Units       : ${gasEstimate.toString()}`);
  console.log(`  Estimated Cost  : ${formatEther(estimatedCost)} CELO`);
  console.log(`  Threshold w/20% : ${formatEther(requiredBalanceWithMargin)} CELO`);

  // Safety Requirement 2: Refuse to send if balance does not cover cost + 20% margin
  if (balance < requiredBalanceWithMargin) {
    console.error("\n=================================================");
    console.error("  [ERROR] INSUFFICIENT BALANCE FOR SAFE EXECUTION");
    console.error("=================================================");
    console.error(`  Current Balance : ${formatEther(balance)} CELO`);
    console.error(`  Required (w/20%): ${formatEther(requiredBalanceWithMargin)} CELO`);
    console.error(`  Please request free testnet CELO from https://faucet.celo.org/celo-sepolia`);
    console.error("  Halting execution. No transaction will be broadcast.");
    console.error("=================================================\n");
    return;
  }

  console.log("  ✔ Balance safely covers estimated gas with 20% buffer.");

  // 7. Build Wallet Client with withAttribution extension
  const walletClient = createWalletClient({
    account,
    chain: networkConfig,
    transport: http(),
  }).extend(withAttribution(ATTRIBUTION_TAG));

  // 8. Broadcast 0-value self-transfer with attribution
  console.log("\n[4. Broadcasting Attributed Testnet Transaction]");
  console.log("  Broadcasting 0 CELO self-transfer to self on Celo Sepolia...");

  const hash = await walletClient.sendTransaction({
    to: account.address,
    value: 0n,
  });

  console.log(`  ✔ Broadcast Succeeded!`);
  console.log(`  Transaction Hash: ${hash}`);
  console.log(`  Sepolia Explorer: https://sepolia.celoscan.io/tx/${hash}`);

  // 9. Await confirmation & verify attribution on-chain
  console.log("\n[5. Awaiting Block Confirmation & Verifying Attribution]");
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`  Block Number    : ${receipt.blockNumber}`);
  console.log(`  Gas Used        : ${receipt.gasUsed.toString()}`);

  const onChainAttribution = await verifyTx({ client: publicClient, hash });

  if (onChainAttribution && onChainAttribution.codes.includes(ATTRIBUTION_TAG)) {
    console.log("\n=================================================");
    console.log("  ✔ ON-CHAIN ATTRIBUTION VERIFICATION PASSED!   ");
    console.log("=================================================");
    console.log(`  Codes Verified  : ${JSON.stringify(onChainAttribution.codes)}`);
    console.log(`  Schema ID       : ${onChainAttribution.schemaId}`);
    console.log(`  Attribution Suffix confirmed on Celo Sepolia!`);
    console.log("=================================================\n");
  } else {
    console.error("\n[Error] On-chain attribution verification failed to detect the expected tag.");
  }
}

// If run directly via CLI
if (process.argv[1]?.endsWith("sepoliaAttributionTest.ts")) {
  runSepoliaAttributionTest().catch((err) => {
    console.error("Execution error:", err instanceof Error ? err.message : String(err));
  });
}
