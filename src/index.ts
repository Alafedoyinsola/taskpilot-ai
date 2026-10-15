import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createPlan } from "./agent/planner.ts";
import { executePlan } from "./agent/executor.ts";

/**
 * TaskPilot AI - Terminal Interface
 * Interactive prompt that plans, quotes, approves, and executes user tasks.
 */
async function main(): Promise<void> {
  console.log("==========================================");
  console.log("   TaskPilot AI — Task Assistant (Celo)   ");
  console.log("==========================================\n");

  const rl = readline.createInterface({ input, output });

  try {
    const rawInput = await rl.question("What task would you like TaskPilot to complete?\n> ");
    const taskDescription = rawInput.trim();

    // Handle empty input gracefully
    if (!taskDescription) {
      console.log("\n[Notice] No task was entered. Please provide a task description to proceed.");
      return;
    }

    // Acknowledge receipt of the task
    console.log("\n------------------------------------------");
    console.log("[Task Received]");
    console.log(`Task: "${taskDescription}"`);
    console.log("Status: Captured by TaskPilot AI.");
    console.log("------------------------------------------");

    // 1. Generate actionable plan using the Task Planner
    const plan = createPlan(taskDescription);

    console.log("\n[Execution Plan Generated]");
    console.log(`Total Steps: ${plan.totalSteps}\n`);

    for (const step of plan.steps) {
      console.log(`  Step ${step.stepNumber}: [${step.title}]`);
      console.log(`  Target Service : ${step.serviceType}`);
      console.log(`  Action         : ${step.description}\n`);
    }

    // Callback to request explicit user approval for paid steps
    const askApproval = async (promptText: string): Promise<boolean> => {
      try {
        const answer = await rl.question(promptText);
        const trimmed = answer.trim().toLowerCase();
        return trimmed === "y" || trimmed === "yes";
      } catch {
        // Safe fallback: if terminal input is closed or unavailable, decline payment by default
        return false;
      }
    };

    // 2. Execute plan using the Task Executor with the approval callback
    const executionResult = await executePlan(plan, askApproval);

    // 3. Display execution outcome summary
    console.log("------------------------------------------");
    console.log("[Execution Summary]");
    console.log(`Status         : ${executionResult.status.toUpperCase()}`);
    console.log(`Completed Steps: ${executionResult.completedSteps} / ${executionResult.totalSteps}`);
    console.log(`Summary        : ${executionResult.summary}`);
    console.log("------------------------------------------\n");
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\n[Error] An unexpected error occurred during execution:", errorMessage);
  } finally {
    rl.close();
  }
}

// Start the application
main().catch((error: unknown) => {
  console.error("An unexpected error occurred:", error);
});
