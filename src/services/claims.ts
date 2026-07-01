// src/services/claims.ts
// "Claim your restaurant" ownership claims.
//
// Flow (Function-free, mirrors the restaurant-submission model):
//   1. A signed-in user submits a claim for a restaurant (createClaim) — saved
//      pending, readable only by them + the admins team.
//   2. An admin reviews it in the Claims queue and approves or rejects.
//      Approval sets `restaurant.ownerId` (admin has write perms) and marks the
//      claim approved. The owner never writes the restaurant doc directly, so
//      there's no privilege-escalation surface (Appwrite has no field-level
//      permissions).
//
// Tolerant where it makes sense: reads degrade to null/[]/0 so a missing
// collection (feature unconfigured) or a hiccup never traps the UI. Writes
// throw friendly errors the screens surface.

import {
  AppwriteException,
  ID,
  Permission,
  Query,
  Role,
} from "react-native-appwrite";

import { account, appwriteConfig, databases } from "@/services/appwrite";
import { ensureOwnerMenuDoc } from "@/services/restaurantMenus";
import {
  setRestaurantListingPaidUntil,
  setRestaurantOwner,
} from "@/services/restaurants";

// Free listing window granted on claim approval, so a newly-claimed restaurant
// stays visible while the owner sets up payment. They renew via the in-app
// listing purchase before this lapses.
const LISTING_GRACE_DAYS = 30;

export type ClaimStatus = "pending" | "approved" | "rejected";
export type ClaimRole = "owner" | "manager";

export interface RestaurantClaim {
  id: string;
  restaurantId: string;
  userId: string;
  status: ClaimStatus;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  role: ClaimRole;
  proofNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

interface ClaimDoc {
  $id: string;
  $createdAt: string;
  restaurantId: string;
  userId: string;
  status: ClaimStatus;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  role: ClaimRole;
  proofNote: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
}

function mapDoc(doc: ClaimDoc): RestaurantClaim {
  return {
    id: doc.$id,
    createdAt: doc.$createdAt,
    restaurantId: doc.restaurantId,
    userId: doc.userId,
    status: doc.status,
    contactName: doc.contactName,
    contactPhone: doc.contactPhone,
    contactEmail: doc.contactEmail,
    role: doc.role,
    proofNote: doc.proofNote ?? null,
    reviewedAt: doc.reviewedAt ?? null,
    reviewedBy: doc.reviewedBy ?? null,
  };
}

const db = appwriteConfig.databaseId;
function collectionId(): string {
  return appwriteConfig.collections.restaurantClaims;
}

/** Whether the claim feature is configured (collection env set). */
export function claimsEnabled(): boolean {
  return !!appwriteConfig.collections.restaurantClaims;
}

export class ClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimError";
  }
}

function toClaimError(err: unknown, fallback: string): ClaimError {
  if (err instanceof AppwriteException) {
    return new ClaimError(err.message || fallback);
  }
  return new ClaimError(fallback);
}

export interface CreateClaimInput {
  restaurantId: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  role: ClaimRole;
  proofNote?: string | null;
}

/** Submit a claim for a restaurant. Created pending; admin approves later. */
export async function createClaim(
  input: CreateClaimInput,
): Promise<RestaurantClaim> {
  const col = collectionId();
  if (!col) {
    throw new ClaimError("Claiming isn't available yet. Check back soon.");
  }

  const contactName = input.contactName.trim();
  const contactPhone = input.contactPhone.trim();
  const contactEmail = input.contactEmail.trim().toLowerCase();
  if (contactName.length < 2) {
    throw new ClaimError("Please enter your name.");
  }
  if (contactPhone.replace(/\D/g, "").length < 7) {
    throw new ClaimError("Please enter a phone number we can reach you on.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new ClaimError("Please enter a valid email address.");
  }

  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    throw new ClaimError("You must be signed in to claim a restaurant.");
  }

  try {
    const doc = await databases.createDocument(
      db,
      col,
      ID.unique(),
      {
        restaurantId: input.restaurantId,
        userId: me.$id,
        status: "pending" as ClaimStatus,
        contactName,
        contactPhone,
        contactEmail,
        role: input.role,
        proofNote: input.proofNote?.trim() || null,
        reviewedAt: null,
        reviewedBy: null,
      },
      [
        // A user can only grant permissions for roles they themselves hold, so
        // we set just their own (read + withdraw their claim). Admin access to
        // the queue — read / approve / reject — comes from the admins-team
        // grants at the COLLECTION level, which Appwrite applies alongside
        // these per-doc grants when Document Security is on.
        Permission.read(Role.user(me.$id)),
        Permission.delete(Role.user(me.$id)),
      ],
    );
    return mapDoc(doc as unknown as ClaimDoc);
  } catch (err) {
    throw toClaimError(err, "Couldn't submit your claim. Try again.");
  }
}

