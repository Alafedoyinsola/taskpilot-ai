import {
  parseAgentId,
  isNonexistentTokenError,
  verifyAgentIdentity,
  ERC8004_REGISTRY_ADDRESS,
  CELO_MAINNET_CHAIN_ID,
  ZERO_ADDRESS,
  type ContractReader,
} from "./identityService.ts";

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
