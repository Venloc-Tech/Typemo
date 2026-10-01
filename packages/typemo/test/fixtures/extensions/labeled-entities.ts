/*
 * Entities that use the test extension `testLabel`. They compile only in a context whose
 * registry has it — `client.use(testLabelExtension)` in the in-process tests (no process-wide registration).
 */
import { Entity, Prop, Schema } from "../../../src/index.ts";

/** An entity with a schema-level and a field-level `testLabel` extension. */
@Schema({ collection: "x115_labeled", ext: { testLabel: { group: "people" } } })
export class Labeled extends Entity {
  @Prop(() => String, { required: true, ext: { testLabel: { label: "Email" } }, dbName: "em" }) email!: string;
  @Prop(() => Number) plain?: number;
}

/** A model WITHOUT extensions whose pipelines name `Labeled` as a `$lookup` / `$unionWith` source. */
@Schema({ collection: "x115_label_hosts" })
export class LabelHost extends Entity {
  @Prop(() => String, { required: true }) email!: string;
}
