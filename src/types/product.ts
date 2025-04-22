export interface Product {
  id: string;
  title: string;
  description?: string | null;
  image?: string | null;
  sku: string;
  status: "published" | "draft";
  productType: "simple" | "variable";
  regularPrice: Record<string, number>;
  salePrice:    Record<string, number> | null;
  /** NEW */
  cost:         Record<string, number>;
  allowBackorders: boolean;
  manageStock: boolean;
  stockStatus: "managed" | "unmanaged";
  stockData?: Record<string, Record<string, number>> | null;
  categories?: string[];
  attributes?: Attribute[];
  variations?: Variation[];
  createdAt: string;
  updatedAt: string;
}

export interface Attribute {
  id: string;
  name: string;
  terms: Array<{ id: string; name: string }>;
  useForVariations: boolean;
  selectedTerms: string[];
}

export interface Variation {
  id: string;
  attributes: Record<string, string>;
  sku: string;
  image: string | null
  regularPrice: Record<string, number>;
  salePrice:    Record<string, number> | null;
  /** NEW */
  cost:         Record<string, number>;
  stock?: Record<string, Record<string, number>>;
}

export interface Warehouse {
  id: string;
  name: string;
  countries: string[];
}
