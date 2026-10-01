/*
 * Type-only model surfaces of the dense graph: the typed entry points (`ModelOperations`) and the full
 * model surface (`Model<T>` = the entry points + inserts, bulkWrite, aggregate, cursors).
 */
import type { ModelOperations } from "@venloc/typemo";
import type { Comment, FollowNotification, MentionNotification, Post, User } from "./entities.ts";

/** Entry points for users. */
export declare const UserModel: ModelOperations<User>;
/** Entry points for posts. */
export declare const PostModel: ModelOperations<Post>;
/** Entry points for comments. */
export declare const CommentModel: ModelOperations<Comment>;
/** Entry points for the whole notification hierarchy. */
export declare const NotificationModel: ModelOperations<MentionNotification | FollowNotification>;
/** Entry points for one discriminator. */
export declare const MentionModel: ModelOperations<MentionNotification>;

import type { Model } from "@venloc/typemo";

/** The full model surface for users. */
export declare const UserStore: Model<User>;
/** The full model surface for posts. */
export declare const PostStore: Model<Post>;
