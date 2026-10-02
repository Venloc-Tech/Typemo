@Module({
  imports: [
    MongooseModule.forRoot("mongodb://localhost/bank"),
    MongooseModule.forFeature([{ name: Cat.name, schema: CatSchema }]),
  ],
})
export class AppModule {}

@Injectable()
export class CatsService {
  constructor(@InjectModel(Cat.name) private catModel: Model<CatDocument>) {}
}
