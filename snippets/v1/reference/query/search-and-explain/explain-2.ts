explain(
  this: OnlyFor<Op, FindOperation, "explain() applies to find() and findOne()">,
  verbosity?: ExplainVerbosity,
): Promise<ExplainResult>

type ExplainResult = Readonly<Record<string, unknown>>
type ExplainVerbosity = "queryPlanner" | "executionStats" | "allPlansExecution"
