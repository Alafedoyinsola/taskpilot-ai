import {
  createPublicClient,
  http,
  isAddress,
  getAddress,
  type Address,
  type PublicClient,
} from "viem";
import { celo } from "viem/chains";
import { AGENT_WALLET_ADDRESS } from "../config/attribution.ts";

/**
 * ============================================================================
 * ERC-8004 Identity Registry Service for TaskPilot AI
 * Celo — Agents on Open Rails Hackathon (Build with buy track)
 *
 * Provides strictly READ-ONLY on-chain verification of agent identity
 * against the canonical ERC-8004 Identity Registry on Celo Mainnet.
 *
 * ZERO PRIVATE KEYS, ZERO SIGNING, ZERO FUNDS SPENT.
 * ============================================================================
 */

/**
 * Canonical ERC-8004 Identity Registry on Celo Mainnet.
 * Source: https://github.com/erc-8004/erc-8004-contracts
 */
export const ERC8004_REGISTRY_ADDRESS =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;

/**
 * Celo Mainnet Chain ID.
 */
export const CELO_MAINNET_CHAIN_ID = 42220 as const;

/**
 * Official default public RPC endpoint for Celo Mainnet.
 */
export const DEFAULT_CELO_RPC_URL = "https://forno.celo.org" as const;

/**
 * Canonical zero address.
 */
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

/**
 * Canonical ERC-8004 Identity Registry read-only ABI.
 * Derived directly from abis/IdentityRegistry.json in erc-8004-contracts.
 */
export const IDENTITY_REGISTRY_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "tokenURI",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "getAgentWallet",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "error",
    name: "ERC721NonexistentToken",
    inputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

/**
 * Abstract reader interface allowing dependency injection and offline unit testing.
 */
export interface ContractReader {
  readContract: (args: {
    address: Address;
    abi: any;
    functionName: string;
    args?: readonly any[];
  }) => Promise<any>;
}

export type IdentityVerificationStatus =
  | "VERIFIED"
  | "MISMATCH"
  | "NONEXISTENT"
  | "NOT_CONFIGURED"
  | "ERROR";

export interface IdentityMatchDetails {
  readonly isOwnerMatch: boolean;
  readonly isAgentWalletMatch: boolean;
  readonly isAgentWalletSet: boolean;
}

export interface OnChainAgentIdentity {
  readonly owner: Address;
  readonly tokenURI: string;
  readonly agentWallet: Address;
}

export interface AgentIdentityVerificationResult {
  readonly success: boolean;
  readonly status: IdentityVerificationStatus;
  readonly agentId?: string;
  readonly registryAddress: Address;
  readonly chainId: number;
  readonly expectedAddress?: Address;
  readonly onChain?: OnChainAgentIdentity;
  readonly matchDetails?: IdentityMatchDetails;
  readonly message: string;
}

export interface VerifyIdentityOptions {
  /**
   * The ERC-8004 agent ID to verify.
   * If omitted, reads from process.env.ERC8004_AGENT_ID.
   */
  agentId?: string | number | bigint;

  /**
   * Expected wallet address to compare against on-chain records.
   * If omitted, falls back to process.env.AGENT_WALLET_ADDRESS or AGENT_WALLET_ADDRESS.
   */
  expectedAddress?: string;

  /**
   * Custom registry contract address (defaults to ERC8004_REGISTRY_ADDRESS).
   */
  registryAddress?: string;

  /**
   * Custom Celo RPC URL (defaults to process.env.CELO_RPC_URL or https://forno.celo.org).
   */
  rpcUrl?: string;

  /**
   * Optional custom contract reader for unit testing with mocks.
   */
  client?: ContractReader;
}

/**
 * Safely parses and validates an agent ID into a non-negative bigint.
 */
