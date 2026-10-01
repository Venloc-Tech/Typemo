/* Deterministic usertable values (groups O and Q). */
import type { Rng } from "../../data/rng.ts";
import { YCSB_FIELD_LENGTH, YCSB_FIELDS } from "./ycsb.ts";

/** Deterministic 100-character field values. */
export class YcsbValues {
  /**
   * One field value.
   *
   * @param rng - The random source.
   * @returns A string of `YCSB_FIELD_LENGTH` characters.
   */
  static field(rng: Rng): string {
    let out = "";
    while (out.length < YCSB_FIELD_LENGTH) out += rng.next().toString(36).slice(2);
    return out.slice(0, YCSB_FIELD_LENGTH);
  }

  /**
   * The field values of one record.
   *
   * @param rng - The random source.
   * @returns `YCSB_FIELDS` values.
   */
  static record(rng: Rng): string[] {
    return Array.from({ length: YCSB_FIELDS }, () => YcsbValues.field(rng));
  }
}
