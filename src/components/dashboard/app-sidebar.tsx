// /src/components/app-sidebar.tsx
"use client";

import * as React from "react";
import {
  IconCamera,
  IconChartBar,
  IconDashboard,
  IconDatabase,
  IconFileAi,
  IconFileDescription,
  IconFileWord,
  IconFolder,
  IconHelp,
  IconInnerShadowTop,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconUsers,
  IconBoxMultiple,
  IconBolt,
  IconCreditCardPay,
  IconPackageImport,
  IconBuildingStore,
} from "@tabler/icons-react";

import { NavOrganizations } from "@/components/dashboard/nav-organizations";
import { NavUnified, NavItem } from "@/components/dashboard/nav-main"; // New unified nav component
import { NavUser } from "@/components/dashboard/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const data = {
  user: {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: IconDashboard,
    },
    {
      title: "Shops",
      url: "/organizations/",
      icon: IconBuildingStore,
    },
    {
      title: "Inventory",
      url: "/products",
      icon: IconListDetails,
      items: [
        { title: "View all products", url: "/products" },
        { title: "Add new product", url: "/products/new" },
        { title: "Product categories", url: "/product-categories" },
        { title: "Product attributes", url: "/product-attributes" },
        { title: "Tier pricing", url: "/discount-rules" },
        { title: "Stock management", url: "/products/stock-management" },
        { title: "Inventory count", url: "/inventory" },
        { title: "Suppliers", url: "/suppliers" },
        { title: "Warehouses", url: "/warehouses" },
      ],
    },
    {
      title: "Clients",
      url: "/clients",
      icon: IconUsers,
      items: [
        { title: "Manage", url: "/clients" },
        { title: "Customer support", url: "/tickets" },
      ],
    },
    {
      title: "Marketing",
      url: "#",
      icon: IconBolt,
      items: [
        { title: "Announcements", url: "/announcements" },
        { title: "Affiliates", url: "/affiliates" },
        { title: "Coupons", url: "/coupons" },
        { title: "Magic Rules", url: "/magic-rules" },
      ],
    },
    {
      title: "Orders",
      url: "/orders",
      icon: IconReport,
      items: [
        { title: "New order", url: "/orders/create" },
        { title: "View orders", url: "/orders" },
        { title: "View reviews", url: "/reviews/" },
      ],
    },
    {
      title: "Analytics",
      url: "#",
      icon: IconChartBar,
      items: [
        { title: "Revenue", url: "/analytics/revenue" },
        { title: "Categories", url: "/analytics/category-revenue" },
        { title: "Coupons", url: "/analytics/coupons/" },
        { title: "Products", url: "/analytics/products/" },
        { title: "Dropshipping suppliers", url: "/analytics/dropshipping-suppliers/" }
      ],
    },
    {
      title: "Sections",
      url: "/sections",
      icon: IconBoxMultiple,
    },
    {
      title: "Shipping",
      url: "/shipping-companies",
      icon: IconPackageImport,
      items: [
        { title: "View shipping methods", url: "/shipments" },
        { title: "View shipping companies", url: "/shipping-companies" },
      ],
    },
    {
      title: "Payment methods",
      url: "/payment-methods",
      icon: IconCreditCardPay,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "#",
      icon: IconSettings,
    },
    {
      title: "Get Help",
      url: "#",
      icon: IconHelp,
    },
    {
      title: "Search",
      url: "#",
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: "Data Library",
      url: "#",
      icon: IconDatabase,
    },
    {
      name: "Reports",
      url: "#",
      icon: IconReport,
    },
    {
      name: "Word Assistant",
      url: "#",
      icon: IconFileWord,
    },
  ],
};

// Combine navMain and navClouds in the desired order
const unifiedNav: NavItem[] = [...data.navMain];

const organizationsData = [
  { id: 1, name: "Acme Inc", avatar: "/images/org-acme.png" },
  { id: 2, name: "Beta Corp", avatar: "/images/org-beta.png" },
  { id: 3, name: "Gamma LLC" }, // No avatar provided => fallback to initials
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
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
        {/* Use unified navigation */}
        <NavUnified items={unifiedNav} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
