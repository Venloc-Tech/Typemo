$getChanges(): DocumentChanges;

type DocumentChanges = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
