export interface Term {
    id: string
    name: string
  }
  
  export interface Attribute {
    id: string
    name: string
    terms: Term[]
    selectedTerms: string[]
    useForVariations: boolean
  }
  
  export interface Product {
    id: string
    title: string
    image: string | null
    sku: string
    status: "published" | "draft"
    regularPrice: number
    salePrice: number | null
    stockStatus: "managed" | "unmanaged"
    categories: string[]
    createdAt: string
    productType?: "simple" | "variable"
    variations?: any[]
    description?: string
    category?: string
  }
  