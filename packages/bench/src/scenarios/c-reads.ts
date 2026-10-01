import type { Document } from "mongodb";
import type { ContestantOps } from "../adapters/ops.ts";
import { EVENTS, FLAT, LARGE, MEDIUM, MEDIUM_STATUSES, type ShapeDef } from "../data/shapes/index.ts";
import { OpScenario } from "../harness/op-scenario.ts";
import type { Scenario, ScenarioEnv } from "../harness/scenario.ts";
import type { Outcome, ProfileName, SizeName } from "../harness/types.ts";
import { Outcomes } from "../harness/verify.ts";

/* Group C: reading — findOne, find with filters, sorting, projection and paging, count, distinct and exists. */

/**
 * Deterministic spread of iteration → document index.
 *
 * @param i - The iteration.
 * @param n - The number of documents.
 * @returns An index in `[0, n)`.
 */
const spread = (i: number, n: number): number => (i * 7919 + 13) % n;

/** Profiles that run the heavier scenarios. */
const STANDARD: readonly ProfileName[] = ["standard", "full"];
/** Every profile. */
const EVERY: readonly ProfileName[] = ["quick", "standard", "full"];

/** `findOne` by `_id`. */
class FindOneById extends OpScenario<object> {
  readonly id = "C.findOne.byId";
  readonly group = "C" as const;
  readonly title = "findOne по _id (flat)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Finds one document by id.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the id.
   * @param env - The scenario environment.
   * @returns The document.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.findOne({ _id: this.def.id(spread(i, this.countOf(env))) });
  }
}

/** `findOne` through a unique index. */
class FindOneByUnique extends OpScenario<object> {
  readonly id = "C.findOne.byUnique";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "findOne по уникальному индексу (medium.slug)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Finds one document by slug.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the slug.
   * @param env - The scenario environment.
   * @returns The document.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.findOne({ slug: `post-${spread(i, this.countOf(env))}` });
  }
}

/** `find` with a filter, a sort and a limit. */
class FindFilterSortLimit extends OpScenario<object> {
  readonly id = "C.find.filterSortLimit";
  readonly group = "C" as const;
  readonly title = "find: фильтр + sort + limit 100 (medium)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * Finds up to 100 documents of one status.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the status.
   * @returns The documents.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    const status = MEDIUM_STATUSES[i % MEDIUM_STATUSES.length] ?? "draft";
    return ops.find({ filter: { status, priority: { $gte: 3 } }, sort: { priority: -1, _id: 1 }, limit: 100 });
  }
}

