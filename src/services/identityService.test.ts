import {
  parseAgentId,
  isNonexistentTokenError,
  verifyAgentIdentity,
  prepareRegistrationCalldata,
  prepareAttributedRegistrationTransaction,
  createAgentRegistrationUri,
  DEFAULT_TASKPILOT_REGISTRATION_DOC,
  ERC8004_REGISTRY_ADDRESS,
  CELO_MAINNET_CHAIN_ID,
  ZERO_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  type ContractReader,
} from "./identityService.ts";
import { decodeFunctionData } from "viem";
import { fromDataSuffix } from "@celo/attribution-tags";
import { ATTRIBUTION_TAG } from "../config/attribution.ts";

/**
 * ============================================================================
 * TEST SUITE: ERC-8004 Identity Registry Service (Offline Unit Tests)
 * (100% Mocked Contract Reads, Zero Network Calls, Zero Private Keys)
 * ============================================================================
 */

async function runIdentityServiceTests(): Promise<void> {
  console.log("=================================================");
  console.log("  Testing ERC-8004 Identity Service (Offline)   ");
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

  const sampleOwner = "0x548c2aB49A592c288F69F9B618A723DA47e56F89";
  const otherOwner = "0x6446ad9821021eeb9f85b8a18b0153d58166d161";
  const sampleWallet = "0x20faAca5F980E29639A0FCC6dcA6988E18ed333B";
  const sampleUri = "data:application/json;base64,eyJuYW1lIjoiVGFza1BpbG90In0=";

  // 1. Constants verification
  assert("Celo Mainnet chain ID is 42220", CELO_MAINNET_CHAIN_ID === 42220);
  assert(
    "Registry address matches canonical Celo deployment",
    ERC8004_REGISTRY_ADDRESS === "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  );
  assert(
    "Zero address is canonical 20-byte zero hex",
    ZERO_ADDRESS === "0x0000000000000000000000000000000000000000"
  );

  // 2. parseAgentId unit tests
  const parseVal1 = parseAgentId("42");
  assert("parseAgentId accepts valid numeric string", parseVal1.valid && parseVal1.value === 42n);

  const parseVal2 = parseAgentId(100);
  assert("parseAgentId accepts integer number", parseVal2.valid && parseVal2.value === 100n);

  const parseVal3 = parseAgentId(999n);
  assert("parseAgentId accepts bigint", parseVal3.valid && parseVal3.value === 999n);

  const parseEmpty = parseAgentId("");
  assert("parseAgentId rejects empty string", !parseEmpty.valid);

  const parseUndef = parseAgentId(undefined);
  assert("parseAgentId rejects undefined", !parseUndef.valid);

  const parseAlpha = parseAgentId("agent_123");
  assert("parseAgentId rejects non-numeric string", !parseAlpha.valid);

  const parseNeg = parseAgentId("-5");
  assert("parseAgentId rejects negative numeric string", !parseNeg.valid);

  const parseFloat = parseAgentId(3.14);
  assert("parseAgentId rejects floating point number", !parseFloat.valid);

  // 3. isNonexistentTokenError unit tests
  assert(
    "Detects ERC721NonexistentToken in error message",
    isNonexistentTokenError(new Error("execution reverted: ERC721NonexistentToken(1)"))
  );
  assert(
    "Detects selector 0x7e273289 in error data",
    isNonexistentTokenError({ data: "0x7e27328900000000000000000000000000000000" })
  );
  assert(
    "Detects nonexistent token phrase",
    isNonexistentTokenError(new Error("owner query for nonexistent token"))
  );
  assert(
    "Does not misidentify network error as nonexistent token",
    !isNonexistentTokenError(new Error("fetch failed: ECONNREFUSED"))
  );

  // 4. verifyAgentIdentity: NOT_CONFIGURED when no agent ID is provided
  const savedEnv = process.env.ERC8004_AGENT_ID;
  delete process.env.ERC8004_AGENT_ID;

  const resNotConfigured = await verifyAgentIdentity();
  assert("Returns NOT_CONFIGURED when no agentId is provided", resNotConfigured.status === "NOT_CONFIGURED");
  assert("Success is false when NOT_CONFIGURED", resNotConfigured.success === false);

  // 5. verifyAgentIdentity: Invalid Agent ID format returns ERROR
  const resInvalidId = await verifyAgentIdentity({ agentId: "not-a-number" });
  assert("Returns ERROR on invalid agent ID", resInvalidId.status === "ERROR");
  assert("Success is false on invalid agent ID", resInvalidId.success === false);

  // 6. verifyAgentIdentity: Invalid Registry Address format returns ERROR
  const resInvalidRegistry = await verifyAgentIdentity({
    agentId: 1,
    registryAddress: "0xInvalidRegistry",
  });
  assert("Returns ERROR on invalid registry address", resInvalidRegistry.status === "ERROR");

  // 7. verifyAgentIdentity: Invalid Expected Address returns ERROR
  const resInvalidExpected = await verifyAgentIdentity({
    agentId: 1,
    expectedAddress: "0xNotAnAddress",
  });
  assert("Returns ERROR on invalid expected address", resInvalidExpected.status === "ERROR");

  // 8. verifyAgentIdentity: VERIFIED with owner match & unset agent wallet
  const mockClientOwnerMatchUnsetWallet: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return sampleOwner;
      if (functionName === "tokenURI") return sampleUri;
      if (functionName === "getAgentWallet") return ZERO_ADDRESS;
      throw new Error(`Unexpected function call: ${functionName}`);
    },
  };

  const resOwnerMatch = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientOwnerMatchUnsetWallet,
  });

  assert("Returns VERIFIED when contract owner matches expected address", resOwnerMatch.status === "VERIFIED");
  assert("Success is true when contract owner matches", resOwnerMatch.success === true);
  assert("Owner match is true", resOwnerMatch.matchDetails?.isOwnerMatch === true);
  assert("Agent wallet is recognized as unset", resOwnerMatch.matchDetails?.isAgentWalletSet === false);
  assert("Agent wallet match is false when unset", resOwnerMatch.matchDetails?.isAgentWalletMatch === false);
  assert(
    "Unset agent wallet does NOT cause verification failure",
    resOwnerMatch.message.includes("Operational wallet is unset")
  );

  // 9. verifyAgentIdentity: VERIFIED with both owner and operational wallet matching
  const mockClientBothMatch: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return sampleOwner;
      if (functionName === "tokenURI") return sampleUri;
      if (functionName === "getAgentWallet") return sampleOwner;
      throw new Error(`Unexpected function call: ${functionName}`);
    },
  };

  const resBothMatch = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientBothMatch,
  });

  assert("Returns VERIFIED when both owner and wallet match", resBothMatch.status === "VERIFIED");
  assert("isOwnerMatch is true when both match", resBothMatch.matchDetails?.isOwnerMatch === true);
  assert("isAgentWalletMatch is true when both match", resBothMatch.matchDetails?.isAgentWalletMatch === true);
  assert("isAgentWalletSet is true when wallet is configured", resBothMatch.matchDetails?.isAgentWalletSet === true);

  // 10. verifyAgentIdentity: VERIFIED with operational wallet match (delegated ownership)
  const mockClientDelegatedWallet: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return otherOwner;
      if (functionName === "tokenURI") return sampleUri;
      if (functionName === "getAgentWallet") return sampleOwner;
      throw new Error(`Unexpected function call: ${functionName}`);
    },
  };

  const resDelegated = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientDelegatedWallet,
  });

  assert("Returns VERIFIED when operational wallet matches even if owner differs", resDelegated.status === "VERIFIED");
  assert("isOwnerMatch is false for delegated agent", resDelegated.matchDetails?.isOwnerMatch === false);
  assert("isAgentWalletMatch is true for delegated agent", resDelegated.matchDetails?.isAgentWalletMatch === true);

  // 11. verifyAgentIdentity: MISMATCH when neither owner nor operational wallet matches
  const mockClientMismatch: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return otherOwner;
      if (functionName === "tokenURI") return sampleUri;
      if (functionName === "getAgentWallet") return sampleWallet;
      throw new Error(`Unexpected function call: ${functionName}`);
    },
  };

  const resMismatch = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientMismatch,
  });

  assert("Returns MISMATCH when neither address matches expected", resMismatch.status === "MISMATCH");
  assert("Success is false on MISMATCH", resMismatch.success === false);
  assert("isOwnerMatch is false on MISMATCH", resMismatch.matchDetails?.isOwnerMatch === false);
  assert("isAgentWalletMatch is false on MISMATCH", resMismatch.matchDetails?.isAgentWalletMatch === false);

  // 12. verifyAgentIdentity: NONEXISTENT agent handling
  const mockClientNonexistent: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") {
        const revertError = new Error("execution reverted");
        (revertError as any).data = "0x7e273289000000000000000000000000000000000000000000000000000000000000002a";
        throw revertError;
      }
      return ZERO_ADDRESS;
    },
  };

  const resNonexistent = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientNonexistent,
  });

  assert("Returns NONEXISTENT when ownerOf reverts with ERC721NonexistentToken", resNonexistent.status === "NONEXISTENT");
  assert("Success is false for nonexistent agent", resNonexistent.success === false);
  assert("Message clearly identifies missing agent", resNonexistent.message.includes("does not exist"));

  // 13. verifyAgentIdentity: RPC error handling
  const mockClientRpcError: ContractReader = {
    readContract: async () => {
      throw new Error("fetch failed (ENOTFOUND forno.celo.org)");
    },
  };

  const resRpcError = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientRpcError,
  });

  assert("Returns ERROR on RPC network failure", resRpcError.status === "ERROR");
  assert("Success is false on RPC network failure", resRpcError.success === false);
  assert("Message includes RPC error details safely", resRpcError.message.includes("RPC error while querying"));

  // 14. verifyAgentIdentity: Gracefully handles tokenURI and getAgentWallet fallback
  const mockClientPartialFallback: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return sampleOwner;
      if (functionName === "tokenURI") throw new Error("No tokenURI implemented");
      if (functionName === "getAgentWallet") throw new Error("No getAgentWallet implemented");
      throw new Error("Unknown");
    },
  };

  const resFallback = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner,
    client: mockClientPartialFallback,
  });

  assert("Tolerates tokenURI and getAgentWallet failure when ownerOf succeeds", resFallback.status === "VERIFIED");
  assert("TokenURI safely defaults to empty string", resFallback.onChain?.tokenURI === "");
  assert("AgentWallet safely defaults to zero address", resFallback.onChain?.agentWallet === ZERO_ADDRESS);

  // 15. verifyAgentIdentity: Case-insensitive address matching
  const mockClientCase: ContractReader = {
    readContract: async ({ functionName }) => {
      if (functionName === "ownerOf") return sampleOwner.toUpperCase() as `0x${string}`;
      if (functionName === "tokenURI") return "";
      if (functionName === "getAgentWallet") return ZERO_ADDRESS;
      throw new Error("Unknown");
    },
  };

  const resCase = await verifyAgentIdentity({
    agentId: 42,
    expectedAddress: sampleOwner.toLowerCase(),
    client: mockClientCase,
  });

  assert("Matches addresses case-insensitively", resCase.status === "VERIFIED");
  assert("isOwnerMatch is true across case variations", resCase.matchDetails?.isOwnerMatch === true);

  // 16. ERC-8004 Registration Document & Attribution Calldata Preparation
  assert(
    "Registration document conforms to ERC-8004 registration-v1 type",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.type ===
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  );
  assert(
    "Registration document specifies TaskPilot AI name",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.name === "TaskPilot AI"
  );
  assert(
    "Registration document sets x402Support to false (client buyer)",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.x402Support === false
  );
  assert(
    "Registration document omits nonexistent image field",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.image === undefined
  );
  assert(
    "Registration document sets supportedTrust to empty array (discovery only)",
    Array.isArray(DEFAULT_TASKPILOT_REGISTRATION_DOC.supportedTrust) &&
      DEFAULT_TASKPILOT_REGISTRATION_DOC.supportedTrust.length === 0
  );
  assert(
    "Registration document marks active as true (fully tested on-demand client)",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.active === true
  );
  assert(
    "Registration document binds Celo Mainnet registry address",
    DEFAULT_TASKPILOT_REGISTRATION_DOC.registrations[0]?.agentRegistry ===
      `eip155:42220:${ERC8004_REGISTRY_ADDRESS}`
  );

  const uri = createAgentRegistrationUri();
  assert(
    "createAgentRegistrationUri produces RFC 2397 base64 data URI",
    uri.startsWith("data:application/json;base64,")
  );

  const rawCalldata = prepareRegistrationCalldata(uri);
  assert(
    "prepareRegistrationCalldata encodes canonical register selector 0xf2c298be",
    rawCalldata.startsWith("0xf2c298be")
  );

  const preparedTx = prepareAttributedRegistrationTransaction();
  assert(
    "Prepared transaction targets canonical Celo Mainnet Identity Registry",
    preparedTx.to === ERC8004_REGISTRY_ADDRESS
  );
  assert(
    "Prepared transaction specifies Celo Mainnet chain ID 42220",
    preparedTx.chainId === 42220
  );
  assert("Prepared transaction value is 0 CELO", preparedTx.value === 0n);
  assert(
    "Prepared transaction function selector is 0xf2c298be",
    preparedTx.functionSelector === "0xf2c298be"
  );
  assert(
    "Prepared transaction applies assigned Loops House attribution tag",
    preparedTx.attributionTag === ATTRIBUTION_TAG
  );

  // 17. Decode register(string) calldata and verify parsed JSON & suffix
  const suffixLenHex = 70; // 35 bytes * 2 hex chars
  const fullCalldata = preparedTx.calldataWithAttribution;
  const rawFromTagged = fullCalldata.slice(
    0,
    fullCalldata.length - suffixLenHex
  ) as `0x${string}`;
  const suffixFromTagged = ("0x" +
    fullCalldata.slice(fullCalldata.length - suffixLenHex)) as `0x${string}`;

  // Verify decodeFunctionData extracts the exact agentURI argument
  const decodedFunction = decodeFunctionData({
    abi: IDENTITY_REGISTRY_ABI,
    data: rawFromTagged,
  });
  assert(
    "decodeFunctionData recognizes register function name",
    decodedFunction.functionName === "register"
  );
  assert(
    "decodeFunctionData extracts exactly 1 argument",
    Array.isArray(decodedFunction.args) && decodedFunction.args.length === 1
  );

  const extractedUri = decodedFunction.args[0] as string;
  assert("Extracted agentURI matches prepared URI", extractedUri === uri);
  assert(
    "Extracted agentURI has RFC 2397 base64 prefix",
    extractedUri.startsWith("data:application/json;base64,")
  );

  const decodedJsonStr = Buffer.from(
    extractedUri.replace("data:application/json;base64,", ""),
    "base64"
  ).toString("utf8");
  const decodedDoc = JSON.parse(decodedJsonStr);

  assert(
    "Decoded document has valid ERC-8004 type",
    decodedDoc.type ===
      "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
  );
  assert(
    "Decoded document has name TaskPilot AI",
    decodedDoc.name === "TaskPilot AI"
  );
  assert(
    "Decoded document omits image property",
    decodedDoc.image === undefined
  );
  assert(
    "Decoded document has x402Support = false",
    decodedDoc.x402Support === false
  );
  assert("Decoded document has active = true", decodedDoc.active === true);
  assert(
    "Decoded document has supportedTrust = []",
    Array.isArray(decodedDoc.supportedTrust) &&
      decodedDoc.supportedTrust.length === 0
  );
  assert(
    "Decoded document has services pointing to repository",
    decodedDoc.services[0]?.endpoint ===
      "https://github.com/Alafedoyinsola/taskpilot-ai"
  );
  assert(
    "Decoded document has registrations pointing to Celo Mainnet registry",
    decodedDoc.registrations[0]?.agentRegistry ===
      `eip155:42220:${ERC8004_REGISTRY_ADDRESS}`
  );

  // Suffix byte-level structure checks
  assert(
    "Attribution suffix length is exactly 35 bytes (70 hex characters)",
    suffixFromTagged.length - 2 === 70
  );
  assert(
    "Attribution suffix matches toDataSuffix(ATTRIBUTION_TAG)",
    suffixFromTagged === preparedTx.attributionSuffix
  );

  const decodedAttribution = fromDataSuffix(fullCalldata);
  assert(
    "fromDataSuffix successfully parses attribution from complete calldata",
    decodedAttribution !== null
  );
  assert(
    "Decoded attribution codes array contains celo_c386b0979578",
    decodedAttribution !== null &&
      decodedAttribution.codes.includes(ATTRIBUTION_TAG)
  );
  assert(
    "Decoded attribution schemaId is Schema 0",
    decodedAttribution?.schemaId === 0
  );

  // Restore env if it was set
  if (savedEnv !== undefined) {
    process.env.ERC8004_AGENT_ID = savedEnv;
  }

  console.log(`\n=================================================`);
  console.log(`  Result: ${passed} / ${total} tests passed (100% offline, $0 spent)`);
  console.log(`=================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

runIdentityServiceTests();
