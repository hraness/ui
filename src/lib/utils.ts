import { clsx, type ClassValue } from "clsx";

/** Combines conditional classes while preserving caller source order. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
