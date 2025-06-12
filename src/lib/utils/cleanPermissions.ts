// utils/cleanPermissions.ts
export function cleanPermissions(obj: Record<string,string[]>) {
    return Object.fromEntries(
      Object.entries(obj).filter(([, actions]) => actions.length)
    );
  }
  