import { Body, Controller, Post } from "@nestjs/common";
import { type CreateInput, Entity, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, ValidateBodyPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
  @Prop(() => String, { enum: ["user", "admin"] as const }) role?: "user" | "admin";
}
// ---cut---
@Controller("signup")
export class SignupController {
  constructor(@InjectModel(User) private readonly users: Model<User>) {}

  @Post()
  async signUp(@Body(ValidateBodyPipe.for(User, { omit: ["role"] })) body: CreateInput<User>) {
    return (await this.users.create({ ...body, role: "user" })).$toPlain();
  }
}
