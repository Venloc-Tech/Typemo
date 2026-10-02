import { Body, Controller, Param, Patch } from "@nestjs/common";
import { Entity, type IdOf, type Model, Prop, Schema, type UpdateInput } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, ValidateBodyPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
  @Prop(() => Number, { min: 0, max: 150 }) age?: number;
}
// ---cut---
@Controller("users")
export class UsersController {
  constructor(@InjectModel(User) private readonly users: Model<User>) {}

  @Patch(":id")
  update(
    @Param("id", ParseIdPipe.for(User)) id: IdOf<User>,
    @Body(ValidateBodyPipe.for(User, { partial: true })) body: UpdateInput<User>,
  ) {
    return this.users.findByIdAndUpdate(id, { $set: body }).orFail().plain();
  }
}
