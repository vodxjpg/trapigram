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
  
  export interface Variation {
    id: string
    attributes: Record<string, string>
    sku: string
    regularPrice: number
    salePrice: number | null
    stock: Record<string, Record<string, number>>
  }
  
  export interface Warehouse {
    id: string
    name: string
    countries: string[]
  }
  