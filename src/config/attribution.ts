/**
 * Project Attribution & Identity Configuration for TaskPilot AI
 * Celo — Agents on Open Rails Hackathon (Build with buy track)
 *
 * All values in this file are strictly PUBLIC metadata.
 * NEVER store private keys, mnemonics, or secrets in this file.
 */

export interface ProjectAttributionConfig {
  readonly attributionTag: string;
  readonly agentWalletAddress: string;
  readonly repositoryUrl: string;
  readonly hackathon: string;
  readonly track: string;
}

/**
 * Verified Loops House Celo Mainnet attribution tag (ERC-8021 standard).
 */
export const ATTRIBUTION_TAG = "celo_c386b0979578" as const;

/**
 * Public agent wallet address on Celo.
 */
export const AGENT_WALLET_ADDRESS = "0x548c2aB49A592c288F69F9B618A723DA47e56F89" as const;

/**
 * Official GitHub repository for TaskPilot AI.
 */
export const REPOSITORY_URL = "https://github.com/Alafedoyinsola/taskpilot-ai" as const;

/**
 * Consolidated project attribution configuration object.
 */
export const ATTRIBUTION_CONFIG: ProjectAttributionConfig = {
  attributionTag: ATTRIBUTION_TAG,
  agentWalletAddress: AGENT_WALLET_ADDRESS,
  repositoryUrl: REPOSITORY_URL,
  hackathon: "Celo — Agents on Open Rails",
  track: "Build with buy",
} as const;
