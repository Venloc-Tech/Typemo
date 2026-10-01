import { ITEMS, TrackedProtocol } from "./tracked-protocol.ts";

/**
 * Where a child hangs: its owner, and the property/Map key (absent for array elements).
 *
 * @example
 * ```ts
 * const link: Link = { owner: user, key: "address" };
 * ```
 */
export interface Link {
  /** The object that holds the child. */
  readonly owner: object;
  /** The property or Map key, `undefined` for an array element. */
  readonly key: string | undefined;
}

/** The parent link of every attached tracked value. */
const LINKS = new WeakMap<object, Link>();

/**
 * The ONE parent link of tracked values. Mongoose keeps five of them (`[arrayParentSymbol]`, `$__parent` +
 * `$basePath`, `__parentArray` + `__index`, `$__parent` of Maps, the Buffer symbols) and caches
 * `ownerDocument()` and `$__.fullPath` without invalidation; `__index` is mutable state recomputed after
 * every shifting operation — and stale after `pull` (Mongoose H029: a later change is written to the WRONG
 * element).
 *
 * Here: one `WeakMap` from a child to `{ owner, key }`. An element of an array has NO key: its position is
 * `owner.indexOf(child)` computed on demand, so it can never be stale. The root document is the top object
 * with no link; a chain whose top is a detached container has no path.
 */
export class Lineage {
  /**
   * Whether a value is embedded (a container or a subdocument: it can never be a root). Exactly the values
   * that speak the tracked protocol.
   *
   * @param value - The value to test.
   * @returns `true` for an embedded value.
   */
  static isEmbedded(value: object): boolean {
    return TrackedProtocol.is(value);
  }

  /**
   * Links `child` to `owner`, replacing a previous link. Does nothing for a value that is not tracked.
   *
   * @param child - The value to link.
   * @param owner - The object that holds it.
   * @param key - The property or Map key; absent for an array element.
   */
  static attach(child: unknown, owner: object, key?: string): void {
    if (!TrackedProtocol.is(child)) return;
    LINKS.set(child, { owner, key });
  }

  /**
   * Removes the link of a value.
   *
   * @param child - The value to unlink; anything that is not an object is ignored.
   */
  static detach(child: unknown): void {
    if (typeof child === "object" && child !== null) LINKS.delete(child);
  }

  /**
   * The link of a value.
   *
   * @param child - The value to look up.
   * @returns The link, or `undefined` when the value is detached.
   */
  static linkOf(child: object): Link | undefined {
    return LINKS.get(child);
  }

  /**
   * Whether `child` is linked to exactly this owner.
   *
   * @param child - The value to test.
   * @param owner - The expected owner.
   * @returns `true` when the link's owner is `owner`.
   */
  static isAttachedTo(child: unknown, owner: object): boolean {
    return typeof child === "object" && child !== null && LINKS.get(child)?.owner === owner;
  }

  /**
   * The elements of an owning array as the core reads them: a tracked array's store, not its marking indexes.
   *
   * @param owner - The owning array.
   * @returns The elements.
   */
  private static itemsOf(owner: readonly unknown[]): readonly unknown[] {
    const read = (owner as { readonly [ITEMS]?: () => readonly unknown[] })[ITEMS];
    return read === undefined ? owner : read.call(owner);
  }

  /**
   * Position in the owning array right now.
   *
   * @param child - The array element.
   * @returns The index, or -1 when detached or not an array element.
   */
  static index(child: object): number {
    const link = LINKS.get(child);
    if (link === undefined || link.key !== undefined || !Array.isArray(link.owner)) return -1;
    return Lineage.itemsOf(link.owner).indexOf(child);
  }

  /**
   * Full code path of `child` inside its root document (`revisions.1.note` style segments), or
   * `undefined` when some link on the way is broken or the top is not a document (a detached
   * container or subdocument).
   *
   * @param child - The value to locate.
   * @returns The dotted path; an empty string for the root document itself.
   */
  static fullPath(child: object): string | undefined {
    const segments: string[] = [];
    let current: object = child;
    for (;;) {
      const link = LINKS.get(current);
      if (link === undefined) return TrackedProtocol.is(current) ? undefined : segments.join(".");
      if (link.key === undefined) {
        const index = Array.isArray(link.owner) ? Lineage.itemsOf(link.owner).indexOf(current) : -1;
        if (index < 0) return undefined;
        segments.unshift(String(index));
      } else {
        segments.unshift(link.key);
      }
      current = link.owner;
    }
  }

  /**
   * The top of the chain (the root document when attached).
   *
   * @param child - The value to start from.
   * @returns The top object.
   */
  static root(child: object): object {
    let current = child;
    for (let link = LINKS.get(current); link !== undefined; link = LINKS.get(current)) current = link.owner;
    return current;
  }

  /**
   * The nearest owner that is a document (a subdocument or the root), skipping arrays and Maps.
   *
   * @param child - The value to start from.
   * @returns The owner, or `undefined` when there is none.
   */
  static parentDocument(child: object): object | undefined {
    let link = LINKS.get(child);
    while (link !== undefined && (Array.isArray(link.owner) || link.owner instanceof Map)) {
      link = LINKS.get(link.owner);
    }
    return link?.owner;
  }
}
