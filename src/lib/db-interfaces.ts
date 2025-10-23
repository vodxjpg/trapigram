// AUTO-GENERATED from provided schema

export type Json = unknown;

export interface account {
  id: string;
  userId: string;
  accountId: string;
  providerId: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  scope: string;
  idToken: string;
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface affiliateGroupMembers {
  id: string;
  organizationId: string;
  affiliateGroupId: string;
  groupId: string;
  userId: string;
  clientId: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface affiliateGroups {
  id: string;
  organizationId: string;
  groupId: string;
  points: number;
  platform: string;
  createdAt: Date;
  updatedAt: Date;
  groupName: string;
}

export interface affiliateLevels {
  id: string;
  organizationId: string;
  name: string;
  image: string;
  levelUpMessage: string;
  levelUpMessageGroup: string;
  requiredPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface affiliatePointBalances {
  clientId: string;
  organizationId: string;
  pointsCurrent: number;
  pointsSpent: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface affiliatePointLogs {
  id: string;
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description: string;
  sourceClientId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface affiliateProductVariations {
  id: string;
  productId: string;
  attributes: unknown;
  sku: string;
  regularPoints: unknown;
  salePoints: unknown;
  cost: unknown;
  image: string;
  stock: unknown;
  createdAt: Date;
  updatedAt: Date;
  minLevelId: string;
}

export interface affiliateProducts {
  id: string;
  organizationId: string;
  tenantId: string;
  title: string;
  description: string;
  image: string;
  sku: string;
  status: string;
  productType: string;
  regularPoints: unknown;
  salePoints: unknown;
  cost: unknown;
  allowBackorders: boolean;
  manageStock: boolean;
  stockStatus: string;
  createdAt: Date;
  updatedAt: Date;
  minLevelId: string;
}

export interface affiliateSettings {
  organizationId: string;
  pointsPerReferral: number;
  pointsPerReview: number;
  spendingNeeded: string;
  pointsPerSpending: number;
  createdAt: Date;
  updatedAt: Date;
  monetaryValuePerPoint: string;
}

export interface announcements {
  id: string;
  organizationId: string;
  title: string;
  content: string;
  deliveryDate: Date;
  countries: string;
  sent: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface apikey {
  id: string;
  name: string;
  start: string;
  prefix: string;
  key: string;
  userId: string;
  refillInterval: number;
  refillAmount: number;
  lastRefillAt: Date;
  enabled: boolean;
  rateLimitEnabled: boolean;
  rateLimitTimeWindow: number;
  rateLimitMax: number;
  requestCount: number;
  remaining: number;
  lastRequest: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  permissions: string;
  metadata: string;
}

export interface automationRuleLocks {
  id: string;
  organizationId: string;
  ruleId: string;
  event: string;
  clientId: string;
  orderId: string;
  dedupeKey: string;
  createdAt: Date;
}

export interface automationRules {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: number;
  event: string;
  countries: string;
  action: string;
  channels: string;
  payload: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface cartProducts {
  id: string;
  cartId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  createdAt: Date;
  updatedAt: Date;
  affiliateProductId: string;
  variationId: string;
}

export interface carts {
  id: string;
  clientId: string;
  country: string;
  couponCode: string;
  shippingMethod: string;
  cartHash: string;
  cartUpdatedHash: string;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
  organizationId: string;
  channel: string;
}

export interface categoryRevenue {
  id: string;
  categoryId: string;
  USDtotal: string;
  USDcost: string;
  GBPtotal: string;
  GBPcost: string;
  EURtotal: string;
  EURcost: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface clientAddresses {
  id: string;
  clientId: string;
  address: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface clientSecretPhrase {
  id: string;
  clientId: string;
  phrase: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface clients {
  id: string;
  userId: string;
  organizationId: string;
  username: string;
  firstName: string;
  lastName: string;
  lastInteraction: Date;
  email: string;
  phoneNumber: string;
  country: string;
  levelId: string;
  referredBy: string;
  createdAt: Date;
  updatedAt: Date;
  secretPhraseEnabled: boolean;
  secretPhraseReverifyDays: number;
  secretPhraseForceAt: Date;
}

export interface coupons {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string;
  discountType: string;
  discountAmount: string;
  startDate: Date;
  expirationDate: Date;
  limitPerUser: number;
  usagePerUser: number;
  usageLimit: number;
  expendingMinimum: string;
  expendingLimit: string;
  countries: string;
  visibility: boolean;
  createdAt: Date;
  updatedAt: Date;
  stackable: boolean;
}

export interface creditExternalIdentities {
  id: string;
  organizationId: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email: string;
  createdAt: Date;
}

export interface creditHolds {
  id: string;
  organizationId: string;
  walletId: string;
  provider: string;
  orderId: string;
  amountMinor: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface creditLedgerEntries {
  id: string;
  organizationId: string;
  walletId: string;
  direction: string;
  amountMinor: string;
  reason: string;
  reference: unknown;
  idempotencyKey: string;
  createdAt: Date;
}

export interface creditSyncCodes {
  code: string;
  organizationId: string;
  provider: string;
  providerUserId: string;
  email: string;
  status: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface creditWallets {
  id: string;
  organizationId: string;
  userId: string;
  currency: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface exchangeRate {
  EUR: string;
  GBP: string;
  date: Date;
}

export interface idempotency {
  key: string;
  method: string;
  path: string;
  status: number;
  response: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface inAppNotifications {
  id: string;
  organizationId: string;
  userId: string;
  clientId: string;
  title: string;
  message: string;
  country: string;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
  url: string;
}

export interface inventoryCount {
  id: string;
  createdAt: Date;
  reference: string;
  warehouseId: string;
  countType: string;
  organizationId: string;
  userId: string;
  countries: string;
  isCompleted: boolean;
  updatedAt: Date;
}

export interface inventoryCountItems {
  id: string;
  inventoryCountId: string;
  productId: string;
  variationId: string;
  country: string;
  expectedQuantity: string;
  countedQuantity: string;
  discrepancyReason: string;
  isCounted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface invitation {
  id: string;
  email: string;
  inviterId: string;
  organizationId: string;
  role: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface invoiceItems {
  id: string;
  invoiceId: string;
  orderFeeId: string;
  amount: string;
}

export interface member {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
}

export interface notificationGroups {
  id: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt: Date;
  updatedAt: Date;
  groupId: string;
}

export interface notificationOutbox {
  id: string;
  organizationId: string;
  orderId: string;
  type: string;
  trigger: string;
  channel: string;
  payload: unknown;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface notificationTemplates {
  id: string;
  organizationId: string;
  type: string;
  role: string;
  countries: string;
  subject: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface notifications {
  id: string;
  organizationId: string;
  type: string;
  trigger: string;
  message: string;
  channels: string;
  country: string;
  targetUserId: string;
  targetClientId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface orderFees {
  id: string;
  orderId: string;
  userId: string;
  feeAmount: string;
  percentApplied: string;
  capturedAt: Date;
}

export interface orderMessageReceipts {
  messageId: string;
  clientId: string;
  deliveredAt: Date;
}

export interface orderMessages {
  id: string;
  orderId: string;
  clientId: string;
  isInternal: boolean;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface orderNotes {
  id: string;
  organizationId: string;
  orderId: string;
  authorRole: string;
  authorClientId: string;
  authorUserId: string;
  note: string;
  visibleToCustomer: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface orderPayments {
  id: string;
  orderId: string;
  methodId: string;
  amount: string;
  createdAt: Date;
}

export interface orderRevenue {
  id: string;
  orderId: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
  USDtotal: string;
  USDdiscount: string;
  USDshipping: string;
  USDcost: string;
  GBPtotal: string;
  GBPdiscount: string;
  GBPshipping: string;
  GBPcost: string;
  EURtotal: string;
  EURdiscount: string;
  EURshipping: string;
  EURcost: string;
  cancelled: boolean;
  refunded: boolean;
}

export interface orders {
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
  shippingTotal: string;
  discountTotal: string;
  counponType: string;
  totalAmount: string;
  couponCode: string;
  shippingService: string;
  address: string;
  dateCreated: Date;
  datePaid: Date;
  dateCompleted: Date;
  dateCancelled: Date;
  createdAt: Date;
  updatedAt: Date;
  subtotal: string;
  couponType: string;
  trackingNumber: string;
  pointsRedeemed: number;
  pointsRedeemedAmount: string;
  notifiedPaidOrCompleted: boolean;
  orderMeta: unknown;
  dateUnderpaid: Date;
  referralAwarded: boolean;
  discountValue: unknown;
  orderChannel: string;
  channel: string;
}

export interface orgRole {
  id: string;
  organizationId: string;
  name: string;
  permissions: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface orgSecretCode {
  id: string;
  organizationId: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  verifiedAt: Date;
  consumedAt: Date;
  ticketId: string;
  createdAt: Date;
}

export interface organization {
  id: string;
  name: string;
  slug: string;
  logo: string;
  metadata: string;
  countries: string;
  encryptedSecret: string;
  createdAt: Date;
  updatedAt: Date;
  secretPhraseEnabled: boolean;
}

export interface organizationPlatformKey {
  id: string;
  organizationId: string;
  platform: string;
  apiKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface organizationSupportEmail {
  id: string;
  organizationId: string;
  country: string;
  isGlobal: boolean;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface paymentMethods {
  id: string;
  name: string;
  tenantId: string;
  apiKey: string;
  secretKey: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  description: string;
  instructions: string;
  default: boolean;
  posVisible: boolean;
}

export interface placeholders {
  key: string;
  description: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface posIdempotency {
  id: string;
  organizationId: string;
  key: string;
  orderId: string;
  createdAt: Date;
}

export interface posReceiptTemplates {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  printFormat: string;
  options: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface productAttributeTerms {
  id: string;
  attributeId: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface productAttributeValues {
  productId: string;
  attributeId: string;
  termId: string;
}

export interface productAttributes {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface productCategories {
  id: string;
  name: string;
  slug: string;
  image: string;
  order: number;
  organizationId: string;
  parentId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface productCategory {
  productId: string;
  categoryId: string;
}

export interface productTaxRules {
  productId: string;
  taxRuleId: string;
}

export interface productVariations {
  id: string;
  productId: string;
  attributes: unknown;
  sku: string;
  regularPrice: unknown;
  salePrice: unknown;
  cost: unknown;
  image: string;
  stock: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface products {
  id: string;
  organizationId: string;
  tenantId: string;
  title: string;
  description: string;
  image: string;
  sku: string;
  status: string;
  productType: string;
  regularPrice: unknown;
  salePrice: unknown;
  cost: unknown;
  allowBackorders: boolean;
  manageStock: boolean;
  stockStatus: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface rateLimit {
  id: string;
  key: string;
  count: number;
  lastRequest: string;
}

export interface registers {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  displayActive: boolean;
  displayDevice: string;
  displayAccessKey: string;
  displayPairCode: string;
  displayPairCodeExpiresAt: Date;
  displayPairedAt: Date;
  displaySlides: unknown;
  displaySessionId: string;
}

export interface reviews {
  id: string;
  orderId: string;
  organizationId: string;
  text: string;
  rate: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface sections {
  id: string;
  organizationId: string;
  parentSectionId: string;
  name: string;
  title: string;
  content: string;
  videoUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress: string;
  userAgent: string;
  activeOrganizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface sharedProduct {
  id: string;
  shareLinkId: string;
  productId: string;
  variationId: string;
  cost: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface sharedProductMapping {
  id: string;
  shareLinkId: string;
  sourceProductId: string;
  targetProductId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface sharedVariationMapping {
  id: string;
  shareLinkId: string;
  sourceProductId: string;
  targetProductId: string;
  sourceVariationId: string;
  targetVariationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface shipments {
  id: string;
  organizationId: string;
  countries: string;
  title: string;
  description: string;
  costs: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface shippingMethods {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  countries: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface stores {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  taxRegistration: string;
  createdAt: Date;
  updatedAt: Date;
  defaultReceiptTemplateId: string;
}

export interface subscription {
  id: string;
  userId: string;
  plan: string;
  status: string;
  trialStart: Date;
  trialEnd: Date;
  periodStart: Date;
  periodEnd: Date;
}

export interface supplierCart {
  id: string;
  supplierId: string;
  organizationId: string;
  status: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface supplierCartProducts {
  id: string;
  supplierCartId: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  cost: string;
  country: string;
  createdAt: Date;
  updatedAt: Date;
  received: string;
  variationId: string;
}

export interface supplierOrders {
  id: string;
  supplierId: string;
  organizationId: string;
  supplierCartId: string;
  note: string;
  status: string;
  expectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  orderKey: string;
}

export interface suppliers {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface tags {
  id: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface taxRules {
  id: string;
  organizationId: string;
  name: string;
  rate: string;
  inclusive: boolean;
  region: string;
  country: string;
  state: string;
  city: string;
  postcode: string;
  priority: number;
  compound: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface team {
  id: string;
  name: string;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface telegramDedup {
  chatId: string;
  textHash: string;
  createdAt: Date;
}

export interface tenant {
  id: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  plan: string;
  createdAt: Date;
  updatedAt: Date;
  onboardingCompleted: number;
}

export interface ticketMessageReceipts {
  messageId: string;
  clientId: string;
  deliveredAt: Date;
}

export interface ticketMessages {
  id: string;
  ticketId: string;
  message: string;
  attachments: string;
  isInternal: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ticketSupportGroups {
  id: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt: Date;
  updatedAt: Date;
  groupId: string;
}

export interface ticketTags {
  id: string;
  ticketId: string;
  tagId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface tickets {
  id: string;
  organizationId: string;
  clientId: string;
  title: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  ticketKey: string;
  lastMessageAt: Date;
}

export interface tierPricingClients {
  id: string;
  tierPricingId: string;
  clientId: string;
  createdAt: Date;
}

export interface tierPricingProducts {
  id: string;
  tierPricingId: string;
  productId: string;
  variationId: string;
  createdAt: Date;
}

export interface tierPricingSteps {
  id: string;
  tierPricingId: string;
  fromUnits: number;
  toUnits: number;
  price: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface tierPricings {
  id: string;
  organizationId: string;
  name: string;
  countries: unknown;
  createdAt: Date;
  updatedAt: Date;
  active: boolean;
}

export interface user {
  id: string;
  email: string;
  name: string;
  phone: string;
  country: string;
  is_guest: boolean;
  emailVerified: boolean;
  image: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface userFeeRates {
  id: string;
  userId: string;
  percent: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
}

export interface userInvoices {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  totalAmount: string;
  status: string;
  dueDate: Date;
  createdAt: Date;
  niftipayOrderId: string;
  niftipayReference: string;
  niftipayNetwork: string;
  niftipayAsset: string;
  niftipayAddress: string;
  niftipayQrUrl: string;
  paidAmount: string;
}

export interface verification {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface warehouse {
  id: string;
  tenantId: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface warehouseShareLink {
  id: string;
  warehouseId: string;
  creatorUserId: string;
  token: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface warehouseShareRecipient {
  id: string;
  shareLinkId: string;
  recipientUserId: string;
  createdAt: Date;
  updatedAt: Date;
  targetWarehouseId: string;
}

export interface warehouseStock {
  id: string;
  warehouseId: string;
  productId: string;
  variationId: string;
  country: string;
  quantity: number;
  organizationId: string;
  tenantId: string;
  createdAt: Date;
  updatedAt: Date;
  affiliateProductId: string;
  affiliateVariationId: string;
}

export interface DB {
  "account": account;
  "affiliateGroupMembers": affiliateGroupMembers;
  "affiliateGroups": affiliateGroups;
  "affiliateLevels": affiliateLevels;
  "affiliatePointBalances": affiliatePointBalances;
  "affiliatePointLogs": affiliatePointLogs;
  "affiliateProductVariations": affiliateProductVariations;
  "affiliateProducts": affiliateProducts;
  "affiliateSettings": affiliateSettings;
  "announcements": announcements;
  "apikey": apikey;
  "automationRuleLocks": automationRuleLocks;
  "automationRules": automationRules;
  "cartProducts": cartProducts;
  "carts": carts;
  "categoryRevenue": categoryRevenue;
  "clientAddresses": clientAddresses;
  "clientSecretPhrase": clientSecretPhrase;
  "clients": clients;
  "coupons": coupons;
  "creditExternalIdentities": creditExternalIdentities;
  "creditHolds": creditHolds;
  "creditLedgerEntries": creditLedgerEntries;
  "creditSyncCodes": creditSyncCodes;
  "creditWallets": creditWallets;
  "exchangeRate": exchangeRate;
  "idempotency": idempotency;
  "inAppNotifications": inAppNotifications;
  "inventoryCount": inventoryCount;
  "inventoryCountItems": inventoryCountItems;
  "invitation": invitation;
  "invoiceItems": invoiceItems;
  "member": member;
  "notificationGroups": notificationGroups;
  "notificationOutbox": notificationOutbox;
  "notificationTemplates": notificationTemplates;
  "notifications": notifications;
  "orderFees": orderFees;
  "orderMessageReceipts": orderMessageReceipts;
  "orderMessages": orderMessages;
  "orderNotes": orderNotes;
  "orderPayments": orderPayments;
  "orderRevenue": orderRevenue;
  "orders": orders;
  "orgRole": orgRole;
  "orgSecretCode": orgSecretCode;
  "organization": organization;
  "organizationPlatformKey": organizationPlatformKey;
  "organizationSupportEmail": organizationSupportEmail;
  "paymentMethods": paymentMethods;
  "placeholders": placeholders;
  "posIdempotency": posIdempotency;
  "posReceiptTemplates": posReceiptTemplates;
  "productAttributeTerms": productAttributeTerms;
  "productAttributeValues": productAttributeValues;
  "productAttributes": productAttributes;
  "productCategories": productCategories;
  "productCategory": productCategory;
  "productTaxRules": productTaxRules;
  "productVariations": productVariations;
  "products": products;
  "rateLimit": rateLimit;
  "registers": registers;
  "reviews": reviews;
  "sections": sections;
  "session": session;
  "sharedProduct": sharedProduct;
  "sharedProductMapping": sharedProductMapping;
  "sharedVariationMapping": sharedVariationMapping;
  "shipments": shipments;
  "shippingMethods": shippingMethods;
  "stores": stores;
  "subscription": subscription;
  "supplierCart": supplierCart;
  "supplierCartProducts": supplierCartProducts;
  "supplierOrders": supplierOrders;
  "suppliers": suppliers;
  "tags": tags;
  "taxRules": taxRules;
  "team": team;
  "telegramDedup": telegramDedup;
  "tenant": tenant;
  "ticketMessageReceipts": ticketMessageReceipts;
  "ticketMessages": ticketMessages;
  "ticketSupportGroups": ticketSupportGroups;
  "ticketTags": ticketTags;
  "tickets": tickets;
  "tierPricingClients": tierPricingClients;
  "tierPricingProducts": tierPricingProducts;
  "tierPricingSteps": tierPricingSteps;
  "tierPricings": tierPricings;
  "user": user;
  "userFeeRates": userFeeRates;
  "userInvoices": userInvoices;
  "verification": verification;
  "warehouse": warehouse;
  "warehouseShareLink": warehouseShareLink;
  "warehouseShareRecipient": warehouseShareRecipient;
  "warehouseStock": warehouseStock;
}