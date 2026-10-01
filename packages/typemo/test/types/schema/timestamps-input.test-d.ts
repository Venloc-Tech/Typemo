/*
 * `createdAt` and `updatedAt` of `Timestamped` may be given consciously: both on create (an import keeps its
 * dates), `updatedAt` in an update (the core then leaves it as given). `createdAt` never changes after create.
 */
import { expectTypeOf } from "@venloc/typemo-test-kit";
import {
  type CreateInput,
  Entity,
  type Model,
  Prop,
  Schema,
  Timestamped,
  type UpdateInput,
} from "../../../src/index.ts";

@Schema({ collection: "f113_notes" })
class Note extends Timestamped(Entity) {
  @Prop(() => String, { required: true }) title!: string;
}

declare const Notes: Model<Note>;

// Positive: both dates are optional inputs of create.
Notes.create({ title: "a" });
Notes.create({ title: "a", createdAt: new Date(0), updatedAt: new Date(0) });
Notes.insertMany([{ title: "b", createdAt: new Date(0) }]);
expectTypeOf<CreateInput<Note>["createdAt"]>().toEqualTypeOf<Date | undefined>();

// Positive: an update may set `updatedAt` itself.
Notes.updateOne({ title: "a" }, { $set: { title: "b", updatedAt: new Date(0) } });
expectTypeOf<UpdateInput<Note>["updatedAt"]>().toEqualTypeOf<Date | undefined>();

// Negative: `createdAt` is immutable after create.
// @ts-expect-error — createdAt cannot be written by an update
Notes.updateOne({ title: "a" }, { $set: { createdAt: new Date(0) } });
