// src/services/reviewResponses.ts
// Owner replies to reviews. A restaurant owner can post one public reply per
// review on their restaurant.
//
// Trust model (Function-free): anyone with the Users role can technically
// create a response doc, so we never trust a response on its own. Reads are
// always scoped to `authorId === restaurant.ownerId`, so a forged response by a
// non-owner simply never matches and never renders as an official "owner reply".
// Reads are public (Role.any); only the author (+ admins) can edit/delete.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";

export interface ReviewResponse {
  id: string;
  reviewId: string;
  restaurantId: string;
  authorId: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

interface ResponseDoc {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  reviewId: string;
  restaurantId: string;
  authorId: string;
  text: string;
}

function mapDoc(doc: ResponseDoc): ReviewResponse {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    updatedAt: doc.$updatedAt,
    reviewId: doc.reviewId,
    restaurantId: doc.restaurantId,
    authorId: doc.authorId,
    text: doc.text,
  };
}

const db = appwriteConfig.databaseId;
function collectionId(): string {
  return appwriteConfig.collections.reviewResponses;
}

/** Whether owner replies are configured (collection env set). */
export function responsesEnabled(): boolean {
  return !!appwriteConfig.collections.reviewResponses;
}

export class ResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseError";
  }
}

function toResponseError(err: unknown, fallback: string): ResponseError {
  if (err instanceof AppwriteException) {
    return new ResponseError(err.message || fallback);
  }
  return new ResponseError(fallback);
}

const MAX_LEN = 1000;

/**
 * The owner's reply to a single review, or null. Scoped to `ownerId` so only
 * the genuine owner's response is ever returned. Tolerant.
 */
export async function getOwnerResponse(
  reviewId: string,
  ownerId: string | null,
): Promise<ReviewResponse | null> {
  const col = collectionId();
  if (!col || !ownerId) return null;
  try {
    const res = await databases.listDocuments(db, col, [
      Query.equal("reviewId", reviewId),
      Query.equal("authorId", ownerId),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ]);
    const doc = res.documents[0];
    return doc ? mapDoc(doc as unknown as ResponseDoc) : null;
  } catch {
    return null;
  }
}

/**
 * Owner replies for a set of reviews (single restaurant → single ownerId),
 * keyed by reviewId. For list surfaces. Tolerant: empty map on failure.
 */
export async function getOwnerResponsesForReviews(
  reviewIds: string[],
  ownerId: string | null,
): Promise<Map<string, ReviewResponse>> {
  const map = new Map<string, ReviewResponse>();
  const col = collectionId();
  if (!col || !ownerId || reviewIds.length === 0) return map;
  const unique = Array.from(new Set(reviewIds));
  try {
    const res = await databases.listDocuments(db, col, [
      Query.equal("reviewId", unique),
      Query.equal("authorId", ownerId),
      Query.limit(unique.length),
    ]);
    for (const doc of res.documents) {
      const r = mapDoc(doc as unknown as ResponseDoc);
      if (!map.has(r.reviewId)) map.set(r.reviewId, r);
    }
    return map;
  } catch {
    return map;
  }
}

export async function createResponse(input: {
  reviewId: string;
  restaurantId: string;
  text: string;
}): Promise<ReviewResponse> {
  const col = collectionId();
  if (!col) throw new ResponseError("Replies aren't available yet.");
  const body = input.text.trim();
  if (!body) throw new ResponseError("Write a reply first.");
  if (body.length > MAX_LEN) {
    throw new ResponseError(`Replies are limited to ${MAX_LEN} characters.`);
  }

  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    throw new ResponseError("You must be signed in to reply.");
  }

  try {
    const doc = await databases.createDocument(
      db,
      col,
      ID.unique(),
      {
        reviewId: input.reviewId,
        restaurantId: input.restaurantId,
        authorId: me.$id,
        text: body,
      },
      [
        // Public so everyone sees the owner reply; only the author can edit /
        // remove it. (A user can't grant team roles it isn't in, so admin
        // moderation comes from the admins-team Delete grant at the COLLECTION
        // level, applied alongside these when Document Security is on.)
        Permission.read(Role.any()),
        Permission.update(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );
    return mapDoc(doc as unknown as ResponseDoc);
  } catch (err) {
    throw toResponseError(err, "Couldn't post your reply.");
  }
}

export async function updateResponse(
  id: string,
  text: string,
): Promise<ReviewResponse> {
  const col = collectionId();
  if (!col) throw new ResponseError("Replies aren't available yet.");
  const body = text.trim();
  if (!body) throw new ResponseError("Write a reply first.");
  if (body.length > MAX_LEN) {
    throw new ResponseError(`Replies are limited to ${MAX_LEN} characters.`);
  }
  try {
    const doc = await databases.updateDocument(db, col, id, { text: body });
    return mapDoc(doc as unknown as ResponseDoc);
  } catch (err) {
    throw toResponseError(err, "Couldn't update your reply.");
  }
}

export async function deleteResponse(id: string): Promise<void> {
  const col = collectionId();
  if (!col) return;
  try {
    await databases.deleteDocument(db, col, id);
  } catch (err) {
    throw toResponseError(err, "Couldn't delete your reply.");
  }
}
