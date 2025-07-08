/*───────────────────────────────────────────────────────────────────
  src/components/dashboard/app-sidebar.tsx          — FULL REPLACEMENT
───────────────────────────────────────────────────────────────────*/
"use client";

import * as React from "react";
import {
  IconChartBar,
  IconDashboard,
  IconListDetails,
  IconReport,
  IconSettings,
  IconHelp,
  IconSearch,
  IconUsers,
  IconBoxMultiple,
  IconBolt,
  IconCreditCardPay,
  IconPackageImport,
  IconBuildingStore,
} from "@tabler/icons-react";

import { NavOrganizations } from "@/components/dashboard/nav-organizations";
import { NavUnified, NavItem } from "@/components/dashboard/nav-main";
import { NavUser } from "@/components/dashboard/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

/* ------------------------------------------------------------------ */
/*  MENU DEFINITION – add `resource` (Better-Auth permission key)     */
/* ------------------------------------------------------------------ */
const navMain: NavItem[] = [
  { title: "Dashboard",      url: "/dashboard",             icon: IconDashboard },
  { title: "Shops",          url: "/organizations/",        icon: IconBuildingStore, resource: "organization" },
  {
    title: "Inventory",
    url: "/products",
    icon: IconListDetails,
    resource: "product",
    items: [
      { title: "View all",             url: "/products" },
      { title: "Add new product",      url: "/products/new" },
      { title: "Product categories",   url: "/product-categories" },
      { title: "Product attributes",   url: "/product-attributes" },
      { title: "Stock management",     url: "/products/stock-management" },
      { title: "Tier pricing",         url: "/discount-rules" },
      { title: "Warehouses",           url: "/warehouses" },
    ],
  },
  {
    title: "Clients",
    url: "/clients",
    icon: IconUsers,
    resource: "customer",
    items: [
      { title: "Manage",            url: "/clients" },
      { title: "Customer support",  url: "/tickets" },
    ],
  },
  {
    title: "Marketing",
    url: "#",
    icon: IconBolt,
    resource: "affiliates",
    items: [
      { title: "Affiliates",   url: "/affiliates" },
      { title: "Coupons",      url: "/coupons" },
      { title: "Announcements",url: "/announcements" },
    ],
  },
  {
    title: "Orders",
    url: "/orders",
    icon: IconReport,
    resource: "order",
    items: [
      { title: "Create orders", url: "/orders/create" },
      { title: "View orders",   url: "/orders" },
      { title: "View reviews",  url: "/reviews/" },
    ],
  },
  {
    title: "Analytics",
    url: "#",
    icon: IconChartBar,
    resource: "revenue",
    items: [
      { title: "Revenue",    url: "/analytics/revenue" },
      { title: "Categories", url: "/analytics/category-revenue" },
      { title: "Coupons",    url: "/analytics/coupons/" },
      { title: "Products",   url: "/analytics/products/" },
    ],
  },
  { title: "Sections",         url: "/sections",            icon: IconBoxMultiple,   resource: "sections" },
  {
    title: "Shipping",
    url: "/shipping-companies",
    icon: IconPackageImport,
    resource: "shippingMethods",
    items: [
      { title: "View shipping methods",   url: "/shipments" },
      { title: "View shipping companies", url: "/shipping-companies" },
    ],
  },
  { title: "Payment methods",  url: "/payment-methods",     icon: IconCreditCardPay, resource: "payment" },
];

/* Secondary nav stays visible to everyone */
const navSecondary = [
  { title: "Settings", url: "#", icon: IconSettings },
  { title: "Get Help", url: "#", icon: IconHelp    },
  { title: "Search",   url: "#", icon: IconSearch  },
];

const userFake = { name: "shadcn", email: "m@example.com", avatar: "/avatars/shadcn.jpg" };
const organizationsData = [
  { id: 1, name: "Acme Inc",  avatar: "/images/org-acme.png" },
  { id: 2, name: "Beta Corp", avatar: "/images/org-beta.png" },
  { id: 3, name: "Gamma LLC" },
];

/* ------------------------------------------------------------------ */
/*  HOOK: filter nav by permissions                                   */
/* ------------------------------------------------------------------ */
function useFilteredNav(items: NavItem[]): NavItem[] {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* gather distinct resources that need "view" */
  const resources = React.useMemo(
    () =>
      Array.from(
        new Set(
          items
            .map((i) => i.resource)
            .filter(Boolean) as string[],
        ),
      ),
    [items],
  );

  /* ask server once for ALL resources */
  const permsObj = React.useMemo(() => {
    const obj: Record<string, string[]> = {};
    resources.forEach((r) => (obj[r] = ["view"]));
    return obj;
  }, [resources]);

  const { hasPermission, isLoading } = useHasPermission(orgId, permsObj);

  /* while loading, optimistically hide nothing to avoid flash of missing items */
  if (isLoading || orgId === null) return items;

  return items.filter((item) => {
    if (!item.resource) return true; // public
    return hasPermission?.[item.resource] ?? false;
  });
}

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                         */
/* ------------------------------------------------------------------ */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const filteredNav = useFilteredNav(navMain);

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <NavOrganizations organizations={organizationsData} />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavUnified items={filteredNav} />     {/* << only permitted items */}
      </SidebarContent>

      <SidebarFooter>
        <NavUser user={userFake} />
      </SidebarFooter>
    </Sidebar>
  );
}
