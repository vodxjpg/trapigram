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

  // Better Auth Organization Plugin Tables
  organization: {
    id: string;
    name: string;
    slug: string;
    logo: string | null;
    metadata: string | null;
    countries: string; // JSON array of country codes
    encryptedSecret: string;
    createdAt: Date;
    updatedAt: Date;
  };

  clients: {
    id: string;
    userId: string | null;
    organizationId: string;
    username: string;
    firstName: string;
    lastName: string;
    lastInteraction: Date;
    email: string;
    phoneNumber: string; 
    country: string | null
    levelId: string;
    referredBy: string;
    createdAt: Date;
    updatedAt: Date;
  };
  coupons: {
    id: string;
    organizationId: string;
    name: string;
    code: string;
    description: string;
    expirationDate: Date;
    limitePerUser: number;
    usagePerUser: number;
    usageLimit: number;
    expendingMinimum: number;
    expendingLImit: number;
    countries: string;
    visibility: boolean;
    createdAt: Date;
    updatedAt: Date;
  }
  member: {
    id: string;
    userId: string;
    organizationId: string;
    role: string;
    createdAt: Date;
  };
  invitation: {
    id: string;
    email: string;
    inviterId: string;
    organizationId: string;
    role: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
  };
  anouncements:{
    id: string;
    organizationId: string;
    title: string;
    content: string;
    deliveryDate: Date;
    countries: string;
    status: string;
    sent: boolean;
    createdAt: Date;
    updatedAt: Date;
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
    id: string;
    ownerUserId: string;
    owner_name: string | null; // Added for tenant owner’s name
    owner_email: string | null; // Added for tenant owner’s email
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
    organizationId: string; // JSON array
    name: string;
    countries: string; // JSON array
    createdAt: Date;
    updatedAt: Date;
  };

  organizationPlatformKey: {
    id: string;
    organizationId: string;
    platform: string;
    apiKey: string;
    createdAt: Date;
    updatedAt: Date;
  };

  organizationSupportEmail: {
    id: string;
    organizationId: string; // references "organization"
    country: string | null; // e.g. "ES", "IT", or null if global
    isGlobal: boolean; // if true, this row applies to all org countries
    email: string;
    createdAt: Date;
    updatedAt: Date;
  };

  productCategories: {
    id: string;
    name: string;
    slug: string;
    image: string | null;
    order: number;
    organizationId: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  productCategory: {
    productId: string;
    categoryId: string;
  };

  productAttributes: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  productAttributeTerms: {
    id: string;
    attributeId: string;
    name: string;
    slug: string;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  productAttributeValues: {
    productId: string;
    attributeId: string;
    termId: string;
  };




  // New Tables

  // The "products" table stores individual products
  products: {
    id: string;
    organization_id: string;
    tenant_id: string;
    title: string;
    description: string | null;
    image: string | null;
    sku: string;
    status: "published" | "draft";
    product_type: "simple" | "variable";
    regular_price: number;
    sale_price: number | null;
    allow_backorders: boolean;
    manage_stock: boolean;
    // JSONB field: structure mapping warehouse ids to stock levels per country.
    stock_data: Record<string, Record<string, number>> | null;
    // Quick status field to mark managed/unmanaged inventory.
    stock_status: "managed" | "unmanaged";
    created_at: Date;
    updated_at: Date;
  };

  // The "product_variations" table stores variations for variable products
  productVariations: {
    id: string;
    product_id: string;
    // JSONB field: mapping attribute IDs to term IDs.
    attributes: Record<string, string>;
    sku: string;
    regular_price: number;
    sale_price: number | null;
    // JSONB field: structure mapping warehouse ids to stock levels per country.
    stock: Record<string, Record<string, number>> | null;
    created_at: Date;
    updated_at: Date;
  };
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});