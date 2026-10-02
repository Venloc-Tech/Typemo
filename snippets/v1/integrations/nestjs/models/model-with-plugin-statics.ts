import { Injectable, Module } from "@nestjs/common";
import { Entity, type Model, Plugin, type PluginStatics, Prop, Schema, type SchemaPlugin } from "@venloc/typemo";
import { InjectModel, TypemoModule } from "@venloc/typemo-nestjs";
// ---cut---
const countPlugin = {
  name: "count",
  apply: () => undefined,
  statics: {
    countTitled(this: Model<object>, title: string): Promise<number> {
      return (this as unknown as Model<Note>).countDocuments({ title });
    },
  },
} satisfies SchemaPlugin<undefined, object>;

@Plugin(countPlugin)
@Schema({ collection: "notes" })
export class Note extends Entity {
  @Prop(() => String, { required: true })
  title!: string;
}

@Injectable()
export class NotesService {
  constructor(@InjectModel(Note) private readonly notes: Model<Note> & PluginStatics<typeof countPlugin>) {}

  count(title: string) {
    return this.notes.countTitled(title);
  }
}

@Module({ imports: [TypemoModule.forFeature([{ entity: Note, statics: countPlugin }])], providers: [NotesService] })
export class NotesModule {}
