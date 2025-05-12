// src/lib/db.ts
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
    postalCode: string;
    phone: string;
    createdAt: Date;
    updatedAt: Date;
  }

  affiliateSettings: {
    organizationId: string;
    pointsPerReferral: number;
    pointsPerReview: number;
    spendingNeeded: string;      // matches NUMERIC in SQL (ts → string)
    pointsPerSpending: number;
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

  /* ──────────────────────────────────────────────────────────────── */
  affiliateProducts: {
    id:              string;
    organizationId:  string;
    tenantId:        string;
    title:           string;
    description:     string | null;
    image:           string | null;
    sku:             string;
    status:          "published" | "draft";
    productType:     "simple" | "variable";
    minLevelId: string | null;
    /* points – country ➜ integer (sale nullable, mirrors salePrice) */
    regularPoints: Record<string, Record<string, number>>;   // ⬅︎ changed
    salePoints   : Record<string, Record<string, number>> | null;
    cost:            Record<string, number>;
    allowBackorders: boolean;
    manageStock:     boolean;
    stockStatus:     "managed" | "unmanaged";
    createdAt:       Date;
    updatedAt: Date;
  };

  affiliateProductVariations: {
    id:             string;
    productId:      string;                       /* ↺ affiliateProducts.id */
    attributes:     Record<string, string>;
    sku:            string;
    minLevelId: string | null;
    regularPoints: Record<string, Record<string, number>>;   // ⬅︎ changed
    salePoints   : Record<string, Record<string, number>> | null;
    cost:           Record<string, number>;
    image:          string | null;
    stock:          Record<string, Record<string, number>> | null;
    createdAt:      Date;
    updatedAt:      Date;
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
    status: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  cartProducts: {
    id: string;
    cartId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
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
    shippingTotal: number;
    discountTotal: number;
    totalAmount: number;
    couponCode: string;
    shippingService: string;
    address: string;
    dateCreated: Date;
    datePaid: Date;
    dateCompleted: Date;
    dateCancelled: Date;
    createdAt: Date;
    updatedAt: Date;
  }

  tierPricings: {
    id            : string
    organizationId: string
    name          : string
    countries     : string          // JSON array
    createdAt     : Date
    updatedAt     : Date
  }

  tierPricingSteps: {
    id           : string
    tierPricingId: string           // FK ↺ tierPricings.id
    fromUnits    : number
    toUnits      : number
    price        : number           // new column name
    createdAt    : Date
    updatedAt    : Date
  }

  tierPricingProducts: {
    id           : string
    tierPricingId: string
    productId    : string | null
    variationId  : string | null
    createdAt    : Date
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

  /* ─────────────── Placeholders (internal) ─────────────── */
  placeholders: {
    key: string;           // '{review_count}' → 'review_count'
    description: string;
    source: string;        // e.g. 'reviews.getCount'
    createdAt: Date;
    updatedAt: Date;
  };
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool }),
});
