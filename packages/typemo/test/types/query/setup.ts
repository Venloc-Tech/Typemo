/*
 * Shared declarations of the query type tests: typed entry points over the decorated fixtures and the dense graph
 * of the compiler budget (type-only, never executed).
 */
import type { ModelOperations } from "../../../src/index.ts";
import type { Article, Member, Note } from "../../fixtures/query/query-entities.ts";

export declare const Members: ModelOperations<Member>;
export declare const Articles: ModelOperations<Article>;
export declare const Notes: ModelOperations<Note>;
export { CommentModel, PostModel, UserModel } from "../../../../test-kit/fixtures/dense-graph/models.ts";
