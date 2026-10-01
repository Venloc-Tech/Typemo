/*
 * Fields inside Map values and inside union members of arrays, checked on the keys
 * actually passed (filter and update as generics).
 */
import { ObjectId } from "mongodb";
import { PostModel, UserModel } from "../models.ts";

const id = new ObjectId();

export const m01 = () =>
  UserModel.find({ "badges.gold.title": "Champion", "badges.gold.awardedAt": { $lt: new Date() } }).lean();
export const m02 = () => UserModel.find({ "counters.visits": { $gte: 3 }, "badges.silver": { $exists: true } });
export const m03 = () =>
  UserModel.updateOne({ _id: id }, { $set: { "badges.gold.title": "x" }, $inc: { "counters.visits": 1 } });
export const m04 = () =>
  UserModel.updateOne({ _id: id }, { $unset: { "badges.bronze": 1 }, $currentDate: { "badges.gold.awardedAt": true } });
export const m05 = () =>
  PostModel.find({ "blocks.url": { $regex: "^https" }, "blocks.size.width": { $gt: 100 } }).lean();
export const m06 = () =>
  PostModel.updateOne({ _id: id }, { $set: { "blocks.$[b].caption": "c" } }, { arrayFilters: [{ "b.kind": "image" }] });
export const m07 = () => UserModel.find().where({ "badges.gold.awardedBy": id }).lean();
export const m08 = () => UserModel.find().or([{ "badges.gold.title": "a" }, { name: "b" }]);
