import { Entity, Prop, Schema } from "@venloc/typemo";
// ---cut---
// @errors: 1240
@Schema({ collection: "settings" })
class Settings extends Entity {
  @Prop(() => Object)
  data!: unknown;
}
// at runtime, when the model is created:
// ConfigurationError: Settings.data: Object (Mixed) is not supported: declare a @Schema class or Spec.map(X)
