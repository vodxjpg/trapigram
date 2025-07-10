export default function ProductImportGuide() {
    const steps = [
      {
        title: "1. First Row is Ignored",
        description: `<b>Always keep in mind:</b> the first row of the import template is ignored during processing, we use it to show an example to you when you download the import template. 
        Make sure your actual products start from row 2 and follow the template format.`,
        illustration: "🚫",
      },
      {
        title: "2. Understand Product Types",
        description: `<ul>
          <li><b>Simple</b>: Standalone item with no variations.</li>
          <li><b>Variable</b>: Parent product that has multiple variations (e.g., sizes or colors).</li>
          <li><b>Variation</b>: Child product that belongs to a variable one.</li>
        </ul>`,
        illustration: "📦",
      },
      {
        title: "3. Use the Right SKU",
        description: `<ul>
          <li><b>Each product needs a unique SKU</b>.</li>
          <li>For variations, set a new SKU and link it to the parent using the <b>parent</b> column.</li>
        </ul>`,
        illustration: "🔖",
      },
      {
        title: "4. Define Attributes",
        description: `Use <b>attributeSlug1</b>, <b>attributeValues1</b>, and <b>attributeVariation1</b> to assign attributes. 
        Set <b>attributeVariation1 = 1</b> to generate variations from that attribute (product type must be variable).`,
        illustration: "🧬",
      },
      {
        title: "5. Link Variations to Parent",
        description: `Set <b>productType = variation</b> and fill in the <b>parent</b> column with the SKU of the variable product.`,
        illustration: "🔗",
      },
      {
        title: "6. Add Prices and Stock",
        description: `Set prices and stock per country for your products doing the following:
        
        <ul>
          <li><b>Price</b>: <code>ES: 8, GB: 7</code></li>
          <li><b>WarehouseId</b>: ID of the warehouse that will hold your product's stock</li>
          <li><b>Countrie of your stock</b>: e.g. <code>ES, GB</code></li>
          <li><b>Stock</b>: <code>10, 20</code> (order matters)</li>
        </ul>`,
        illustration: "💰",
      },
      {
        title: "7. Publish or Draft",
        description: `<ul>
          <li><b>1</b> = publish product</li>
          <li><b>0</b> = keep as draft</li>
        </ul>`,
        illustration: "🚦",
      },
      {
        title: "8. Update Existing Products",
        description: `<ul>
          <li>If the <b>SKU or ID</b> already exists, it will update the product.</li>
          <li>To change a SKU, <b>keep the same ID</b> and modify the SKU field.</li>
        </ul>`,
        illustration: "♻️",
      },
    ];
  
    return (
      <div className="bg-gray-200 rounded-3xl p-8 md:p-12">
        <h1 className="text-3xl md:text-4xl font-bold text-black text-center mb-3">
          📘 Product Import & Update Guide
        </h1>
        <p className="text-center font-bold mb-12">
          Learn how to import new products or update your existing ones in a safe and fast way.
        </p>
  
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {steps.map((step, index) => (
            <div key={index} className="bg-white rounded-2xl p-8 shadow-sm">
              <div className="text-4xl mb-4">{step.illustration}</div>
              <h3 className="text-xl font-bold text-black mb-4">{step.title}</h3>
              <div
                className="text-gray-600 leading-relaxed [&>ul]:list-disc [&>ul]:pl-5 [&>b]:font-semibold"
                dangerouslySetInnerHTML={{ __html: step.description }}
              />
            </div>
          ))}
        </div>
  
        <div className="text-center mt-16">
          <div className="text-6xl text-blue-600 mb-8">📁</div>
          <h2 className="text-3xl md:text-4xl font-bold text-black">
            “Importing and updating products is now<br />
            structured, visual, and flexible.”
          </h2>
        </div>
      </div>
    );
  }
  