/*
 * A subdocument class declared BELOW its use. The thunk `() => Child` is lazy, but with
 * emitDecoratorMetadata the user's compiler emits `design:type` = Child eagerly: a TDZ ReferenceError
 * at module load. Typemo cannot prevent it; the docs say how to avoid it.
 */
import { Entity, Prop, Schema, SchemaCompiler } from "../../../src/internal.ts";

/** An entity that uses `Child` before its declaration. */
@Schema()
class Parent extends Entity {
  @Prop(() => Child) child?: Child;
}

/** The subdocument declared below its use. */
@Schema()
class Child {
  @Prop(() => String) name?: string;
}

console.log(JSON.stringify(Object.keys(SchemaCompiler.compile(Parent).allPaths)));
