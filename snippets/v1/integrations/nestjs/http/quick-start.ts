import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { type CreateInput, Entity, type IdOf, type Model, Prop, Schema } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, ValidateBodyPipe } from "@venloc/typemo-nestjs";
@Schema({ collection: "users" })
class User extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
}
// ---cut---
@Controller("users")
export class UsersController {
  constructor(@InjectModel(User) private readonly users: Model<User>) {}

  @Post()
  async create(@Body(ValidateBodyPipe.for(User)) body: CreateInput<User>) {
    return (await this.users.create(body)).$toPlain();
  }

  @Get(":id")
  get(@Param("id", ParseIdPipe.for(User)) id: IdOf<User>) {
    return this.users.findById(id).orFail().plain();
  }
}

// main.ts: app.useGlobalFilters(new TypemoExceptionFilter());
