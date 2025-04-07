// /home/zodx/Desktop/trapigram/src/lib/permissions.ts
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

const customStatements = {
  ...defaultStatements,
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  // Placeholder for Accountant/Employee permissions (to be defined later)
  financialData: ["read"],
  projectData: ["read"],
} as const;

const ac = createAccessControl(customStatements);

const owner = ac.newRole({
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  financialData: ["read"],
  projectData: ["read"],
});

const manager = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"], // Can’t delete owner, handled in logic
  invitation: ["create", "cancel"],
  financialData: ["read"],
  projectData: ["read"],
});

const accountant = ac.newRole({
  financialData: ["read"],
});

const employee = ac.newRole({
  projectData: ["read"],
});

export { ac, owner, manager, accountant, employee };