export function parseAgentId(
  raw: unknown
): { valid: true; value: bigint } | { valid: false; error: string } {
  if (raw === undefined || raw === null || raw === "") {
    return {
      valid: false,
      error: "Agent ID is missing. Please configure ERC8004_AGENT_ID.",
    };
  }

  try {
    if (typeof raw === "bigint") {
      if (raw < 0n) {
        return { valid: false, error: "Agent ID cannot be negative." };
      }
      return { valid: true, value: raw };
    }

    if (typeof raw === "number") {
      if (!Number.isInteger(raw) || raw < 0) {
        return {
          valid: false,
          error: "Agent ID must be a non-negative integer.",
        };
      }
      return { valid: true, value: BigInt(raw) };
    }

    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!/^\d+$/.test(trimmed)) {
        return {
          valid: false,
          error: `Agent ID must be a valid integer numeric string (received "${raw}").`,
        };
      }
      return { valid: true, value: BigInt(trimmed) };
    }

    return {
      valid: false,
      error: `Unsupported agent ID type: ${typeof raw}.`,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Failed to parse agent ID: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Detects whether an error indicates a nonexistent ERC-721 / ERC-8004 token.
 */
export function isNonexistentTokenError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);

  // Check for OpenZeppelin ERC721NonexistentToken selector (0x7e273289) or name
  if (
    msg.includes("ERC721NonexistentToken") ||
    msg.includes("0x7e273289") ||
    msg.includes("nonexistent token") ||
    msg.includes("invalid token ID") ||
    msg.includes("owner query for nonexistent token")
  ) {
    return true;
  }

  // Viem ContractFunctionRevertedError with name or data
  const anyErr = err as Record<string, any>;
  if (anyErr?.data?.errorName === "ERC721NonexistentToken") {
    return true;
  }
  if (typeof anyErr?.data === "string" && anyErr.data.includes("0x7e273289")) {
    return true;
  }
  if (
    typeof anyErr?.cause?.data === "string" &&
    anyErr.cause.data.includes("0x7e273289")
  ) {
    return true;
  }

  // Safe fallback serialization with BigInt handler
  try {
    const serialized = JSON.stringify(err, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    );
    if (
      serialized.includes("ERC721NonexistentToken") ||
      serialized.includes("0x7e273289")
    ) {
      return true;
    }
  } catch {
    // Ignore serialization failure
  }

  return false;
}

/**
 * Normalizes an address string by ensuring a standard lowercase 0x prefix.
 */
function normalizeAddressInput(addr: string): `0x${string}` {
  const trimmed = addr.trim();
  if (trimmed.startsWith("0X") || trimmed.startsWith("0x")) {
    return `0x${trimmed.slice(2)}` as `0x${string}`;
  }
  return trimmed as `0x${string}`;
}

/**
 * Verifies an ERC-8004 agent identity against the Celo Mainnet registry.
 *
 * Performs strictly read-only calls:
 * 1. ownerOf(agentId)
 * 2. tokenURI(agentId)
 * 3. getAgentWallet(agentId)
 *
 * Ownership and operational wallet matches are evaluated and reported separately.
 * An unset agent wallet (zero address) is not a failure by itself.
 */
