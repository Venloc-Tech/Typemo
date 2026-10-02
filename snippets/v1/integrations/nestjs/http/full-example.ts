import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { type CreateInput, Entity, type IdOf, type Model, Prop, Schema, type UpdateInput } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, ValidateBodyPipe } from "@venloc/typemo-nestjs";

// model
@Schema({ collection: "users" })
export class User extends Entity {
  @Prop(() => String, { required: true, unique: true }) email!: string;
  @Prop(() => String, { required: true, minLength: 2 }) name!: string;
  @Prop(() => Number, { min: 0, max: 150 }) age?: number;
  @Prop(() => String, { enum: ["user", "admin"] as const }) role?: "user" | "admin";
}

@Controller("users")
export class UsersController {
  constructor(@InjectModel(User) private readonly users: Model<User>) {}

  // create: the server sets the role
  @Post()
  async create(@Body(ValidateBodyPipe.for(User, { omit: ["role"] })) body: CreateInput<User>) {
    return (await this.users.create({ ...body, role: "user" })).$toPlain();
  }

  // read: an invalid id is 400, a missing one is 404
  @Get(":id")
  get(@Param("id", ParseIdPipe.for(User)) id: IdOf<User>) {
    return this.users.findById(id).orFail().plain();
  }

  // partial update
  @Patch(":id")
  update(
    @Param("id", ParseIdPipe.for(User)) id: IdOf<User>,
    @Body(ValidateBodyPipe.for(User, { partial: true, omit: ["role"] })) body: UpdateInput<User>,
  ) {
    return this.users.findByIdAndUpdate(id, { $set: body }).orFail().plain();
  }
}
