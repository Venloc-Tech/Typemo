import { Entity, Plugin, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";

export const readLog: SchemaPlugin = {
  name: "read-log",
  apply: (builder) => {
    builder.addHook("post", "query.find", function () {
      console.log(`read list ${builder.target.name}`);
    });
  },
};

@Plugin(readLog)
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}
