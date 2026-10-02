import { Module } from "@nestjs/common";
import { Discriminator, type DiscriminatorValue, Entity, Prop, Schema } from "@venloc/typemo";
import { TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
@Schema({ collection: "events" })
export class Event extends Entity {
  declare readonly __t?: DiscriminatorValue<"click" | "signup">;

  @Prop(() => Date, { required: true })
  time!: Date;
}

@Discriminator("click")
export class ClickEvent extends Event {
  declare readonly __t: DiscriminatorValue<"click">;

  @Prop(() => String, { required: true })
  url!: string;
}

@Module({ imports: [TypemoModule.forFeature([ClickEvent, Event])] })
export class EventsModule {}
