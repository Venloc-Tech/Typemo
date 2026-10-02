import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
const readLog: SchemaPlugin = { name: "read-log", apply: () => {} };
const stamped: SchemaPlugin = { name: "stamped", apply: () => {} };
// ---cut---
@Plugin(readLog)
@Plugin(stamped)
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
