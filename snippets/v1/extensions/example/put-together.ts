import { type Defaulted, Entity, Prop, Schema, TypemoClient, type SchemaInfo, type TypemoExtension } from "@venloc/typemo";

declare module "@venloc/typemo" {
  interface PropExtensions<V> {
    label?: { readonly text: string; readonly format?: (value: V) => string };
  }
  interface SchemaExtensions {
    label?: { readonly title: string };
  }
}

const label: TypemoExtension<"label"> = {
  name: "label",
  validateProp: (value) => {
    if (typeof (value as { text?: unknown }).text !== "string") throw new TypeError("text must be a string");
  },
};

@Schema({ collection: "accounts" })
class Account extends Entity {
  @Prop(() => String, { required: true, ext: { label: { text: "Название" } } })
  title!: string;

  @Prop(() => Number, { default: 0, ext: { label: { text: "Баланс", format: (value) => value.toFixed(2) } } })
  balance!: Defaulted<number>;

  @Prop(() => String, { required: true })
  owner!: string;
}

const columns = (schema: SchemaInfo): { path: string; header: string; format: (value: unknown) => string }[] => {
  const out = [];
  for (const path of Object.keys(schema.describe().paths)) {
    const ext = schema.extOf(path)?.label as { text: string; format?: (value: never) => string } | undefined;
    if (ext === undefined) continue;
    const format = ext.format as ((value: unknown) => string) | undefined;
    out.push({ path, header: ext.text, format: format ?? String });
  }
  return out;
};

const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
client.use(label); // before the first model
const Accounts = client.db().model(Account);

const table = columns(Accounts.schema);
for (const row of await Accounts.find().plain()) {
  console.log(table.map((column) => `${column.header}: ${column.format((row as Record<string, unknown>)[column.path])}`).join(" | "));
}
// → Название: Main | Баланс: 12.50
