// AUTO-GENERATED FROM DB.txt

export interface DB {
  "public.account": AccountRow;
  "public.affiliateGroupMembers": AffiliateGroupMembersRow;
  "public.affiliateGroups": AffiliateGroupsRow;
  "public.affiliateLevels": AffiliateLevelsRow;
  "public.affiliatePointBalances": AffiliatePointBalancesRow;
  "public.affiliatePointLogs": AffiliatePointLogsRow;
  "public.affiliateProductVariations": AffiliateProductVariationsRow;
  "public.affiliateProducts": AffiliateProductsRow;
  "public.affiliateSettings": AffiliateSettingsRow;
  "public.announcements": AnnouncementsRow;
  "public.apikey": ApikeyRow;
  "public.automationRuleLocks": AutomationRuleLocksRow;
  "public.automationRules": AutomationRulesRow;
  "public.cartProducts": CartProductsRow;
  "public.carts": CartsRow;
  "public.categoryRevenue": CategoryRevenueRow;
  "public.clientAddresses": ClientAddressesRow;
  "public.clientSecretPhrase": ClientSecretPhraseRow;
  "public.clients": ClientsRow;
  "public.coupons": CouponsRow;
  "public.creditExternalIdentities": CreditExternalIdentitiesRow;
  "public.creditHolds": CreditHoldsRow;
  "public.creditLedgerEntries": CreditLedgerEntriesRow;
  "public.creditSyncCodes": CreditSyncCodesRow;
  "public.creditWallets": CreditWalletsRow;
  "public.exchangeRate": ExchangeRateRow;
  "public.idempotency": IdempotencyRow;
  "public.inAppNotifications": InAppNotificationsRow;
  "public.inventoryCount": InventoryCountRow;
  "public.inventoryCountItems": InventoryCountItemsRow;
  "public.invitation": InvitationRow;
  "public.invoiceItems": InvoiceItemsRow;
  "public.member": MemberRow;
  "public.notificationGroups": NotificationGroupsRow;
  "public.notificationOutbox": NotificationOutboxRow;
  "public.notificationTemplates": NotificationTemplatesRow;
  "public.notifications": NotificationsRow;
  "public.orderFees": OrderFeesRow;
  "public.orderMessageReceipts": OrderMessageReceiptsRow;
  "public.orderMessages": OrderMessagesRow;
  "public.orderNotes": OrderNotesRow;
  "public.orderPayments": OrderPaymentsRow;
  "public.orderRevenue": OrderRevenueRow;
  "public.orders": OrdersRow;
  "public.orgRole": OrgRoleRow;
  "public.orgSecretCode": OrgSecretCodeRow;
  "public.organization": OrganizationRow;
  "public.organizationPlatformKey": OrganizationPlatformKeyRow;
  "public.organizationSupportEmail": OrganizationSupportEmailRow;
  "public.paymentMethods": PaymentMethodsRow;
  "public.placeholders": PlaceholdersRow;
  "public.posIdempotency": PosIdempotencyRow;
  "public.posReceiptTemplates": PosReceiptTemplatesRow;
  "public.productAttributeTerms": ProductAttributeTermsRow;
  "public.productAttributeValues": ProductAttributeValuesRow;
  "public.productAttributes": ProductAttributesRow;
  "public.productCategories": ProductCategoriesRow;
  "public.productCategory": ProductCategoryRow;
  "public.productTaxRules": ProductTaxRulesRow;
  "public.productVariations": ProductVariationsRow;
  "public.products": ProductsRow;
  "public.rateLimit": RateLimitRow;
  "public.registers": RegistersRow;
  "public.reviews": ReviewsRow;
  "public.sections": SectionsRow;
  "public.session": SessionRow;
  "public.sharedProduct": SharedProductRow;
  "public.sharedProductMapping": SharedProductMappingRow;
  "public.sharedVariationMapping": SharedVariationMappingRow;
  "public.shipments": ShipmentsRow;
  "public.shippingMethods": ShippingMethodsRow;
  "public.stores": StoresRow;
  "public.subscription": SubscriptionRow;
  "public.supplierCart": SupplierCartRow;
  "public.supplierCartProducts": SupplierCartProductsRow;
  "public.supplierOrders": SupplierOrdersRow;
  "public.suppliers": SuppliersRow;
  "public.tags": TagsRow;
  "public.taxRules": TaxRulesRow;
  "public.team": TeamRow;
  "public.telegramDedup": TelegramDedupRow;
  "public.tenant": TenantRow;
  "public.ticketMessageReceipts": TicketMessageReceiptsRow;
  "public.ticketMessages": TicketMessagesRow;
  "public.ticketSupportGroups": TicketSupportGroupsRow;
  "public.ticketTags": TicketTagsRow;
  "public.tickets": TicketsRow;
  "public.tierPricingClients": TierPricingClientsRow;
  "public.tierPricingProducts": TierPricingProductsRow;
  "public.tierPricingSteps": TierPricingStepsRow;
  "public.tierPricings": TierPricingsRow;
  "public.user": UserRow;
  "public.userFeeRates": UserFeeRatesRow;
  "public.userInvoices": UserInvoicesRow;
  "public.verification": VerificationRow;
  "public.warehouse": WarehouseRow;
  "public.warehouseShareLink": WarehouseShareLinkRow;
  "public.warehouseShareRecipient": WarehouseShareRecipientRow;
  "public.warehouseStock": WarehouseStockRow;
}

