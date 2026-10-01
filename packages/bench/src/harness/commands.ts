import { CommandRecorder } from "@venloc/typemo-test-kit";
import { BSON, type CommandSucceededEvent, type MongoClient } from "mongodb";
import type { CommandStats } from "./types.ts";

/** Commands that are session/connection housekeeping, not work of the operation. */
const IGNORED = new Set(["endSessions", "hello", "isMaster", "ping", "buildInfo", "saslStart", "saslContinue"]);

/**
 * Counts the commands and bytes one operation sends (via `CommandRecorder`).
 * Needs a client created with `monitorCommands: true` — the runner uses a separate monitored context for this
 * pass so that monitoring never costs time in the timed pass.
 */
export class CommandProbe {
  /** The monitored client. */
  readonly #client: MongoClient;
  /** Records the commands sent. */
  readonly #recorder: CommandRecorder;
  /** Bytes of the replies received so far. */
  #bytesIn = 0;
  /* An arrow field: it is passed as an event callback and needs a bound `this`. */
  readonly #onSucceeded = (event: CommandSucceededEvent): void => {
    if (IGNORED.has(event.commandName)) return;
    const reply = event.reply as BSON.Document | undefined;
    if (reply !== undefined) this.#bytesIn += BSON.calculateObjectSize(reply);
  };

  /**
   * @param client - A client created with `monitorCommands: true`.
   */
  private constructor(client: MongoClient) {
    this.#client = client;
    this.#recorder = CommandRecorder.attach(client);
    client.on("commandSucceeded", this.#onSucceeded);
  }

  /**
   * Starts counting the commands of a client.
   *
   * @param client - A client created with `monitorCommands: true`.
   * @returns The probe.
   */
  static attach(client: MongoClient): CommandProbe {
    return new CommandProbe(client);
  }

  /**
   * Stops counting.
   *
   * @returns The commands and bytes seen since `attach`.
   */
  stop(): CommandStats {
    this.#recorder.detach();
    this.#client.off("commandSucceeded", this.#onSucceeded);
    const records = this.#recorder.all().filter((r) => !IGNORED.has(r.commandName));
    const byName: Record<string, number> = {};
    let bytesOut = 0;
    for (const record of records) {
      byName[record.commandName] = (byName[record.commandName] ?? 0) + 1;
      /* Session/cluster envelope fields differ only by database name length etc.: not the operation's payload. */
      const {
        $db: _db,
        lsid: _lsid,
        $clusterTime: _ct,
        $readPreference: _rp,
        ...payload
      } = record.command as BSON.Document;
      bytesOut += BSON.calculateObjectSize(payload);
    }
    return { commands: records.length, byName, bytesOut, bytesIn: this.#bytesIn };
  }
}
