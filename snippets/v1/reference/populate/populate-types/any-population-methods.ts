export interface AnyPopulationMethods {
  $isNew(): boolean;
  $locals(): Record<string, unknown>;
  $isModified(path?: string): boolean;
  $getChanges(): DocumentChanges;
  $validate(): Promise<void>;
  $save(options?: SaveOptions): Promise<this>;
  $deleteOne(options?: SaveOptions): Promise<DeleteResult>;
  $toObject(options?: SerializeOptions): Record<string, unknown>;
  $toJSON(options?: SerializeOptions): Record<string, unknown>;
  $toPlain(options?: SerializeOptions): Record<string, unknown>;
  $populated(path: string): unknown;
  $session(): ClientSession | undefined;
  $session(session: ClientSession | null): this;
}
