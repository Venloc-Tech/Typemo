@Module({
  imports: [
    TypemoModule.forRoot("mongodb://localhost:27017", { dbName: "bank" }),
    TypemoModule.forFeature([Cat]),
  ],
})
export class AppModule {}

@Injectable()
export class CatsService {
  constructor(@InjectModel(Cat) private readonly cats: Model<Cat>) {}
}
