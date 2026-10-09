// Roles and what each may do. The server enforces these on every route; the web app only uses them to hide controls.
export const ROLES = ['admin', 'designer', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'project:read', 'project:create', 'project:write', 'project:delete',
  'share:manage', 'catalog:read', 'catalog:write', 'import:run', 'file:upload',
  'user:manage', 'settings:manage', 'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const GRANTS: Record<Role, readonly Permission[]> = {
  viewer: ['project:read', 'catalog:read'],
  designer: ['project:read', 'project:create', 'project:write', 'share:manage', 'catalog:read', 'catalog:write', 'import:run', 'file:upload'],
  admin: PERMISSIONS,
};

export function isRole(r: unknown): r is Role { return typeof r === 'string' && (ROLES as readonly string[]).includes(r); }
/** Unknown or missing roles get nothing. */
export function can(role: unknown, perm: Permission): boolean { return isRole(role) && GRANTS[role].includes(perm); }
export function permissionsOf(role: unknown): Permission[] { return isRole(role) ? [...GRANTS[role]] : []; }
