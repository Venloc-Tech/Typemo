import { Entity, Prop, Schema, TypemoClient } from "@venloc/typemo";

@Schema({ collection: "accounts", changeStreamPreAndPostImages: true })
class Account extends Entity {
  @Prop(() => String, { required: true })
  owner!: string;

  @Prop(() => Number, { required: true })
  balance!: number;
}

// your code: durable token storage and an event sink
declare const __loadToken__: () => Promise<{ _data: string } | undefined>;
declare const __saveToken__: (token: unknown) => Promise<void>;
declare const __publish__: (message: string) => Promise<void>;

export const runAuditFeed = async (client: TypemoClient) => {
  const Accounts = client.db().model(Account);

  // continue from the saved position, if there is one
  const token = await __loadToken__();
  const stream = await Accounts.watch(
    // filter on the server: balance changes and new accounts
    (p) => p.match({ $or: [{ operationType: "insert" }, { "updateDescription.updatedFields.balance": { $exists: true } }] }),
    {
      // the state before and after the change: only exact images
      fullDocument: "required",
      fullDocumentBeforeChange: "whenAvailable",
      ...(token === undefined ? {} : { resumeAfter: token }),
    },
  );

  for await (const event of stream) {
    if (event.operationType === "insert") {
      await __publish__(`opened ${event.fullDocument.owner}`);
    } else if (event.operationType === "update") {
      const before = event.fullDocumentBeforeChange?.balance ?? "?";
      await __publish__(`${event.fullDocument.owner}: ${before} → ${event.fullDocument.balance}`);
    }
    // save the token after processing: on restart this event is not repeated
    await __saveToken__(stream.resumeToken);
  }
};
