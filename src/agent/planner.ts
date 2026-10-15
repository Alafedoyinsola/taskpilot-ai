/**
 * TaskPlan interfaces representing the structured breakdown of a user's task.
 */
export interface PlanStep {
  stepNumber: number;
  title: string;
  description: string;
  serviceType: "search" | "data" | "analysis" | "report";
}

export interface TaskPlan {
  task: string;
  totalSteps: number;
  steps: PlanStep[];
}

/**
 * Creates an actionable 3-5 step plan for a given task.
 * Uses deterministic decomposition logic (ready to be enhanced by an LLM in future steps).
 *
 * @param task The task description entered by the user
 * @returns A structured TaskPlan
 */
export function createPlan(task: string): TaskPlan {
  const cleanTask = task.trim();

  // Handle empty input safely
  if (!cleanTask) {
    return {
      task: "",
      totalSteps: 0,
      steps: [],
    };
  }

  // Decompose task into 4 actionable steps
  const steps: PlanStep[] = [
    {
      stepNumber: 1,
      title: "Identify Information Sources",
      description: `Identify target resources, documentation, and directories for: "${cleanTask}".`,
      serviceType: "search",
    },
    {
      stepNumber: 2,
      title: "Query External Services & Data",
      description: `Fetch relevant ecosystem data, project metrics, and records related to "${cleanTask}".`,
      serviceType: "data",
    },
    {
      stepNumber: 3,
      title: "Analyze & Verify Findings",
      description: `Evaluate collected data, filter out noise, and highlight top candidates or key insights.`,
      serviceType: "analysis",
    },
    {
      stepNumber: 4,
      title: "Synthesize Final Report",
      description: `Format structured findings with actionable summaries and recommendations for the user.`,
      serviceType: "report",
    },
  ];

  return {
    task: cleanTask,
    totalSteps: steps.length,
    steps,
  };
}
