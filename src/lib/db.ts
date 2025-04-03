// /home/zodx/Desktop/trapigram/src/lib/db.ts
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";

interface DB {
  // Base Better Auth Tables
  user: {
    id: string;
    email: string;
    name: string | null;
    phone: string | null;
    country: string | null;
    is_guest: boolean | null;
    emailVerified: boolean | null;
    image: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  account: {
    id: string;
    userId: string;
    accountId: string | null;
    providerId: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    accessTokenExpiresAt: Date | null;
    refreshTokenExpiresAt: Date | null;
    scope: string | null;
    idToken: string | null;
    password: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  session: {
    id: string;
    userId: string;
    token: string;
    expiresAt: Date | null;
    ipAddress: string | null;
    userAgent: string | null;
    activeOrganizationId: string | null; // Added for organization plugin
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  verification: {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };


  // Better auth Organization Plugin Tables
  organization: {
    id: string;
    name: string;
    slug: string;
    logo: string | null; // Nullable as per Better Auth docs
    metadata: string | null; // Nullable JSON string
    countries: string; // Added custom field, JSON string of country codes (TEXT)
    createdAt: Date;
    updatedAt: Date;
  };
  member: {
    id: string;
    userId: string;
    organizationId: string;
    role: string; // e.g., "owner", "admin", "member"
    createdAt: Date;
  };
  invitation: {
    id: string;
    email: string;
    inviterId: string;
    organizationId: string;
    role: string; // e.g., "owner", "admin", "member"
    status: string; // e.g., "pending", "accepted", "rejected"
    expiresAt: Date;
    createdAt: Date;
  };
  team: {
    id: string;
    name: string;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  // Custom Tables
  tenant: {
    id: string; // TEXT in PostgreSQL
    ownerUserId: string;
    createdAt: Date;
    updatedAt: Date;
    onboardingCompleted: number | null;
  };
  subscription: {
    id: string;
    userId: string;
    plan: string | null;
    status: string | null;
    trialStart: Date | null;
    trialEnd: Date | null;
    periodStart: Date | null;
    periodEnd: Date | null;
  };
  warehouse: {
    id: string;
    tenantId: string;
    organizationId: string; // references "organization"
    name: string;
    countries: string; // JSON string of country codes (TEXT in PostgreSQL)
    createdAt: Date; // Changed to Date to match TIMESTAMP
    updatedAt: Date; // Changed to Date to match TIMESTAMP
  };

  organizationPlatformKey: {
    id: string;
    organizationId: string; // references "organization"
    platform: string;       // "telegram", "whatsapp", or "signal"
    apiKey: string;         // the actual secret key
    createdAt: Date;
    updatedAt: Date;
  };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});