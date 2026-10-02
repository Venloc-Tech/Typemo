import { Controller, Get, Injectable, Module, ServiceUnavailableException } from "@nestjs/common";
import { type Connection, Entity, type Model, Prop, Schema, type TypemoClient } from "@venloc/typemo";
import {
  InjectClient,
  InjectConnection,
  InjectModel,
  TypemoModule,
  type TypemoModuleFactoryOptions,
} from "@venloc/typemo-nestjs";

// application config
@Injectable()
export class Config {
  readonly mongoUri = "mongodb://localhost:27017";
  readonly analyticsUri = "mongodb://analytics:27017";
}
@Module({ providers: [Config], exports: [Config] })
export class ConfigModule {}

// model
@Schema({ collection: "accounts" })
export class Account extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

// a service with models of three places
@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Account) private readonly accounts: Model<Account>,
    @InjectModel(Account, { db: "archive" }) private readonly archived: Model<Account>,
    @InjectModel(Account, { client: "analytics" }) private readonly copies: Model<Account>,
    @InjectConnection({ db: "archive" }) private readonly archive: Connection,
  ) {}
}

// health check
@Controller("health")
export class HealthController {
  constructor(@InjectClient() private readonly client: TypemoClient) {}

  @Get()
  check() {
    if (this.client.state !== "connected") throw new ServiceUnavailableException({ database: this.client.state });
    return { database: "connected" };
  }
}

@Module({
  imports: [
    TypemoModule.forFeature([Account]),
    TypemoModule.forFeature([Account], { db: "archive" }),
    TypemoModule.forFeature([Account], { client: "analytics" }),
  ],
  controllers: [HealthController],
  providers: [ReportsService],
})
export class ReportsModule {}

// clients
@Module({
  imports: [
    TypemoModule.forRootAsync({
      imports: [ConfigModule],
      inject: [Config],
      useFactory: (config: Config): TypemoModuleFactoryOptions => ({
        uri: config.mongoUri,
        dbName: "bank",
        retryAttempts: 5,
        retryDelay: 1000,
      }),
    }),
    TypemoModule.forRootAsync({
      name: "analytics",
      imports: [ConfigModule],
      inject: [Config],
      useFactory: (config: Config): TypemoModuleFactoryOptions => ({
        uri: config.analyticsUri,
        dbName: "analytics",
        lazyConnection: true,
      }),
    }),
    ReportsModule,
  ],
})
export class AppModule {}
