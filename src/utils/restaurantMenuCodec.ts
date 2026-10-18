import type { MenuSection } from "@/types/restaurant";
// Same normalization used by the existing Appwrite menu parser/serializer.
function cleanSections(arr: unknown): MenuSection[] {
  if (!Array.isArray(arr)) return [];
  const sections: MenuSection[] = [];
  for (const s of arr) {
    if (!s || typeof s !== "object") continue;
    const rec = s as Record<string, unknown>;
    const rawItems = Array.isArray(rec.items) ? rec.items : [];
    const items: string[] = [];
    for (const it of rawItems) {
      const name = typeof it === "string" ? it.trim() : "";
      if (name) items.push(name);
    }
    if (items.length === 0) continue;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    sections.push({ title, items });
  }
  return sections;
}
export function parseMenu(raw: string | null | undefined): MenuSection[] {
  if (!raw) return [];
  try { return cleanSections(JSON.parse(raw)); }
  catch { console.warn("[restaurants] failed to parse menu"); return []; }
}
export function serializeMenu(menu: MenuSection[] | null | undefined): string | null {
  const clean = cleanSections(menu);
  return clean.length > 0 ? JSON.stringify(clean) : null;
}
