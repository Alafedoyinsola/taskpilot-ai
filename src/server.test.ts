import * as http from "node:http";
import { createServer } from "./server.ts";

/**
 * ============================================================================
 * TEST SUITE: TaskPilot AI Browser Demo Web Server
 * Offline & Local Unit Tests (0 network calls to payment rails, $0 spent)
 * ============================================================================
 */

function makeRequest(
  server: http.Server,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Server address not available"));
      return;
    }

    const { port } = address;
    const req = (server as any)._events.request
      ? null
      : null; // TypeScript helper

    const clientReq = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString("utf-8");
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        });
      }
    );

    clientReq.on("error", reject);

    if (options.body) {
      clientReq.write(options.body);
    }
    clientReq.end();
  });
}

async function runServerTests(): Promise<void> {
  console.log("=================================================");
  console.log("  Testing Browser Demo Web Server (Unit Tests)   ");
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

  // Start local test server on port 0 (OS-assigned ephemeral port)
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  try {
    // TEST 1: GET / serves HTML single-page app
    const resRoot = await makeRequest(server, "/");
    assert("GET / returns HTTP 200", resRoot.statusCode === 200);
    assert(
      "GET / Content-Type is text/html",
      Boolean(resRoot.headers["content-type"]?.includes("text/html"))
    );
    assert(
      "GET / contains TaskPilot AI brand",
      resRoot.body.includes("TaskPilot AI")
    );
    assert(
      "GET / prominently features mandatory safety disclosure",
      resRoot.body.includes("Deterministic Planning & Read-Only DeFi Research") &&
        resRoot.body.includes("strictly disabled")
    );
    assert(
      "GET / references Celo Mainnet 42220 and Agent ID 9964",
      resRoot.body.includes("42220") && resRoot.body.includes("9964")
    );
    assert(
      "GET / includes 'Run Research' and 'Generate Plan Only' actions",
      resRoot.body.includes("Run Research") && resRoot.body.includes("Generate Plan Only")
    );
    assert(
      "GET / includes nosniff security header",
      resRoot.headers["x-content-type-options"] === "nosniff"
    );

    // TEST 2: GET /api/health
    const resHealth = await makeRequest(server, "/api/health");
    assert("GET /api/health returns HTTP 200", resHealth.statusCode === 200);
    const healthJson = JSON.parse(resHealth.body);
    assert("Health status is 'ok'", healthJson.status === "ok");
    assert("Health confirms paidExecution is false", healthJson.paidExecution === false);
    assert("Health confirms readOnly is true", healthJson.readOnly === true);
    assert("Health specifies Celo chainId 42220", healthJson.chainId === 42220);
    assert("Health specifies Agent ID 9964", healthJson.agentId === 9964);

    // TEST 3: POST /api/plan with valid input
    const resPlanValid = await makeRequest(server, "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Research top Celo DeFi protocols by TVL" }),
    });
    assert("POST /api/plan returns HTTP 200", resPlanValid.statusCode === 200);
    const planJson = JSON.parse(resPlanValid.body);
    assert("POST /api/plan response success is true", planJson.success === true);
    assert("POST /api/plan produces exactly 4 steps", planJson.plan?.steps?.length === 4);
    assert(
      "Plan Step 1 is 'Identify Information Sources'",
      planJson.plan?.steps[0]?.title === "Identify Information Sources"
    );
    assert(
      "Plan Step 4 is 'Synthesize Final Report'",
      planJson.plan?.steps[3]?.title === "Synthesize Final Report"
    );

    // TEST 4: POST /api/plan with empty or invalid input
    const resPlanEmpty = await makeRequest(server, "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "   " }),
    });
    assert("POST /api/plan rejects empty task with HTTP 400", resPlanEmpty.statusCode === 400);
    const planEmptyJson = JSON.parse(resPlanEmpty.body);
    assert("POST /api/plan empty task error reported", planEmptyJson.success === false);

    // TEST 5: POST /api/plan with oversized task string
    const longTask = "A".repeat(501);
    const resPlanLong = await makeRequest(server, "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: longTask }),
    });
    assert("POST /api/plan rejects string > 500 chars with HTTP 400", resPlanLong.statusCode === 400);

    // TEST 6: POST /api/research with valid input
    const resResearch = await makeRequest(server, "/api/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Evaluate active Celo DeFi ecosystem protocols" }),
    });
    assert("POST /api/research returns HTTP 200", resResearch.statusCode === 200);
    const researchJson = JSON.parse(resResearch.body);
    assert("POST /api/research includes generated 4-step plan", researchJson.plan?.steps?.length === 4);
    assert(
      "POST /api/research includes research result object",
      Boolean(researchJson.research && typeof researchJson.research === "object")
    );
    if (researchJson.research?.protocols) {
      assert(
        "POST /api/research protocols is an array",
        Array.isArray(researchJson.research.protocols)
      );
    }

    // TEST 7: Unsupported HTTP method on API endpoint
    const resDisallowed = await makeRequest(server, "/api/plan", {
      method: "DELETE",
    });
    assert("Disallowed HTTP method returns HTTP 405", resDisallowed.statusCode === 405);
    assert("Response specifies Allow header", Boolean(resDisallowed.headers["allow"]));

    // TEST 8: Unknown route
    const res404 = await makeRequest(server, "/api/unknown-endpoint");
    assert("Unknown endpoint returns HTTP 404", res404.statusCode === 404);

    // TEST 9: Payload size limit enforcement (exceeding 16KB)
    const oversizedBody = JSON.stringify({ task: "x".repeat(17 * 1024) });
    const resOversized = await makeRequest(server, "/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });
    assert(
      "Oversized request body returns 413 or 400",
      resOversized.statusCode === 413 || resOversized.statusCode === 400
    );

    // TEST 10: Zero secrets or paid parameters exposed
    const allResponses = [resRoot.body, resHealth.body, resPlanValid.body, resResearch.body].join(" ");
    assert(
      "Zero private keys or seed phrases in any HTTP response",
      !allResponses.includes("PRIVATE_KEY") && !allResponses.includes("0x129910Aaf23898DDC16Af3d98178d9Dd0bb4C292")
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log("\n=================================================");
  console.log(`  Result: ${passed} / ${total} tests passed`);
  console.log("=================================================\n");

  if (passed !== total) {
    process.exit(1);
  }
}

// Execute tests
runServerTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
