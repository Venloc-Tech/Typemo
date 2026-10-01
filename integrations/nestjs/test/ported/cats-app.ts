// The cats and events applications of the nestjs/mongoose e2e tests (references/nestjs-mongoose/tests/src), written
// with Typemo: the same routes and the same data; the schemas are Typemo entities, the DTOs are validated by the
// entity (ValidateBodyPipe), the models are injected by class.
import { Body, Controller, type DynamicModule, Get, Injectable, Module, Param, Post } from "@nestjs/common";
import {
  type CreateInput,
  Discriminator,
  type DiscriminatorValue,
  Entity,
  type IdOf,
  type Model,
  Prop,
  type Ref,
  Schema,
  Types,
} from "@venloc/typemo";
import { InjectModel, ParseIdPipe, TypemoModule, ValidateBodyPipe } from "../../src/index.ts";

// tests/src/cats/schemas/cat.schema.ts
@Schema({ collection: "nt_cats" })
export class NtCat extends Entity {
  @Prop(() => String) name?: string;
  @Prop(() => Number) age?: number;
  @Prop(() => String) breed?: string;
  @Prop(() => [Types.ObjectId], { ref: () => NtCat, default: () => [] }) kitten!: Ref<NtCat>[];
}

// tests/src/cats/cats.service.ts + cat.service.ts
@Injectable()
export class CatsService {
  constructor(@InjectModel(NtCat) private readonly cats: Model<NtCat>) {}

  async create(dto: CreateInput<NtCat>) {
    return (await this.cats.create(dto)).$toPlain();
  }

  findAll() {
    return this.cats.find().plain();
  }

  findOne(id: IdOf<NtCat>) {
    return this.cats.findById(id).populate("kitten").plain();
  }
}

// tests/src/cats/cats.controller.ts
@Controller("cats")
export class CatsController {
  constructor(private readonly service: CatsService) {}

  @Post()
  create(@Body(ValidateBodyPipe.for(NtCat)) dto: CreateInput<NtCat>) {
    return this.service.create(dto);
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }
}

// tests/src/cats/cat.controller.ts
@Controller("cat")
export class CatController {
  constructor(private readonly service: CatsService) {}

  @Get(":id")
  findOne(@Param("id", ParseIdPipe.for(NtCat)) id: IdOf<NtCat>) {
    return this.service.findOne(id);
  }
}

@Module({
  imports: [TypemoModule.forFeature([NtCat])],
  controllers: [CatsController, CatController],
  providers: [CatsService],
})
export class CatsModule {}

// tests/src/event/schemas/*.ts: the base event and two discriminators; the core sets the key `__t`.
@Schema({ collection: "nt_ported_events" })
export class NtPortedEvent extends Entity {
  declare readonly __t?: DiscriminatorValue<"ClickLinkEvent" | "SignUpEvent">;
  @Prop(() => Date, { required: true }) time!: Date;
}

@Discriminator("ClickLinkEvent")
export class NtClickLinkEvent extends NtPortedEvent {
  declare readonly __t: DiscriminatorValue<"ClickLinkEvent">;
  @Prop(() => String, { required: true }) url!: string;
}

@Discriminator("SignUpEvent")
export class NtPortedSignUpEvent extends NtPortedEvent {
  declare readonly __t: DiscriminatorValue<"SignUpEvent">;
  @Prop(() => String, { required: true }) user!: string;
}

// tests/src/event/event.service.ts + event.controller.ts: each route creates through its discriminator's model
// (the original passed `kind` to the base model; Typemo picks the model by class).
@Controller("event")
export class EventController {
  constructor(
    @InjectModel(NtClickLinkEvent) private readonly clicks: Model<NtClickLinkEvent>,
    @InjectModel(NtPortedSignUpEvent) private readonly signUps: Model<NtPortedSignUpEvent>,
    @InjectModel(NtPortedEvent) private readonly events: Model<NtPortedEvent>,
  ) {}

  @Post("click-link")
  async createClickLinkEvent(@Body() dto: { readonly url: string }) {
    return (await this.clicks.create({ ...dto, time: new Date() })).$toPlain();
  }

  @Post("sign-up")
  async createSignUpEvent(@Body() dto: { readonly user: string }) {
    return (await this.signUps.create({ ...dto, time: new Date() })).$toPlain();
  }

  @Get()
  findAll() {
    return this.events.find().plain();
  }
}

// tests/src/event/event.module.ts
@Module({})
export class EventModule {
  static forFeature(module: DynamicModule): DynamicModule {
    return { module: EventModule, imports: [module], controllers: [EventController] };
  }
}