export async function verifyAgentIdentity(
  options: VerifyIdentityOptions = {}
): Promise<AgentIdentityVerificationResult> {
  const chainId = CELO_MAINNET_CHAIN_ID;

  // 1. Resolve & validate registry address
  const rawRegistry = normalizeAddressInput(
    options.registryAddress ||
      process.env.ERC8004_REGISTRY_ADDRESS ||
      ERC8004_REGISTRY_ADDRESS
  );

  if (!isAddress(rawRegistry, { strict: false })) {
    return {
      success: false,
      status: "ERROR",
      registryAddress: ERC8004_REGISTRY_ADDRESS,
      chainId,
      message: `Invalid ERC-8004 registry address format: "${rawRegistry}".`,
    };
  }
  const registryAddress = getAddress(rawRegistry);

  // 2. Resolve expected wallet address (if any)
  const rawExpectedInput =
    options.expectedAddress ||
    process.env.AGENT_WALLET_ADDRESS ||
    AGENT_WALLET_ADDRESS;

  let expectedAddress: Address | undefined;
  if (rawExpectedInput) {
    const rawExpected = normalizeAddressInput(rawExpectedInput);
    if (!isAddress(rawExpected, { strict: false })) {
      return {
        success: false,
        status: "ERROR",
        registryAddress,
        chainId,
        message: `Invalid expected wallet address format: "${rawExpectedInput}".`,
      };
    }
    expectedAddress = getAddress(rawExpected);
  }

  // 3. Resolve & validate agent ID
  const rawAgentId =
    options.agentId !== undefined
    ? options.agentId
    : process.env.ERC8004_AGENT_ID;

  if (rawAgentId === undefined || rawAgentId === null || rawAgentId === "") {
    return {
      success: false,
      status: "NOT_CONFIGURED",
      registryAddress,
      chainId,
      expectedAddress,
      message:
        "ERC-8004 Agent ID is not configured. Set ERC8004_AGENT_ID in environment or provide agentId in options.",
    };
  }

  const parseResult = parseAgentId(rawAgentId);
  if (!parseResult.valid) {
    return {
      success: false,
      status: "ERROR",
      registryAddress,
      chainId,
      expectedAddress,
      message: parseResult.error,
    };
  }
  const agentIdBigInt = parseResult.value;
  const agentIdStr = agentIdBigInt.toString();

  // 4. Initialize client (use provided reader or create read-only viem client)
  const rpcUrl =
    options.rpcUrl || process.env.CELO_RPC_URL || DEFAULT_CELO_RPC_URL;

  const client: ContractReader =
    options.client ||
    createPublicClient({
      chain: celo,
      transport: http(rpcUrl),
    });

  // 5. Query ownerOf(agentId)
  let rawOwner: Address;
  try {
    rawOwner = await client.readContract({
      address: registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "ownerOf",
      args: [agentIdBigInt],
    });
  } catch (err: unknown) {
    if (isNonexistentTokenError(err)) {
      return {
        success: false,
        status: "NONEXISTENT",
        agentId: agentIdStr,
        registryAddress,
        chainId,
        expectedAddress,
        message: `Agent ID ${agentIdStr} does not exist on Celo ERC-8004 Identity Registry (${registryAddress}).`,
      };
    }

    const errorDetails = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: "ERROR",
      agentId: agentIdStr,
      registryAddress,
      chainId,
      expectedAddress,
      message: `RPC error while querying ownerOf for agent ID ${agentIdStr}: ${errorDetails}`,
    };
  }

  const normalizedOwner =
    rawOwner && typeof rawOwner === "string"
      ? normalizeAddressInput(rawOwner)
      : rawOwner;

  if (!normalizedOwner || !isAddress(normalizedOwner, { strict: false })) {
    return {
      success: false,
      status: "ERROR",
      agentId: agentIdStr,
      registryAddress,
      chainId,
      expectedAddress,
      message: `Registry returned an invalid owner address for agent ID ${agentIdStr}.`,
    };
  }
  const owner = getAddress(normalizedOwner);

  // 6. Query tokenURI(agentId)
  let tokenURI = "";
  try {
    const rawUri = await client.readContract({
      address: registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "tokenURI",
      args: [agentIdBigInt],
    });
    if (typeof rawUri === "string") {
      tokenURI = rawUri;
    }
  } catch {
    // Non-critical: some contracts or tokens might have unset URI
    tokenURI = "";
  }

  // 7. Query getAgentWallet(agentId)
  let rawAgentWallet: Address = ZERO_ADDRESS;
  try {
    const walletRes = await client.readContract({
      address: registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "getAgentWallet",
      args: [agentIdBigInt],
    });
    const normalizedWallet =
      walletRes && typeof walletRes === "string"
        ? normalizeAddressInput(walletRes)
        : walletRes;
    if (normalizedWallet && isAddress(normalizedWallet, { strict: false })) {
      rawAgentWallet = getAddress(normalizedWallet);
    }
  } catch {
    // Non-critical: defaults to zero address
    rawAgentWallet = ZERO_ADDRESS;
  }
  const agentWallet = getAddress(rawAgentWallet);
  const isAgentWalletSet =
    agentWallet.toLowerCase() !== ZERO_ADDRESS.toLowerCase();

  const onChain: OnChainAgentIdentity = {
    owner,
    tokenURI,
    agentWallet,
  };

  // 8. Address Matching & Diagnostics
  if (expectedAddress) {
    const isOwnerMatch =
      owner.toLowerCase() === expectedAddress.toLowerCase();
    const isAgentWalletMatch =
      isAgentWalletSet &&
      agentWallet.toLowerCase() === expectedAddress.toLowerCase();

    const matchDetails: IdentityMatchDetails = {
      isOwnerMatch,
      isAgentWalletMatch,
      isAgentWalletSet,
    };

    if (isOwnerMatch || isAgentWalletMatch) {
      let matchMsg: string;
      if (isOwnerMatch && isAgentWalletMatch) {
        matchMsg = `Agent ID ${agentIdStr} fully verified: both contract owner and operational wallet match expected address (${expectedAddress}).`;
      } else if (isOwnerMatch && !isAgentWalletSet) {
        matchMsg = `Agent ID ${agentIdStr} verified: contract owner matches expected address (${expectedAddress}). Operational wallet is unset (not configured).`;
      } else if (isOwnerMatch && !isAgentWalletMatch) {
        matchMsg = `Agent ID ${agentIdStr} verified: contract owner matches expected address (${expectedAddress}). Note: operational wallet is set to another address (${agentWallet}).`;
      } else {
        matchMsg = `Agent ID ${agentIdStr} verified: operational wallet matches expected address (${expectedAddress}). Note: token is owned by ${owner}.`;
      }

      return {
        success: true,
        status: "VERIFIED",
        agentId: agentIdStr,
        registryAddress,
        chainId,
        expectedAddress,
        onChain,
        matchDetails,
        message: matchMsg,
      };
    }

    // Address Mismatch
    const walletDesc = isAgentWalletSet ? agentWallet : "unset";
    return {
      success: false,
      status: "MISMATCH",
      agentId: agentIdStr,
      registryAddress,
      chainId,
      expectedAddress,
      onChain,
      matchDetails,
      message: `Agent ID ${agentIdStr} identity mismatch: neither owner (${owner}) nor operational wallet (${walletDesc}) matches expected address (${expectedAddress}).`,
    };
  }

  // No expected address configured — report on-chain discovery
  return {
    success: true,
    status: "VERIFIED",
    agentId: agentIdStr,
    registryAddress,
    chainId,
    onChain,
    matchDetails: {
      isOwnerMatch: false,
      isAgentWalletMatch: false,
      isAgentWalletSet,
    },
    message: `Agent ID ${agentIdStr} exists on Celo: owned by ${owner}, operational wallet: ${isAgentWalletSet ? agentWallet : "unset"}.`,
  };
}

