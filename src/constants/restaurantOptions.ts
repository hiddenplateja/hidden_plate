// src/constants/restaurantOptions.ts
// Selectable options for the "add a restaurant" form. Cuisine/category labels
// here are display-cased; the create service lowercases them before storing
// (existing data is stored lowercase, and the search filter matches lowercase).

import type { OpeningHours, Parish, PriceRange } from "@/types/restaurant";

export interface ParishOption {
  value: Parish;
  label: string;
}

export const PARISH_OPTIONS: ParishOption[] = [
  { value: "kingston", label: "Kingston" },
  { value: "st_andrew", label: "St. Andrew" },
  { value: "st_catherine", label: "St. Catherine" },
  { value: "clarendon", label: "Clarendon" },
  { value: "manchester", label: "Manchester" },
  { value: "st_elizabeth", label: "St. Elizabeth" },
  { value: "westmoreland", label: "Westmoreland" },
  { value: "hanover", label: "Hanover" },
  { value: "st_james", label: "St. James" },
  { value: "trelawny", label: "Trelawny" },
  { value: "st_ann", label: "St. Ann" },
  { value: "st_mary", label: "St. Mary" },
  { value: "portland", label: "Portland" },
  { value: "st_thomas", label: "St. Thomas" },
];

// Broad food traditions.
export const CUISINE_OPTIONS: string[] = [
  "Jamaican",
  "Caribbean",
  "Chinese",
  "Indian",
  "Italian",
  "American",
  "Mexican",
  "Continental",
  "Japanese",
  "Thai",
  "Fusion",
  "Middle Eastern",
  "Vegetarian",
];

// Venue style / signature dishes.
export const CATEGORY_OPTIONS: string[] = [
  "Jerk",
  "BBQ",
  "Seafood",
  "Fast Food",
  "Street Food",
  "Fine Dining",
  "Cafe",
  "Bakery",
  "Bar",
  "Vegan",
  "Breakfast",
  "Brunch",
  "Desserts",
  "Pizza",
  "Burgers",
  "Wings",
  "Patties",
  "Juice Bar",
  "Food Truck",
  "Pastry",
];

export interface PriceOption {
  value: PriceRange;
  hint: string;
}

export const PRICE_OPTIONS: PriceOption[] = [
  { value: "$", hint: "Cheap eats" },
  { value: "$$", hint: "Moderate" },
  { value: "$$$", hint: "Pricey" },
  { value: "$$$$", hint: "High-end" },
];

// Day chips for the optional opening-hours editor, in week order.
export interface DayOption {
  key: keyof OpeningHours;
  label: string;
}

export const DAY_OPTIONS: DayOption[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];
