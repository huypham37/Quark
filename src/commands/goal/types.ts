// Task type for the /goal command orchestrator

export interface Task {
  task_type: "planned" | "delta"
  id: string
  title: string
  objective: string
  acceptance_criteria: string[]
  check_command?: string
  status: "pending" | "pass" | "fail"
  fail_reason?: string
}

export interface Plan {
  tasks: Task[]
  deltas: Task[]
  meta: {
    exploreBudgetUsed: number
    exploreBudgetMax: number
    lastAction: string
    judgeVerdicts: string[]
  }
}