/**
 * The current user's most recent claim for a restaurant (any status), or null.
 * Used to show "claim pending / approved" state on the detail screen.
 */
export async function getMyClaimForRestaurant(
  restaurantId: string,
): Promise<RestaurantClaim | null> {
  const col = collectionId();
  if (!col) return null;
  let me: { $id: string };
  try {
    me = await account.get();
  } catch {
    return null;
  }
  try {
    const res = await databases.listDocuments(db, col, [
      Query.equal("restaurantId", restaurantId),
      Query.equal("userId", me.$id),
      Query.orderDesc("$createdAt"),
      Query.limit(1),
    ]);
    const doc = res.documents[0];
    return doc ? mapDoc(doc as unknown as ClaimDoc) : null;
  } catch {
    return null;
  }
}

export interface ClaimPage {
  items: RestaurantClaim[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Admin: list claims by status (default pending), newest first. */
export async function listClaims(
  opts: { status?: ClaimStatus; cursor?: string | null; pageSize?: number } = {},
): Promise<ClaimPage> {
  const col = collectionId();
  if (!col) return { items: [], nextCursor: null, hasMore: false };
  const { status = "pending", cursor, pageSize = 25 } = opts;

  const queries: string[] = [
    Query.equal("status", status),
    Query.orderDesc("$createdAt"),
    Query.limit(pageSize),
  ];
  if (cursor) queries.push(Query.cursorAfter(cursor));

  try {
    const res = await databases.listDocuments(db, col, queries);
    const items = (res.documents as unknown as ClaimDoc[]).map(mapDoc);
    const lastId = items.length > 0 ? items[items.length - 1].id : null;
    return {
      items,
      nextCursor: lastId,
      hasMore: items.length === pageSize,
    };
  } catch (err) {
    throw toClaimError(err, "Couldn't load claims.");
  }
}

async function currentUserId(): Promise<string | null> {
  try {
    return (await account.get()).$id;
  } catch {
    return null;
  }
}

/**
 * Admin: approve a claim. Sets the restaurant's owner, then marks the claim
 * approved. Owner assignment happens first so a failure there leaves the claim
 * pending (retryable) rather than approved-but-unassigned.
 */
export async function approveClaim(claim: RestaurantClaim): Promise<void> {
  const col = collectionId();
  if (!col) throw new ClaimError("Claims aren't enabled.");
  await setRestaurantOwner(claim.restaurantId, claim.userId);
  // Seed the owner-editable menu override doc so the new owner can manage their
  // menu (grants them per-doc Update). Best-effort — re-seedable later.
  try {
    await ensureOwnerMenuDoc(claim.restaurantId, claim.userId);
  } catch {
    /* non-fatal */
  }
  // Grant the free grace window so the now-claimed listing stays visible.
  // Best-effort: the claim is still valid even if this hiccups.
  try {
    const until = new Date(
      Date.now() + LISTING_GRACE_DAYS * 86_400_000,
    ).toISOString();
    await setRestaurantListingPaidUntil(claim.restaurantId, until);
  } catch {
    /* non-fatal — owner is set; the window can be granted again later */
  }
  try {
    await databases.updateDocument(db, col, claim.id, {
      status: "approved" as ClaimStatus,
      reviewedAt: new Date().toISOString(),
      reviewedBy: await currentUserId(),
    });
  } catch (err) {
    throw toClaimError(err, "Owner set, but couldn't mark the claim approved.");
  }
}

/** Admin: reject a claim (leaves the restaurant unowned). */
export async function rejectClaim(claim: RestaurantClaim): Promise<void> {
  const col = collectionId();
  if (!col) throw new ClaimError("Claims aren't enabled.");
  try {
    await databases.updateDocument(db, col, claim.id, {
      status: "rejected" as ClaimStatus,
      reviewedAt: new Date().toISOString(),
      reviewedBy: await currentUserId(),
    });
  } catch (err) {
    throw toClaimError(err, "Couldn't reject this claim.");
  }
}

/** Count of pending claims — for the admin dashboard badge. Tolerant. */
export async function countPendingClaims(): Promise<number> {
  const col = collectionId();
  if (!col) return 0;
  try {
    const res = await databases.listDocuments(db, col, [
      Query.equal("status", "pending"),
      Query.limit(1),
    ]);
    return res.total;
  } catch {
    return 0;
  }
}
