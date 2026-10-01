import type { Collection, Document } from "mongodb";

/**
 * Assertions over `explain("queryPlanner")` output: did the
 * server use an index (`IXSCAN`) or a full collection scan (`COLLSCAN`) for
 * a given query.
 */
export class ExplainHelpers {
  /**
   * Runs `explain("queryPlanner")` for a `find`.
   *
   * @param collection - The collection to query.
   * @param filter - The query filter.
   * @returns The raw explain document.
   */
  static async explainFind(collection: Collection, filter: Document): Promise<Document> {
    return (await collection.find(filter).explain("queryPlanner")) as Document;
  }

  /**
   * Asserts that the winning plan uses an index.
   *
   * @param collection - The collection to query.
   * @param filter - The query filter.
   * @param indexName - When given, the index that must have been used.
   * @throws Error - When there is no `IXSCAN` stage or it uses another index.
   */
  static async expectIndexScan(collection: Collection, filter: Document, indexName?: string): Promise<void> {
    const explain = await ExplainHelpers.explainFind(collection, filter);
    const winningPlan = ExplainHelpers.#winningPlan(explain);
    const stage = ExplainHelpers.#findStage(winningPlan, "IXSCAN");
    if (!stage) {
      throw new Error(
        `Expected an IXSCAN stage for filter ${JSON.stringify(filter)}, got winningPlan: ${JSON.stringify(winningPlan)}`,
      );
    }
    if (indexName !== undefined && stage.indexName !== indexName) {
      throw new Error(`Expected index "${indexName}", but the query used "${String(stage.indexName)}"`);
    }
  }

  /**
   * Asserts that the winning plan scans the whole collection.
   *
   * @param collection - The collection to query.
   * @param filter - The query filter.
   * @throws Error - When there is no `COLLSCAN` stage.
   */
  static async expectCollScan(collection: Collection, filter: Document): Promise<void> {
    const explain = await ExplainHelpers.explainFind(collection, filter);
    const winningPlan = ExplainHelpers.#winningPlan(explain);
    const stage = ExplainHelpers.#findStage(winningPlan, "COLLSCAN");
    if (!stage) {
      throw new Error(
        `Expected a COLLSCAN stage for filter ${JSON.stringify(filter)}, got winningPlan: ${JSON.stringify(winningPlan)}`,
      );
    }
  }

  /**
   * Extracts `queryPlanner.winningPlan`.
   *
   * @param explain - The explain document.
   * @returns The winning plan.
   * @throws Error - When the explain result has no winning plan.
   */
  static #winningPlan(explain: Document): Document {
    const queryPlanner = explain.queryPlanner as Document | undefined;
    const winningPlan = queryPlanner?.winningPlan as Document | undefined;
    if (!winningPlan) {
      throw new Error(`explain() result has no queryPlanner.winningPlan: ${JSON.stringify(explain)}`);
    }
    return winningPlan;
  }

  /**
   * Depth-first search through `inputStage`/`inputStages` (present for e.g. `SORT`/`OR` plans).
   *
   * @param plan - The plan node to search from.
   * @param stageName - The stage to look for, e.g. `IXSCAN`.
   * @returns The first matching stage, or `undefined`.
   */
  static #findStage(plan: Document, stageName: string): Document | undefined {
    if (plan.stage === stageName) {
      return plan;
    }
    const inputStage = plan.inputStage as Document | undefined;
    if (inputStage) {
      const found = ExplainHelpers.#findStage(inputStage, stageName);
      if (found) {
        return found;
      }
    }
    const inputStages = plan.inputStages as Document[] | undefined;
    if (inputStages) {
      for (const nested of inputStages) {
        const found = ExplainHelpers.#findStage(nested, stageName);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }
}
