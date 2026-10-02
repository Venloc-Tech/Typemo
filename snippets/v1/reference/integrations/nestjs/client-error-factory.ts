type TypemoModuleOptions = TypemoClientOptions & TypemoConnectOptions;

interface TypemoConnectOptions {
  readonly retryAttempts?: number;
  readonly retryDelay?: number;
  readonly lazyConnection?: boolean;
  readonly sync?: TypemoSync;
  readonly onClientCreate?: (client: TypemoClient) => void | Promise<void>;
  readonly clientFactory?: (client: TypemoClient) => TypemoClient | Promise<TypemoClient>;
  readonly clientErrorFactory?: (error: unknown) => Error;
}

type TypemoSync = false | "init" | "sync";
