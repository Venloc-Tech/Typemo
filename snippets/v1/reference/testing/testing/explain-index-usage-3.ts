const explainIndexUsage: (query: Explainable) => Promise<IndexUsage>;

interface Explainable {
  explain(verbosity?: "queryPlanner" | "executionStats" | "allPlansExecution"): PromiseLike<unknown>;
}
