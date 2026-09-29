import type { Knex } from "knex";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS } from "@/modules/rbac/permissions";

export async function seed(knex: Knex): Promise<void> {
  await knex("role_permissions").del();
  await knex("user_roles").del();
  await knex("roles").del();
  await knex("permissions").del();

  const permissionRows = PERMISSIONS.map((key) => ({ key, description: key }));
  await knex("permissions").insert(permissionRows);
  const permissions = await knex("permissions").select("id", "key");
  const permissionIdByKey = new Map(permissions.map((p) => [p.key, p.id]));

  for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const [role] = await knex("roles")
      .insert({ name: roleName, description: `${roleName} — seeded default role`, is_system: true })
      .returning(["id"]);
    const rolePermissionRows = perms
      .map((p) => permissionIdByKey.get(p))
      .filter(Boolean)
      .map((permission_id) => ({ role_id: role.id, permission_id }));
    if (rolePermissionRows.length) {
      await knex("role_permissions").insert(rolePermissionRows);
    }
  }
}
