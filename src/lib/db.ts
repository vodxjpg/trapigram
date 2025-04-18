// /home/zodx/Desktop/trapigram/src/lib/db.ts
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";


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
    limitPerUser: number;
    usagePerUser: number;
    usageLimit: number;
    expendingMinimum: number;
    expendingLImit: number;
    countries: string;
    visibility: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
  shipments: {
    id: string;
    organizationId: string;
    countries: string;
    title: string;
    description: string;
    costs: string;
    createdAt: Date;
    updatedAt: Date;
  };
  shippingMethods: {
    id: string,
    organizationId: string,
    name: string,
    url: string,
    countries: string,
    createdAt: Date,
    updatedAt: Date,
  };
  reviews: {
    id: string,
    orderId: string,
    organizationId: string,
    text: string,
    rate: string,
    createdAt: Date,
    updatedAt: Date,
    
  };
  member: {
    id: string;
    userId: string;
    organizationId: string,
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
  announcements: { 
    id: string;
    organizationId: string;
    title: string;
    content: string;
    deliveryDate: Date | null; // Nullable for unscheduled deliveries
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
    organizationId: string;
    tenantId: string;
    title: string;
    description: string | null;
    image: string | null;
    sku: string;
    status: "published" | "draft";
    productType: "simple" | "variable";
    /** key = ISO‑3166 country (§ organization.countries) */
    regularPrice: Record<string, number>;           //   « changed »
    salePrice:   Record<string, number> | null;     //   « changed »
    cost:         Record<string, number>;               // ← ★
    allowBackorders: boolean;
    manageStock: boolean;
    stockData: Record<string, Record<string, number>> | null;
    stockStatus: "managed" | "unmanaged";
    createdAt: Date;
    updatedAt: Date;
  };


  // The "product_variations" table stores variations for variable products
  productVariations: {
    id: string;
    product_id: string;
    attributes: Record<string, string>;
    sku: string;
    /** country‑based pricing for the variation */
    regularPrice: Record<string, number>;          //   « changed »
    salePrice:   Record<string, number> | null;    //   « changed »
    cost:         Record<string, number>;     
    stock: Record<string, Record<string, number>> | null;
    createdAt: Date;
    updatedAt: Date;
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // allow the self‑signed chain from the pooler
    rejectUnauthorized: false
  }
})


export const db = new Kysely({
  dialect: new PostgresDialect({ pool })
})