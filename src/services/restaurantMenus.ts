// src/services/restaurantMenus.ts
// Owner-editable menu OVERRIDE for a restaurant.
//
// The admin-managed menu lives on the restaurant doc (`restaurant.menu`). This
// collection layers an owner-editable override on top: when a verified owner
// edits their menu, it's stored here (doc id = restaurantId) and the detail
// screen prefers it over the base. Falls back to `restaurant.menu` when there's
// no override.
//
// Security — why this is safe without a server function:
//   - Users have NO collection-level Create permission, so nobody can squat a
//     menu doc for a restaurant they don't own.
//   - The doc is seeded by the ADMIN at claim approval (ensureOwnerMenuDoc),
//     which grants per-doc Update to the verified owner only. Owners can then
//     Update their doc but never create one, and never touch another's.
//   - Read is public so everyone sees the menu.
// The whole feature no-ops when the collection id is unset.

import { AppwriteException, Permission, Role } from "react-native-appwrite";

import { appwriteConfig, databases } from "@/services/appwrite";
import { parseMenu, serializeMenu } from "@/services/restaurants";
import type { MenuSection } from "@/types/restaurant";

export class RestaurantMenuError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestaurantMenuError";
  }
}

export function restaurantMenusEnabled(): boolean {
  return !!appwriteConfig.collections.restaurantMenus;
}

const db = () => appwriteConfig.databaseId;
const col = () => appwriteConfig.collections.restaurantMenus;

/**
 * Read the owner-managed menu override for a restaurant (doc id = restaurantId).
 * Returns `null` when there's no override doc, so the caller falls back to the
 * admin-managed `restaurant.menu`. Tolerant — never throws (a missing override
 * must not break the detail screen).
 */
export async function getOwnerMenu(
  restaurantId: string,
): Promise<MenuSection[] | null> {
  if (!restaurantMenusEnabled()) return null;
  try {
    const doc = (await databases.getDocument(
      db(),
      col(),
      restaurantId,
    )) as unknown as { menu?: string | null };
    return parseMenu(doc.menu ?? null);
  } catch {
    return null;
  }
}

/**
 * Owner: save their restaurant's menu override. Requires the per-doc Update
 * permission granted at claim approval (ensureOwnerMenuDoc) — owners can't
 * create the doc, so a 404 means menu editing hasn't been set up for them yet.
 */
export async function updateMyRestaurantMenu(
  restaurantId: string,
  menu: MenuSection[],
): Promise<void> {
  if (!restaurantMenusEnabled()) {
    throw new RestaurantMenuError("Menu editing isn't available right now.");
  }
  try {
    await databases.updateDocument(db(), col(), restaurantId, {
      menu: serializeMenu(menu) ?? "",
    });
  } catch (err) {
    if (err instanceof AppwriteException && err.code === 404) {
      throw new RestaurantMenuError(
        "Menu editing isn't set up for this restaurant yet. Please contact an admin.",
      );
    }
    throw new RestaurantMenuError(
      err instanceof AppwriteException ? err.message : "Couldn't save your menu.",
    );
  }
}

/**
 * Admin / claim-approval: ensure the owner-writable menu doc exists for a
 * restaurant, granting the verified owner per-doc Update. Idempotent — creates
 * the (empty) doc if missing, otherwise refreshes its permissions (e.g. when
 * ownership changes). Runs as the admin (collection-level write via the admins
 * team). Best-effort: callers treat failure as non-fatal.
 */
export async function ensureOwnerMenuDoc(
  restaurantId: string,
  ownerId: string,
): Promise<void> {
  if (!restaurantMenusEnabled()) return;
  const permissions = [
    Permission.read(Role.any()),
    Permission.update(Role.user(ownerId)),
  ];
  try {
    await databases.createDocument(
      db(),
      col(),
      restaurantId,
      { menu: "" },
      permissions,
    );
  } catch (err) {
    // 409 = already exists. Refresh permissions so the (current) owner can edit.
    if (err instanceof AppwriteException && err.code === 409) {
      await databases
        .updateDocument(db(), col(), restaurantId, {}, permissions)
        .catch(() => {});
      return;
    }
    throw err;
  }
}
