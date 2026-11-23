/**
 * Admin accounts. Kelly, Sarah, and admin can view and change the same things.
 * Usernames are matched without case.
 */
export const ADMIN_USERS = ["admin", "kelly", "sarah"] as const;

export function isAdmin(username: string | null | undefined): boolean {
  const key = (username ?? "").trim().toLowerCase();
  return (ADMIN_USERS as readonly string[]).includes(key);
}