/** `find` with a projection of three fields. */
class FindProjection extends OpScenario<object> {
  readonly id = "C.find.projection";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "find: проекция 3 полей, limit 1000 (medium)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `1000`.
   */
  override unitsPerOp(): number {
    return 1000;
  }
  /**
   * Finds 1000 documents with three fields each.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ projection: { title: 1, slug: 1, priority: 1 }, sort: { _id: 1 }, limit: 1000 });
  }
}

/** `find` of a whole collection: a big result, hydrated against lean. */
class FindAllFlat extends OpScenario<object> {
  readonly id = "C.find.all";
  readonly group = "C" as const;
  readonly title = "find всей коллекции (flat): большая выборка hydrated против lean";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @param size - The dataset size.
   * @returns The whole collection.
   */
  override unitsPerOp(size: SizeName): number {
    return this.def.countFor(size);
  }
  /**
   * Finds every document.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ sort: { _id: 1 } });
  }
}

/** `find` of 1000 documents with nested objects. */
class FindMedium1k extends OpScenario<object> {
  readonly id = "C.find.medium1k";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "find 1000 документов medium (вложенные объекты)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `1000`.
   */
  override unitsPerOp(): number {
    return 1000;
  }
  /**
   * Finds 1000 documents.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ sort: { _id: 1 }, limit: 1000 });
  }
}

/** The last page of a collection through `skip`. */
class PageSkip extends OpScenario<object> {
  readonly id = "C.page.skip";
  readonly group = "C" as const;
  readonly title = "страница 100 в конце коллекции через skip (flat)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * Finds the last 100 documents by skipping the rest.
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The documents.
   */
  op(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.find({ sort: { _id: 1 }, skip: Math.max(0, this.countOf(env) - 100), limit: 100 });
  }
}

/** The same last page through keyset paging (`_id > last`). */
class PageKeyset extends OpScenario<object> {
  readonly id = "C.page.keyset";
  readonly group = "C" as const;
  readonly title = "та же страница через keyset (_id > last)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M", "L"];
  readonly def = FLAT as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * Finds the last 100 documents after a known id.
   *
   * @param ops - The contestant's operations.
   * @param _i - Unused.
   * @param env - The scenario environment.
   * @returns The documents.
   */
  op(ops: ContestantOps, _i: number, env: ScenarioEnv): Promise<unknown> {
    const after = this.def.id(Math.max(0, this.countOf(env) - 101));
    return ops.find({ filter: { _id: { $gt: after } }, sort: { _id: 1 }, limit: 100 });
  }
}

/** `countDocuments` through an index. */
class CountDocuments extends OpScenario<object> {
  readonly id = "C.count";
  readonly group = "C" as const;
  readonly title = "countDocuments по индексу (medium.status)";
  readonly profiles = EVERY;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Counts the documents of one status.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the status.
   * @returns The count.
   */
  op(ops: ContestantOps, i: number): Promise<unknown> {
    return ops.count({ status: MEDIUM_STATUSES[i % 3] ?? "draft" });
  }
  /**
   * The count together with the status it belongs to.
   *
   * @param result - The count.
   * @param _ops - Unused.
   * @param i - The iteration, which picked the status.
   * @returns The outcome.
   */
  override outcome(result: unknown, _ops: ContestantOps, i: number): Outcome {
    return Outcomes.value({ status: MEDIUM_STATUSES[i % 3], n: result });
  }
}

/** `distinct` over one field. */
class Distinct extends OpScenario<object> {
  readonly id = "C.distinct";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "distinct(category) (medium)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Reads the distinct categories.
   *
   * @param ops - The contestant's operations.
   * @returns The categories.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.distinct("category");
  }
  /**
   * The sorted categories.
   *
   * @param result - The categories.
   * @returns The outcome.
   */
  override outcome(result: unknown): Outcome {
    const list = (result as unknown[]).map(String).sort();
    return Outcomes.value(list, list.length);
  }
}

/** An existence check by slug. */
class Exists extends OpScenario<object> {
  readonly id = "C.exists";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "exists по slug (medium)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Checks that a document with a slug exists.
   *
   * @param ops - The contestant's operations.
   * @param i - The iteration, which picks the slug.
   * @param env - The scenario environment.
   * @returns The id document, or `null`.
   */
  op(ops: ContestantOps, i: number, env: ScenarioEnv): Promise<unknown> {
    return ops.exists({ slug: `post-${spread(i, this.countOf(env))}` });
  }
  /**
   * The id of the found document.
   *
   * @param result - The id document, or `null`.
   * @returns The outcome.
   */
  override outcome(result: unknown): Outcome {
    return Outcomes.value({ _id: (result as { _id?: unknown } | null)?._id ?? null });
  }
}

/** `find` with a complex filter: `$or`, `$in`, nested paths and a range. */
class ComplexFilter extends OpScenario<object> {
  readonly id = "C.filter.complex";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "сложный фильтр: $or/$in/вложенные пути/диапазон, limit 200 (medium)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = MEDIUM as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `200`.
   */
  override unitsPerOp(): number {
    return 200;
  }
  /**
   * Finds up to 200 documents matching the complex filter.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    const filter: Document = {
      $or: [
        { status: "published", priority: { $gte: 8 } },
        { tags: { $in: ["alpha", "zulu"] }, "address.country": { $in: ["DE", "FR"] } },
      ],
      rating: { $gte: 2, $lte: 5 },
      "stats.likes": { $gt: 100 },
      "flags.featured": true,
    };
    return ops.find({ filter, sort: { _id: 1 }, limit: 200 });
  }
}

/** `find` over a collection with five discriminators. */
class FindEvents extends OpScenario<object> {
  readonly id = "C.find.discriminators";
  override readonly standardSizes: readonly SizeName[] = ["S"];
  readonly group = "C" as const;
  readonly title = "find 500 событий 5 дискриминаторов (events)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = EVENTS as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `500`.
   */
  override unitsPerOp(): number {
    return 500;
  }
  /**
   * Registers the discriminators for Mongoose.
   *
   * @param ops - The contestant's operations.
   */
  override setup(ops: ContestantOps): void {
    /* Mongoose resolves subtypes only through registered discriminators. */
    if (ops.kind === "mongoose") EVENTS.mongoose(ops.mongooseHandle);
  }
  /**
   * Finds 500 events.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ sort: { _id: 1 }, limit: 500 });
  }
}

/** `find` of large documents. */
class FindLarge extends OpScenario<object> {
  readonly id = "C.find.large";
  readonly group = "C" as const;
  readonly title = "find 100 больших документов (~100 КБ, 180 поддокументов)";
  readonly profiles = STANDARD;
  override readonly sizes: readonly SizeName[] = ["S", "M"];
  readonly def = LARGE as unknown as ShapeDef<object>;
  /**
   * Documents per operation.
   *
   * @returns `100`.
   */
  override unitsPerOp(): number {
    return 100;
  }
  /**
   * The sizes to run under a profile; `standard` runs only S.
   *
   * @param profile - The profile.
   * @returns The sizes.
   */
  override sizesFor(profile: ProfileName): readonly SizeName[] {
    return profile === "standard" ? ["S"] : super.sizesFor(profile);
  }
  /**
   * Finds 100 large documents.
   *
   * @param ops - The contestant's operations.
   * @returns The documents.
   */
  op(ops: ContestantOps): Promise<unknown> {
    return ops.find({ sort: { _id: 1 }, limit: 100 });
  }
}

/** The scenarios of group C. */
export const SCENARIOS: readonly Scenario[] = [
  new FindOneById(),
  new FindOneByUnique(),
  new FindFilterSortLimit(),
  new FindProjection(),
  new FindAllFlat(),
  new FindMedium1k(),
  new PageSkip(),
  new PageKeyset(),
  new CountDocuments(),
  new Distinct(),
  new Exists(),
  new ComplexFilter(),
  new FindEvents(),
  new FindLarge(),
];
