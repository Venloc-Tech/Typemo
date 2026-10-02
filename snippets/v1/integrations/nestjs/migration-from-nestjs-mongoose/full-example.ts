import { Body, Controller, Get, Injectable, Module, Param, Post } from "@nestjs/common";
import { type CreateInput, Entity, type IdOf, type Model, Prop, type Ref, Schema, Types } from "@venloc/typemo";
import { InjectModel, ParseIdPipe, TypemoModule, ValidateBodyPipe } from "@venloc/typemo-nestjs";

// the schema is a class
@Schema({ collection: "cats" })
export class Cat extends Entity {
  @Prop(() => String, { required: true }) name!: string;
  @Prop(() => Number) age?: number;
  @Prop(() => String) breed?: string;
  @Prop(() => [Types.ObjectId], { ref: () => Cat, default: () => [] }) kittens!: Ref<Cat>[];
}

// service
@Injectable()
export class CatsService {
  constructor(@InjectModel(Cat) private readonly cats: Model<Cat>) {}

  async create(body: CreateInput<Cat>) {
    return (await this.cats.create(body)).$toPlain();
  }

  findOne(id: IdOf<Cat>) {
    return this.cats.findById(id).populate("kittens").orFail().plain();
  }
}

// controller
@Controller("cats")
export class CatsController {
  constructor(private readonly service: CatsService) {}

  @Post()
  create(@Body(ValidateBodyPipe.for(Cat)) body: CreateInput<Cat>) {
    return this.service.create(body);
  }

  @Get(":id")
  findOne(@Param("id", ParseIdPipe.for(Cat)) id: IdOf<Cat>) {
    return this.service.findOne(id);
  }
}

@Module({ imports: [TypemoModule.forFeature([Cat])], controllers: [CatsController], providers: [CatsService] })
export class CatsModule {}