// -------- TABLE INTERFACES --------

export interface AccountRow {
  id: string;
  userId: string;
  accountId?: string;
  providerId?: string;
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  scope?: string;
  idToken?: string;
  password?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AffiliateGroupMembersRow {
  id: string;
  organizationId: string;
  affiliateGroupId: string;
  groupId: string;
  userId: string;
  clientId: string;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateGroupsRow {
  id: string;
  organizationId: string;
  groupId: string;
  points: number;
  platform: string;
  createdAt: string;
  updatedAt: string;
  groupName?: string;
}

export interface AffiliateLevelsRow {
  id: string;
  organizationId: string;
  name: string;
  image?: string;
  levelUpMessage?: string;
  levelUpMessageGroup?: string;
  requiredPoints: number;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliatePointBalancesRow {
  clientId: string;
  organizationId: string;
  pointsCurrent: number;
  pointsSpent: number;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliatePointLogsRow {
  id: string;
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description?: string;
  sourceClientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AffiliateProductVariationsRow {
  id: string;
  productId: string;
  attributes: any;
  sku: string;
  regularPoints: any;
  salePoints?: any;
  cost: any;
  image?: string;
  stock?: any;
  createdAt: string;
  updatedAt: string;
  minLevelId?: string;
}

export interface AffiliateProductsRow {
  id: string;
  organizationId: string;
  tenantId: string;
  title: string;
  description?: string;
  image?: string;
  sku: string;
  status: string;
  productType: string;
  regularPoints: any;
  salePoints?: any;
  cost: any;
  allowBackorders: boolean;
  manageStock: boolean;
  stockStatus: string;
  createdAt: string;
  updatedAt: string;
  minLevelId?: string;
}

export interface AffiliateSettingsRow {
  organizationId: string;
  pointsPerReferral: number;
  pointsPerReview: number;
  spendingNeeded: string;
  pointsPerSpending: number;
  createdAt: string;
  updatedAt: string;
  monetaryValuePerPoint: string;
}

export interface AnnouncementsRow {
  id: string;
  organizationId: string;
  title: string;
  content: string;
  deliveryDate?: string;
  countries: string;
  sent: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ApikeyRow {
  id: string;
  name?: string;
  start?: string;
  prefix?: string;
  key: string;
  userId: string;
  refillInterval?: number;
  refillAmount?: number;
  lastRefillAt?: string;
  enabled?: boolean;
  rateLimitEnabled?: boolean;
  rateLimitTimeWindow?: number;
  rateLimitMax?: number;
  requestCount?: number;
  remaining?: number;
  lastRequest?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  permissions?: string;
  metadata?: string;
}

export interface AutomationRuleLocksRow {
  id: string;
  organizationId: string;
  ruleId: string;
  event: string;
  clientId?: string;
  orderId?: string;
  dedupeKey: string;
  createdAt: string;
}

export interface AutomationRulesRow {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority: number;
  event: string;
  countries: string;
  action: string;
  channels: string;
  payload: any;
  createdAt: string;
  updatedAt: string;
}

export interface CartProductsRow {
  id: string;
  cartId: string;
  productId?: string;
  quantity: number;
  unitPrice: string;
  createdAt: string;
  updatedAt: string;
  affiliateProductId?: string;
  variationId?: string;
}

export interface CartsRow {
  id: string;
  clientId: string;
  country: string;
  couponCode?: string;
  shippingMethod?: string;
  cartHash: string;
  cartUpdatedHash: string;
  status: boolean;
  createdAt: string;
  updatedAt: string;
  organizationId?: string;
  channel?: string;
}

export interface CategoryRevenueRow {
  id: string;
  categoryId: string;
  USDtotal?: string;
  USDcost?: string;
  GBPtotal?: string;
  GBPcost?: string;
  EURtotal?: string;
  EURcost?: string;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClientAddressesRow {
  id: string;
  clientId: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientSecretPhraseRow {
  id: string;
  clientId: string;
  phrase: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClientsRow {
  id: string;
  userId?: string;
  organizationId: string;
  username: string;
  firstName: string;
  lastName: string;
  lastInteraction: string;
  email?: string;
  phoneNumber?: string;
  country?: string;
  levelId?: string;
  referredBy?: string;
  createdAt?: string;
  updatedAt?: string;
  secretPhraseEnabled: boolean;
  secretPhraseReverifyDays: number;
  secretPhraseForceAt?: string;
}

export interface CouponsRow {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description?: string;
  discountType: string;
  discountAmount: string;
  startDate: string;
  expirationDate?: string;
  limitPerUser: number;
  usagePerUser: number;
  usageLimit: number;
  expendingMinimum: string;
  expendingLimit: string;
  countries: string;
  visibility: boolean;
  createdAt: string;
  updatedAt: string;
  stackable?: boolean;
}

export interface CreditExternalIdentitiesRow {
  id: string;
  organizationId: string;
  userId: string;
  provider: string;
  providerUserId: string;
  email?: string;
  createdAt: string;
}

export interface CreditHoldsRow {
  id: string;
  organizationId: string;
  walletId: string;
  provider: string;
  orderId: string;
  amountMinor: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreditLedgerEntriesRow {
  id: string;
  organizationId: string;
  walletId: string;
  direction: string;
  amountMinor: string;
  reason: string;
  reference?: any;
  idempotencyKey: string;
  createdAt: string;
}

export interface CreditSyncCodesRow {
  code: string;
  organizationId: string;
  provider: string;
  providerUserId: string;
  email?: string;
  status: string;
  userId?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreditWalletsRow {
  id: string;
  organizationId: string;
  userId: string;
  currency: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeRateRow {
  EUR: string;
  GBP: string;
  date?: string;
}

export interface IdempotencyRow {
  key: string;
  method: string;
  path: string;
  status?: number;
  response?: any;
  createdAt: string;
  updatedAt?: string;
}

export interface InAppNotificationsRow {
  id: string;
  organizationId: string;
  userId?: string;
  clientId?: string;
  title: string;
  message: string;
  country?: string;
  read: boolean;
  createdAt: string;
  updatedAt: string;
  url?: string;
}

export interface InventoryCountRow {
  id: string;
  createdAt: string;
  reference: string;
  warehouseId: string;
  countType: string;
  organizationId: string;
  userId: string;
  countries: string;
  isCompleted: boolean;
  updatedAt: string;
}

export interface InventoryCountItemsRow {
  id: string;
  inventoryCountId: string;
  productId: string;
  variationId?: string;
  country: string;
  expectedQuantity: string;
  countedQuantity?: string;
  discrepancyReason?: string;
  isCounted: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface InvitationRow {
  id: string;
  email: string;
  inviterId: string;
  organizationId: string;
  role: string;
  status: string;
  expiresAt: string;
  createdAt?: string;
}

export interface InvoiceItemsRow {
  id: string;
  invoiceId: string;
  orderFeeId: string;
  amount: string;
}

export interface MemberRow {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt?: string;
}

export interface NotificationGroupsRow {
  id: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt: string;
  updatedAt: string;
  groupId: string;
}

export interface NotificationOutboxRow {
  id: string;
  organizationId: string;
  orderId?: string;
  type: string;
  trigger?: string;
  channel: "email" | "in_app" | "webhook" | "telegram" | string;
  payload: any;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  status: "pending" | "sent" | "dead" | string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationTemplatesRow {
  id: string;
  organizationId: string;
  type: string;
  role: "admin" | "user" | string;
  countries?: string;
  subject?: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsRow {
  id: string;
  organizationId: string;
  type: string;
  trigger?: string;
  message: string;
  channels: string;
  country?: string;
  targetUserId?: string;
  targetClientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderFeesRow {
  id: string;
  orderId: string;
  userId: string;
  feeAmount: string;
  percentApplied: string;
  capturedAt: string;
}

export interface OrderMessageReceiptsRow {
  messageId: string;
  clientId: string;
  deliveredAt: string;
}

export interface OrderMessagesRow {
  id: string;
  orderId: string;
  clientId: string;
  isInternal: boolean;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderNotesRow {
  id: string;
  organizationId: string;
  orderId: string;
  authorRole: "client" | "staff" | string;
  authorClientId?: string;
  authorUserId?: string;
  note: string;
  visibleToCustomer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPaymentsRow {
  id: string;
  orderId: string;
  methodId: string;
  amount: string;
  createdAt: string;
}

export interface OrderRevenueRow {
  id: string;
  orderId: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  USDtotal?: string;
  USDdiscount?: string;
  USDshipping?: string;
  USDcost?: string;
  GBPtotal?: string;
  GBPdiscount?: string;
  GBPshipping?: string;
  GBPcost?: string;
  EURtotal?: string;
  EURdiscount?: string;
  EURshipping?: string;
  EURcost?: string;
  cancelled?: boolean;
  refunded?: boolean;
}

export interface OrdersRow {
  id: string;
  organizationId: string;
  clientId: string;
  cartId: string;
  country: string;
  status: string;
  paymentMethod: string;
  orderKey?: string;
  cartHash: string;
  shippingMethod?: string;
  shippingTotal: string;
  discountTotal: string;
  counponType?: string;
  totalAmount: string;
  couponCode?: string;
  shippingService?: string;
  address?: string;
  dateCreated: string;
  datePaid?: string;
  dateCompleted?: string;
  dateCancelled?: string;
  createdAt: string;
  updatedAt: string;
  subtotal: string;
  couponType?: string;
  trackingNumber?: string;
  pointsRedeemed: number;
  pointsRedeemedAmount: string;
  notifiedPaidOrCompleted: boolean;
  orderMeta: any;
  dateUnderpaid?: string;
  referralAwarded: boolean;
  discountValue?: string[]; // text[]
  orderChannel?: "web" | "pos" | string;
  channel: string; // default 'web'
}

export interface OrgRoleRow {
  id: string;
  organizationId: string;
  name: string;
  permissions: any;
  createdAt: string;
  updatedAt?: string;
}

export interface OrgSecretCodeRow {
  id: string;
  organizationId: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: string;
  verifiedAt?: string;
  consumedAt?: string;
  ticketId?: string;
  createdAt: string;
}

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  metadata?: string;
  countries: string;
  encryptedSecret?: string;
  createdAt?: string;
  updatedAt?: string;
  secretPhraseEnabled: boolean;
}

export interface OrganizationPlatformKeyRow {
  id: string;
  organizationId: string;
  platform: string;
  apiKey: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface OrganizationSupportEmailRow {
  id: string;
  organizationId: string;
  country?: string;
  isGlobal: boolean;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentMethodsRow {
  id: string;
  name: string;
  tenantId: string;
  apiKey?: string;
  secretKey?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  description?: string;
  instructions?: string;
  default: boolean;
  posVisible: boolean;
}

export interface PlaceholdersRow {
  key: string;
  description: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface PosIdempotencyRow {
  id: string;
  organizationId: string;
  key: string;
  orderId: string;
  createdAt: string;
}

export interface PosReceiptTemplatesRow {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  printFormat: string;
  options: any;
  createdAt: string;
  updatedAt: string;
  defaultReceiptTemplateId?: never; // handled in stores
}

export interface ProductAttributeTermsRow {
  id: string;
  attributeId: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductAttributeValuesRow {
  productId: string;
  attributeId: string;
  termId: string;
}

export interface ProductAttributesRow {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductCategoriesRow {
  id: string;
  name: string;
  slug: string;
  image?: string;
  order: number;
  organizationId: string;
  parentId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductCategoryRow {
  productId: string;
  categoryId: string;
}

export interface ProductTaxRulesRow {
  productId: string;
  taxRuleId: string;
}

export interface ProductVariationsRow {
  id: string;
  productId: string;
  attributes: any;
  sku: string;
  regularPrice: any;
  salePrice?: any;
  cost: any;
  image?: string;
  stock?: any;
  createdAt: string;
  updatedAt: string;
}

export interface ProductsRow {
  id: string;
  organizationId: string;
  tenantId: string;
  title: string;
  description?: string;
  image?: string;
  sku: string;
  status: "published" | "draft" | string;
  productType: "simple" | "variable" | string;
  regularPrice: any;
  salePrice?: any;
  cost: any;
  allowBackorders: boolean;
  manageStock: boolean;
  stockStatus: "managed" | "unmanaged" | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RateLimitRow {
  id: string;
  key: string;
  count: number;
  lastRequest: string;
}

export interface RegistersRow {
  id: string;
  organizationId: string;
  storeId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  displayActive?: boolean;
  displayDevice?: string;
  displayAccessKey?: string;
  displayPairCode?: string;
  displayPairCodeExpiresAt?: string;
  displayPairedAt?: string;
  displaySlides?: any;
  displaySessionId?: string;
}

export interface ReviewsRow {
  id: string;
  orderId?: string;
  organizationId: string;
  text: string;
  rate: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SectionsRow {
  id: string;
  organizationId: string;
  parentSectionId?: string;
  name: string;
  title: string;
  content: string;
  videoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  token: string;
  expiresAt?: string;
  ipAddress?: string;
  userAgent?: string;
  activeOrganizationId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SharedProductRow {
  id: string;
  shareLinkId: string;
  productId: string;
  variationId?: string;
  cost: any;
  createdAt?: string;
  updatedAt?: string;
}

export interface SharedProductMappingRow {
  id: string;
  shareLinkId: string;
  sourceProductId: string;
  targetProductId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SharedVariationMappingRow {
  id: string;
  shareLinkId: string;
  sourceProductId: string;
  targetProductId: string;
  sourceVariationId: string;
  targetVariationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShipmentsRow {
  id: string;
  organizationId: string;
  countries: string;
  title: string;
  description: string;
  costs: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ShippingMethodsRow {
  id: string;
  organizationId: string;
  name: string;
  url: string;
  countries: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StoresRow {
  id: string;
  organizationId: string;
  name: string;
  address: string;
  phone?: string;
  timezone?: string;
  taxRegistration?: string;
  createdAt: string;
  updatedAt: string;
  defaultReceiptTemplateId?: string;
}

export interface SubscriptionRow {
  id: string;
  userId: string;
  plan?: string;
  status?: string;
  trialStart?: string;
  trialEnd?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface SupplierCartRow {
  id: string;
  supplierId: string;
  organizationId: string;
  status: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierCartProductsRow {
  id: string;
  supplierCartId: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  cost: string;
  country: string;
  createdAt: string;
  updatedAt: string;
  received?: string;
  variationId?: string;
}

export interface SupplierOrdersRow {
  id: string;
  supplierId: string;
  organizationId: string;
  supplierCartId: string;
  note?: string;
  status: string;
  expectedAt?: string;
  createdAt: string;
  updatedAt: string;
  orderKey: string;
}

export interface SuppliersRow {
  id: string;
  code: string;
  name: string;
  email: string;
  phone?: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TagsRow {
  id: string;
  description?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface TaxRulesRow {
  id: string;
  organizationId: string;
  name: string;
  rate: string;
  inclusive: boolean;
  region?: string;
  country?: string;
  state?: string;
  city?: string;
  postcode?: string;
  priority: number;
  compound: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRow {
  id: string;
  name: string;
  organizationId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TelegramDedupRow {
  chatId: string;
  textHash: string;
  createdAt: string;
}

export interface TenantRow {
  id: string;
  ownerUserId: string;
  ownerName?: string;
  ownerEmail?: string;
  plan?: string;
  createdAt?: string;
  updatedAt?: string;
  onboardingCompleted?: number;
}

export interface TicketMessageReceiptsRow {
  messageId: string;
  clientId: string;
  deliveredAt: string;
}

export interface TicketMessagesRow {
  id: string;
  ticketId: string;
  message: string;
  attachments?: string;
  isInternal: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TicketSupportGroupsRow {
  id: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt: string;
  updatedAt: string;
  groupId: string;
}

export interface TicketTagsRow {
  id: string;
  ticketId: string;
  tagId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TicketsRow {
  id: string;
  organizationId: string;
  clientId: string;
  title: string;
  status: string;
  priority: string;
  createdAt?: string;
  updatedAt?: string;
  ticketKey: string;
  lastMessageAt?: string;
}

export interface TierPricingClientsRow {
  id: string;
  tierPricingId: string;
  clientId: string;
  createdAt: string;
}

export interface TierPricingProductsRow {
  id: string;
  tierPricingId: string;
  productId?: string;
  variationId?: string;
  createdAt: string;
}

export interface TierPricingStepsRow {
  id: string;
  tierPricingId: string;
  fromUnits: number;
  toUnits: number;
  price: string;
  createdAt: string;
  updatedAt: string;
}

export interface TierPricingsRow {
  id: string;
  organizationId: string;
  name: string;
  countries: any; // jsonb
  createdAt: string;
  updatedAt: string;
  active?: boolean;
}

export interface UserRow {
  id: string;
  email: string;
  name?: string;
  phone?: string;
  country?: string;
  is_guest?: boolean;
  emailVerified?: boolean;
  image?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface UserFeeRatesRow {
  id: string;
  userId: string;
  percent: string;
  startsAt: string;
  endsAt?: string;
  createdAt: string;
}

export interface UserInvoicesRow {
  id: string;
  userId: string;
  periodStart: string; // date
  periodEnd: string;   // date
  totalAmount: string;
  status: string;
  dueDate: string;     // date
  createdAt: string;
  niftipayOrderId?: string;
  niftipayReference?: string;
  niftipayNetwork: string;
  niftipayAsset: string;
  niftipayAddress?: string;
  niftipayQrUrl?: string;
  paidAmount: string;
}

export interface VerificationRow {
  id: string;
  identifier: string;
  value: string;
  expiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WarehouseRow {
  id: string;
  tenantId: string;
  organizationId: string;
  name: string;
  countries: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WarehouseShareLinkRow {
  id: string;
  warehouseId: string;
  creatorUserId: string;
  token: string;
  status: "active" | "revoked" | string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WarehouseShareRecipientRow {
  id: string;
  shareLinkId: string;
  recipientUserId: string;
  createdAt?: string;
  updatedAt?: string;
  targetWarehouseId?: string;
}

export interface WarehouseStockRow {
  id: string;
  warehouseId: string;
  productId?: string;
  variationId?: string;
  country: string;
  quantity: number;
  organizationId: string;
  tenantId: string;
  createdAt?: string;
  updatedAt?: string;
  affiliateProductId?: string;
  affiliateVariationId?: string;
}
