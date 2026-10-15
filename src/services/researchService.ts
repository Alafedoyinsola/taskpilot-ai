/**
 * Data structure representing a DeFi protocol retrieved from DefiLlama.
 */
export interface DefiProtocol {
  name: string;
  category: string;
  celoTvlUsd: number;
  url: string;
}

/**
 * Result returned by the real research service.
 */
export interface RealResearchResult {
  success: boolean;
  source: string;
  sourceUrl: string;
  query: string;
  isRealData: true;
  protocols: DefiProtocol[];
  fetchedAt: string;
  summary: string;
  error?: string;
}

/**
 * Fetches real, live DeFi protocol statistics for the Celo blockchain
 * using DefiLlama's free, public, keyless API.
 *
 * @param timeoutMs Timeout in milliseconds (default 8000ms)
 * @returns RealResearchResult with verified protocol information
 */
export async function fetchCeloDefiProjects(timeoutMs: number = 8000): Promise<RealResearchResult> {
  const sourceName = "DefiLlama Public Protocols API";
  const sourceUrl = "https://api.llama.fi/protocols";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`DefiLlama API returned HTTP status ${response.status} (${response.statusText})`);
    }

    const data = (await response.json()) as Array<{
      name?: string;
      category?: string;
      url?: string;
      chainTvls?: Record<string, number>;
    }>;

    if (!Array.isArray(data)) {
      throw new Error("Invalid response format received from DefiLlama API (expected an array).");
    }

    // Filter for real DeFi protocols with active TVL on Celo (excluding centralized exchanges)
    const celoProtocols: DefiProtocol[] = data
      .filter(
        (p) =>
          p.name &&
          p.category &&
          p.category !== "CEX" &&
          p.chainTvls &&
          typeof p.chainTvls.Celo === "number" &&
          p.chainTvls.Celo > 0
      )
      .sort((a, b) => (b.chainTvls?.Celo ?? 0) - (a.chainTvls?.Celo ?? 0))
      .slice(0, 5)
      .map((p) => ({
        name: p.name ?? "Unknown",
        category: p.category ?? "DeFi",
        celoTvlUsd: Math.round(p.chainTvls?.Celo ?? 0),
        url: p.url ?? "",
      }));

    if (celoProtocols.length === 0) {
      return {
        success: false,
        source: sourceName,
        sourceUrl,
        query: "Celo DeFi protocols",
        isRealData: true,
        protocols: [],
        fetchedAt: new Date().toISOString(),
        summary: "No active Celo DeFi protocols were found in the current API response.",
      };
    }

    const formattedList = celoProtocols
      .map((p, idx) => `${idx + 1}. ${p.name} (${p.category}) — $${p.celoTvlUsd.toLocaleString()} TVL [${p.url}]`)
      .join("\n      ");

    const summary = `Found ${celoProtocols.length} top active DeFi protocols on Celo:\n      ${formattedList}`;

    return {
      success: true,
      source: sourceName,
      sourceUrl,
      query: "Celo DeFi protocols",
      isRealData: true,
      protocols: celoProtocols,
      fetchedAt: new Date().toISOString(),
      summary,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const errorMessage = isTimeout
      ? `Request timed out after ${timeoutMs}ms while connecting to ${sourceUrl}`
      : err instanceof Error
      ? err.message
      : String(err);

    return {
      success: false,
      source: sourceName,
      sourceUrl,
      query: "Celo DeFi protocols",
      isRealData: true,
      protocols: [],
      fetchedAt: new Date().toISOString(),
      summary: `Real research service failed: ${errorMessage}`,
      error: errorMessage,
    };
  } finally {
    clearTimeout(timer);
  }
}
