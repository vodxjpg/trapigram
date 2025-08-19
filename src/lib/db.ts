// src/lib/db.ts
import fs from "fs";
import path from "path";
import { Pool } from "pg";                   // ✅ real Pool
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
    activeOrganizationId: string | null;
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
    countries: string;
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
    country: string | null;
    levelId: string;
    referredBy: string;
    createdAt: Date;
    updatedAt: Date;
  };

  clientAddresses: {
    id: string;
    clientId: string;
    address: string;
    createdAt: Date;
    updatedAt: Date;
  }

  affiliateSettings: {
    organizationId: string;
    pointsPerReferral: number;
    pointsPerReview: number;
    spendingNeeded: string;      // matches NUMERIC in SQL (ts → string)
    pointsPerSpending: number;
    monetaryValuePerPoint: string;
    createdAt: Date;
    updatedAt: Date;
  };

  affiliatePointLogs: {
    id: string;
    organizationId: string;
    clientId: string;           // ← renamed
    points: number;
    action: string;
    description: string | null;
    sourceClientId: string | null; // ← renamed
    createdAt: Date;
    updatedAt: Date;
  };

  affiliatePointBalances: {      // ← NEW
    clientId: string;
    organizationId: string;
    pointsCurrent: number;
    pointsSpent: number;
    createdAt: Date;
    updatedAt: Date;
  };

  affiliateLevels: {
    id: string;
    organizationId: string;
    name: string;
    image: string | null;
    levelUpMessage: string | null;
    description: string | null;
    requiredPoints: number;
    createdAt: Date;
    updatedAt: Date;
  };

  affiliateGroups: {             // already present, show for clarity
    id: string;
    organizationId: string;
    groupId: string;
    groupName: string | null;    // ← NEW
    points: number;
    platform: "telegram";
    createdAt: Date;
    updatedAt: Date;
  };

  affiliateGroupMembers: {       // ← NEW TABLE
    id: string;
    organizationId: string;
    affiliateGroupId: string;    // FK ↺ affiliateGroups.id
    groupId: string;           // telegram handle/id
    userId: string;              // auth user UUID
    clientId: string;            // clients.id
    joinedAt: Date;
    createdAt: Date;
    updatedAt: Date;
  };

  /* ──────────────────────────────────────────────────────────────── */
  affiliateProducts: {
    id: string;
    organizationId: string;
    tenantId: string;
    title: string;
    description: string | null;
    image: string | null;
    sku: string;
    status: "published" | "draft";
    productType: "simple" | "variable";
    minLevelId: string | null;
    /* points – country ➜ integer (sale nullable, mirrors salePrice) */
    regularPoints: Record<string, Record<string, number>>;   // ⬅︎ changed
    salePoints: Record<string, Record<string, number>> | null;
    cost: Record<string, number>;
    allowBackorders: boolean;
    manageStock: boolean;
    stockStatus: "managed" | "unmanaged";
    createdAt: Date;
    updatedAt: Date;
  };

  affiliateProductVariations: {
    id: string;
    productId: string;                       /* ↺ affiliateProducts.id */
    attributes: Record<string, string>;
    sku: string;
    minLevelId: string | null;
    regularPoints: Record<string, Record<string, number>>;   // ⬅︎ changed
    salePoints: Record<string, Record<string, number>> | null;
    cost: Record<string, number>;
    image: string | null;
    stock: Record<string, Record<string, number>> | null;
    createdAt: Date;
    updatedAt: Date;
  };

  coupons: {
    id: string;
    organizationId: string;
    name: string;
    code: string;
    description: string;
    discountType: string;
    discountAmount: number;
    startDate: Date;
    expirationDate: Date;
    limitPerUser: number;
    usagePerUser: number;
    usageLimit: number;
    expendingMinimum: number;
    expendingLimit: number;
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
    id: string;
    organizationId: string;
    name: string;
    url: string;
    countries: string;
    createdAt: Date;
    updatedAt: Date;
  };

  reviews: {
    id: string;
    orderId: string;
    organizationId: string;
    text: string;
    rate: string;
    createdAt: Date;
    updatedAt: Date;
  };

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

  orgRole: {
    id: string;
    organizationId: string;
    name: string;
    permissions: Record<string, string[]>;
    createdAt: Date;
    updatedAt: Date | null;
  };

  announcements: {
    id: string;
    organizationId: string;
    title: string;
    content: string;
    deliveryDate: Date | null;
    countries: string;
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
    ownerName: string | null;
    ownerEmail: string | null;
    plan: string | null;
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
    organizationId: string;
    name: string;
    countries: string;
    createdAt: Date;
    updatedAt: Date;
  };

  tickets: {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    status: string;
    priority: string;
    createdAt: Date;
    updatedAt: Date;
  };

  ticketMessages: {
    id: string;
    ticketId: string;
    message: string;
    attachments: string;
    isInternal: boolean;
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
    organizationId: string;
    country: string | null;
    isGlobal: boolean;
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
    regularPrice: Record<string, number>;
    salePrice: Record<string, number> | null;
    cost: Record<string, number>;
    allowBackorders: boolean;
    manageStock: boolean;
    stockStatus: "managed" | "unmanaged";
    createdAt: Date;
    updatedAt: Date;
  };

  productVariations: {
    id: string;
    productId: string;
    attributes: Record<string, string>;
    sku: string;
    regularPrice: Record<string, number>;
    salePrice: Record<string, number> | null;
    cost: Record<string, number>;
    image: string | null;
    stock: Record<string, Record<string, number>> | null;
    createdAt: Date;
    updatedAt: Date;
  };

  warehouseStock: {
    id: string;
    warehouseId: string;
    productId: string | null;            // <-- allow NULL
    affiliateProductId: string | null;   // <-- NEW
    variationId: string | null;
    affiliateVariationId: string | null;
    country: string;
    quantity: number;
    organizationId: string;
    tenantId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  warehouseShareLink: {
    id: string;
    warehouseId: string;
    creatorUserId: string;
    token: string;
    status: "active" | "revoked";
    createdAt: Date;
    updatedAt: Date;
  };

  warehouseShareRecipient: {
    id: string;
    shareLinkId: string;
    recipientUserId: string;
    targetWarehouseId: string | null;     // ← newly added
    createdAt: Date;
    updatedAt: Date;
  };

  sharedProduct: {
    id: string;
    shareLinkId: string;
    productId: string;
    variationId: string | null;
    cost: Record<string, number>;
    createdAt: Date;
    updatedAt: Date;
  };

  sharedProductMapping: {
    id: string;
    shareLinkId: string;
    sourceProductId: string;
    targetProductId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  sharedVariationMapping: {
    id: string;
    shareLinkId: string;
    sourceProductId: string;
    targetProductId: string;
    sourceVariationId: string;
    targetVariationId: string;
    createdAt: Date;
    updatedAt: Date;
  };

  paymentMethods: {
    id: string;
    name: string;
    tenantId: string;
    apiKey: string;
    secretKey: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  carts: {
    id: string;
    clientId: string;
    country: string;
    couponCode: string | null;
    shippingMethod: string;
    cartHash: string;
    cartUpdatedHash: string;
    organizationId: string;
    status: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  cartProducts: {
    id: string;
    cartId: string;
    productId: string | null;          // nullable now
    affiliateProductId: string | null; // NEW
    quantity: number;
    unitPrice: number;                 // pts OR €
    createdAt: Date;
    updatedAt: Date;
  }


  orders: {
    id: string;
    organizationId: string;
    clientId: string;
    cartId: string;
    country: string;
    status: string;
    paymentMethod: string;
    orderKey: string;
    cartHash: string;
    shippingMethod: string;
    shippingTotal: number;
    discountTotal: number;
    counponType: string;
    subtotal: number;
    totalAmount: number;
    couponCode: string;
    couponType: string;
    shippingService: string;
    address: string;
    dateCreated: Date;
    dateUnderpaid: Date;
    datePaid: Date;
    dateCompleted: Date;
    dateCancelled: Date;
    notifiedPaidOrCompleted: boolean;
    orderMeta: Record<string, any> | null;
    createdAt: Date;
    updatedAt: Date;
  }

  orderRevenue: {
    id: string;
    orderId: string;
    USDtotal: number;
    USDdiscount: number;
    USDshipping: number;
    USDcost: number;
    GBPtotal: number;
    GBPdiscount: number;
    GBPshipping: number;
    GBPcost: number;
    EURtotal: number;
    EURdiscount: number;
    EURshipping: number;
    EURcost: number;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }

  categoryRevenue: {
    id: string;
    categoryId: string;
    USDtotal: number;
    USDcost: number;
    GBPtotal: number;
    GBPcost: number;
    EURtotal: number;
    EURcost: number;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  }

  orderMessages: {
    id: string;
    orderId: string;
    clientId: string;
    isInternal: boolean;
    message: string;
    createdAt: Date;
    updatedAt: Date;
  }

  tierPricings: {
    id: string
    organizationId: string
    name: string
    active: boolean
    countries: string          // JSON array
    createdAt: Date
    updatedAt: Date
  }

  tierPricingSteps: {
    id: string
    tierPricingId: string           // FK ↺ tierPricings.id
    fromUnits: number
    toUnits: number
    price: number           // new column name
    createdAt: Date
    updatedAt: Date
  }

  tierPricingProducts: {
    id: string
    tierPricingId: string
    productId: string | null
    variationId: string | null
    createdAt: Date
  }

  /* ─────────────── Sections ─────────────── */
  sections: {
    id: string;
    organizationId: string;
    parentSectionId: string | null;
    name: string;
    title: string;
    content: string;
    videoUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  notifications: {
    id: string;
    organizationId: string;
    type: string;                    // e.g. 'order_placed'
    trigger: string | null;          // origin route / event
    message: string;                 // final text sent
    channels: string;                // JSON array ['email','in_app',…]
    country: string | null;
    targetUserId: string | null;
    targetClientId: string | null;
    createdAt: Date;
    updatedAt: Date;
  };

  notificationTemplates: {
    id: string;
    organizationId: string;
    type: string;                    // same as notifications.type
    role: "admin" | "user";
    countries: string;
    subject: string | null;
    message: string;                 // template body – may include {{ }}
    createdAt: Date;
    updatedAt: Date;
  };

  inAppNotifications: {
    id: string;
    organizationId: string;
    userId: string | null;
    clientId: string | null;
    title: string;
    message: string;
    country: string | null;
    url: string | null;
    read: boolean;
    createdAt: Date;
    updatedAt: Date;
  };

  notificationGroups: {
    id: string;
    groupId: string;
    organizationId: string;
    name: string;
    countries: string;          // JSON-stringified array ["ES","IT",…]
    createdAt: Date;
    updatedAt: Date;
  };

  ticketSupportGroups: {
    id: string;
    groupId: string;
    organizationId: string;
    name: string;
    countries: string;          // JSON-stringified array ["ES","IT",…]
    createdAt: Date;
    updatedAt: Date;
  };

  exchangeRate: {
    EUR: string,
    GBP: string,
    date: Date
  }

  inventoryCount: {
    id: string;
    warehouseId: string;
    organizationId: string;
    userId: string;
    reference: string;
    countType: string;
    countries: string;
    isCompleted: boolean;
    createdAt: Date;
    updatedAt: Date
  }

  inventoryCountItems: {
    id: string;
    inventoryCountId: string;
    productId: string;
    variationId: string;
    country: string;
    expectedQuantity: number;
    countedQuantity: number;
    discrepancyReason: string;
    isCounted: boolean;
    createdAt: Date;
    updatedAt: Date
  }

  /* ─────────────── Placeholders (internal) ─────────────── */
  placeholders: {
    key: string;           // '{review_count}' → 'review_count'
    description: string;
    source: string;        // e.g. 'reviews.getCount'
    createdAt: Date;
    updatedAt: Date;
  };
  /** Platform fee rates */
  userFeeRates: {
    id: string;
    userId: string;
    percent: string;       // numeric
    startsAt: Date;
    endsAt: Date | null;
    createdAt: Date;
  };

  /** Captured fees per order */
  orderFees: {
    id: string;
    orderId: string;
    userId: string;
    feeAmount: string;     // numeric
    percentApplied: string;// numeric
    capturedAt: Date;
  };

  /** Monthly invoices */
  userInvoices: {
    id: string;
    userId: string;
    periodStart: string;   // DATE
    periodEnd: string;     // DATE
    totalAmount: number;   // numeric
    paidAmount: number;
    status: string;        // pending|sent|paid
    dueDate: string;       // DATE
    createdAt: Date;
    niftipayOrderId: string | null;
    niftipayReference: string | null;
    niftipayNetwork: string;
    niftipayAsset: string;
    niftipayAddress: string | null;
    niftipayQrUrl: string | null;
  };

  /** Line items for invoices */
  invoiceItems: {
    id: string;
    invoiceId: string;
    orderFeeId: string;
    amount: string;        // numeric
  };
}

/* ──────────────────────────────────────────────────────────────── *
 *  Runtime safety checks                                          *
 * ──────────────────────────────────────────────────────────────── */
// Block accidental client-side bundling.
if (typeof window !== "undefined") {
  throw new Error("❌ db.ts must never be imported in browser bundles");
}

// Fail fast if DATABASE_URL is missing or obviously plaintext.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required");
}
if (process.env.DATABASE_URL.startsWith("postgres://") === false) {
  throw new Error("DATABASE_URL must use the postgres:// scheme");
}


/**
 * 
 * Absolute path to the Supabase root-CA certificate.
 * Adjust if your cert lives elsewhere.
 * Example:  certs/prod-ca-2021.crt  (placed at project root)
 */
const caPath = path.resolve(process.cwd(), "certs/prod-ca-2021.crt");
let supabaseCA = "";
try {
  supabaseCA = fs.readFileSync(caPath, "utf8");
  console.info(`✔︎ Loaded Supabase CA from ${caPath}`);
} catch (err) {
  console.error("✘ Failed to load Supabase CA:", (err as Error).message);
  throw err;                              // hard-fail: no CA → no DB
}

/* ──────────────── 4. Secure pg Pool (TLS 1.3+, keep-alive) ─────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: supabaseCA,
    rejectUnauthorized: true,
    /** Enforce modern cipher suites; Node ≥20 negotiates TLS 1.3 by default,
     * but we pin it defensivey. */
    minVersion: "TLSv1.3",
  },
  max: Number.parseInt(process.env.PG_POOL_MAX ?? "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  keepAlive: true,
  statement_timeout: 5_000,   // abort rlong-running queries server-side
});

/* Optional structured diagnostics; disable in production logs */
if (process.env.NODE_ENV !== "production") {
  pool.on("connect", () => console.info("↯ DB connection established"));
  pool.on("error", (err) => console.error("DB client error:", err));
}

/* ──────────────── 5. Kysely instance ───────────────── */

export { pool as pgPool };   // for raw SQL users 
export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});