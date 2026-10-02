import { Discriminator, Entity, Index, Prop, Schema, SearchIndex, Spec, Timestamped, TypemoClient, Types, Versioned, Virtual, type Computed, type Defaulted, type DiscriminatorValue, type Hidden, type Immutable, type Ref, type TenantField, type VirtualRef } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema()
class Author extends Entity {
  @Prop(() => String) name?: string;
}
@Schema()
class Bot extends Entity {
  @Prop(() => String) name?: string;
}
@Schema()
class Action extends Entity {
  @Prop(() => String) kind?: string;
  @Prop(() => Types.ObjectId, { refModel: (owner) => ((owner as Action).kind === "Bot" ? Bot : Author) }) // [!code highlight]
  actor?: Ref<Author | Bot>;
}
const Actions = client.db().model(Action);
const action = await Actions.findOne({ kind: "Bot" }).populate("actor").orFail();
console.log((action.actor as { name?: string }).name);
// → R2