import { fileURLToPath } from "node:url";

/**
 * CLI Runner for manual or scripted identity verification.
 */
function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const currentFile = fileURLToPath(import.meta.url).toLowerCase();
    const executedFile = process.argv[1].toLowerCase();
    return currentFile === executedFile || executedFile.endsWith("identityservice.ts");
  } catch {
    return false;
  }
}

if (isDirectExecution() && !process.env.NODE_TEST_CONTEXT) {
  (async () => {
    console.log("=================================================");
    console.log("   ERC-8004 Identity Verification (Celo)        ");
    console.log("=================================================\n");

    const args = process.argv.slice(2);
    let cliAgentId: string | undefined;
    let cliExpectedAddress: string | undefined;

    for (let i = 0; i < args.length; i++) {
      if ((args[i] === "--agent-id" || args[i] === "--agentId") && args[i + 1]) {
        cliAgentId = args[i + 1];
        i++;
      } else if (
        (args[i] === "--expected-address" || args[i] === "--expectedAddress") &&
        args[i + 1]
      ) {
        cliExpectedAddress = args[i + 1];
        i++;
      }
    }

    const result = await verifyAgentIdentity({
      agentId: cliAgentId,
      expectedAddress: cliExpectedAddress,
    });

    console.log(`Status            : ${result.status}`);
    console.log(`Success           : ${result.success}`);
    console.log(`Agent ID          : ${result.agentId ?? "None"}`);
    console.log(`Registry Address  : ${result.registryAddress}`);
    console.log(`Celo Chain ID     : ${result.chainId}`);
    console.log(`Expected Address  : ${result.expectedAddress ?? "None"}`);

    if (result.onChain) {
      console.log("\n[On-Chain Record]");
      console.log(`  Owner Address   : ${result.onChain.owner}`);
      console.log(`  Agent Wallet    : ${result.onChain.agentWallet}`);
      console.log(`  Token URI       : ${result.onChain.tokenURI || "(none)"}`);
    }

    if (result.matchDetails) {
      console.log("\n[Match Diagnostics]");
      console.log(`  Owner Match     : ${result.matchDetails.isOwnerMatch}`);
      console.log(`  Wallet Set      : ${result.matchDetails.isAgentWalletSet}`);
      console.log(`  Wallet Match    : ${result.matchDetails.isAgentWalletMatch}`);
    }

    console.log("\n-------------------------------------------------");
    console.log(`Message: ${result.message}`);
    console.log("-------------------------------------------------\n");
  })().catch((err) => {
    console.error("Execution failed:", err);
  });
}
