import { Discriminator, Entity, Prop, Schema, TypemoClient, type DiscriminatorValue } from "@venloc/typemo";
const client = await TypemoClient.connect("mongodb://localhost:27017", { dbName: "app" });
// ---cut---
@Schema({ discriminatorKey: "kind" })
class Block {
  @Prop(() => String, { required: true }) kind!: string;
}

@Discriminator("text")
class TextBlock extends Block {
  declare readonly kind: DiscriminatorValue<"text">;
  @Prop(() => String, { required: true }) text!: string;
}

@Discriminator("image")
class ImageBlock extends Block {
  declare readonly kind: DiscriminatorValue<"image">;
  @Prop(() => String, { required: true }) url!: string;
}

@Schema({ collection: "pages" })
class Page extends Entity {
  @Prop(() => String, { required: true }) title!: string;
  @Prop(() => [Block]) blocks!: (TextBlock | ImageBlock)[]; // [!code highlight]
}

const Pages = client.db().model(Page);
await Pages.create({ title: "Intro", blocks: [{ kind: "text", text: "Hi" }, { kind: "image", url: "/a.png" }] });
const page = await Pages.findOne({ title: "Intro" }).plain().orFail();
// → { _id: "…", title: "Intro", blocks: [{ kind: "text", text: "Hi" }, { kind: "image", url: "/a.png" }] }
