/**
 * x402 Payment Challenge & Quote Validation Service
 * Follows the official Celo x402 / @celo/buy protocol specification.
 */

/**
 * Raw payment requirement offer returned inside the HTTP 402 challenge.
 */
export interface X402PaymentRequirement {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  asset: string;
  extra?: {
    name?: string;
    symbol?: string;
    version?: string;
    decimals?: number;
    [key: string]: unknown;
  };
}

/**
 * Structure of the HTTP 402 response payload.
 */
export interface X402PaymentChallenge {
  x402Version?: number;
  accepts?: X402PaymentRequirement[];
  error?: string;
}

/**
 * Validated quote safe for presenting to the user.
 */
export interface ValidatedQuote {
  isValid: true;
  network: string;
  scheme: string;
  tokenSymbol: string;
  tokenAddress: string;
  recipientAddress: string;
  atomicAmount: string;
  humanAmount: string;
  decimals: number;
  description: string;
  resource: string;
  timeoutSeconds: number;
}

/**
 * Rejected quote details.
 */
export interface InvalidQuote {
  isValid: false;
  reason: string;
}

export type QuoteValidationResult = ValidatedQuote | InvalidQuote;

/**
 * Validates whether a given string is a valid 20-byte EVM hex address.
 */
function isValidEvmAddress(address: unknown): address is string {
  return typeof address === "string" && /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validates that an atomic amount is a strictly positive numeric integer string.
 */
function isValidAtomicAmount(amount: unknown): amount is string {
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) {
    return false;
  }
  try {
    return BigInt(amount) > 0n;
  } catch {
    return false;
  }
}

/**
 * Known token decimals lookup for verified Celo stablecoins.
 */
const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  // Celo Mainnet USDC (Circle)
  "0xceba9300f2b948710d2653dd7b07f33a8b32118c": 6,
  // Celo Mainnet USDT (Tether)
  "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e": 6,
  // Celo Mainnet USAT (Tether America USD)
  "0xd2ab3c9a02dbbab236bfec45d1d755df4267f771": 6,
  // Celo Sepolia USDC
  "0x01c5c0122039549ad1493b8220cabedd739bc44e": 6,
};

/**
 * Parses and strictly validates an untrusted HTTP 402 challenge payload.
 *
 * @param challenge The raw, untrusted data received from a 402 response
 * @param preferredToken Optional token address preference
 * @returns QuoteValidationResult (either ValidatedQuote or InvalidQuote)
 */
export function validateX402Challenge(
  challenge: unknown,
  preferredToken?: string
): QuoteValidationResult {
  if (!challenge || typeof challenge !== "object") {
    return { isValid: false, reason: "Payment challenge payload must be a non-null object." };
  }

  const raw = challenge as Record<string, unknown>;

  if (!Array.isArray(raw.accepts) || raw.accepts.length === 0) {
    return {
      isValid: false,
      reason: "Payment challenge missing or empty 'accepts' requirements list.",
    };
  }

  // Find preferred token offer, or default to the first valid offer in accepts
  const offers = raw.accepts as unknown[];
  let selectedOffer: X402PaymentRequirement | null = null;

  for (const item of offers) {
    if (!item || typeof item !== "object") continue;
    const req = item as X402PaymentRequirement;

    if (preferredToken && req.asset?.toLowerCase() === preferredToken.toLowerCase()) {
      selectedOffer = req;
      break;
    }

    if (!selectedOffer && req.asset && req.payTo && req.maxAmountRequired) {
      selectedOffer = req;
    }
  }

  if (!selectedOffer) {
    return { isValid: false, reason: "No parsable payment offers found in 'accepts' array." };
  }

  // 1. Validate Recipient Address (payTo)
  if (!isValidEvmAddress(selectedOffer.payTo)) {
    return {
      isValid: false,
      reason: `Recipient address (payTo: "${selectedOffer.payTo}") is not a valid EVM address.`,
    };
  }

  // 2. Validate Asset Address
  if (!isValidEvmAddress(selectedOffer.asset)) {
    return {
      isValid: false,
      reason: `Asset token contract address ("${selectedOffer.asset}") is not a valid EVM address.`,
    };
  }

  // 3. Validate Amount
  if (!isValidAtomicAmount(selectedOffer.maxAmountRequired)) {
    return {
      isValid: false,
      reason: `Amount required ("${selectedOffer.maxAmountRequired}") is not a valid positive integer.`,
    };
  }

  // 4. Validate Network
  const network = typeof selectedOffer.network === "string" ? selectedOffer.network.trim() : "";
  if (!network) {
    return { isValid: false, reason: "Payment offer does not specify a valid network." };
  }

  // Determine decimals and calculate human-readable amount
  const tokenAddressLower = selectedOffer.asset.toLowerCase();
  const decimals =
    typeof selectedOffer.extra?.decimals === "number" && selectedOffer.extra.decimals > 0
      ? selectedOffer.extra.decimals
      : KNOWN_TOKEN_DECIMALS[tokenAddressLower] ?? 6;

  const tokenSymbol =
    typeof selectedOffer.extra?.name === "string" && selectedOffer.extra.name.trim()
      ? selectedOffer.extra.name.trim()
      : typeof selectedOffer.extra?.symbol === "string" && selectedOffer.extra.symbol.trim()
      ? selectedOffer.extra.symbol.trim()
      : "TOKEN";

  const atomicBn = BigInt(selectedOffer.maxAmountRequired);
  const divisor = 10n ** BigInt(decimals);
  const wholeUnits = atomicBn / divisor;
  const fractionUnits = (atomicBn % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  const humanAmount = fractionUnits ? `${wholeUnits}.${fractionUnits}` : `${wholeUnits}`;

  return {
    isValid: true,
    network,
    scheme: typeof selectedOffer.scheme === "string" ? selectedOffer.scheme : "exact",
    tokenSymbol,
    tokenAddress: selectedOffer.asset,
    recipientAddress: selectedOffer.payTo,
    atomicAmount: selectedOffer.maxAmountRequired,
    humanAmount,
    decimals,
    description: typeof selectedOffer.description === "string" ? selectedOffer.description : "Paid Service",
    resource: typeof selectedOffer.resource === "string" ? selectedOffer.resource : "",
    timeoutSeconds: typeof selectedOffer.maxTimeoutSeconds === "number" ? selectedOffer.maxTimeoutSeconds : 60,
  };
}

/**
 * Formats a validated quote into an easy-to-read summary for display to the user.
 */
export function formatQuoteSummary(quote: ValidatedQuote): string {
  return [
    `  Service     : ${quote.description}`,
    `  Price       : ${quote.humanAmount} ${quote.tokenSymbol} (${quote.atomicAmount} atomic units)`,
    `  Network     : ${quote.network}`,
    `  Token Asset : ${quote.tokenAddress}`,
    `  Pay To      : ${quote.recipientAddress}`,
  ].join("\n");
}
