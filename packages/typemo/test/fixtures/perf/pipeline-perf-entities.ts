/*
 * Models of the pipeline perf guard — one stored as in code (the aggregation rows are the driver's rows)
 * and one with `dbName` aliases, also in a subdocument array (rows are translated by the compiled translator).
 */
import { Entity, Prop, Schema } from "../../../src/index.ts";

/** A line whose `sku` is stored under another name (`s`). */
@Schema()
export class PerfLine {
  @Prop(() => String, { required: true, dbName: "s" })
  sku!: string;

  @Prop(() => Number, { required: true })
  qty!: number;
}

/** An entity stored as in code (no aliases). */
@Schema({ collection: "perf_plain" })
export class PerfPlain extends Entity {
  @Prop(() => String, { required: true })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;

  @Prop(() => [String])
  tags!: string[];
}

/** An entity with `dbName` aliases at the root and on a subdocument array. */
@Schema({ collection: "perf_aliased" })
export class PerfAliased extends Entity {
  @Prop(() => String, { required: true, dbName: "nm" })
  name!: string;

  @Prop(() => Number, { required: true })
  n!: number;

  @Prop(() => [PerfLine], { dbName: "ln" })
  lines!: PerfLine[];
}
