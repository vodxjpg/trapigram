// src/app/(dashboard)/affiliate-products/components/affiliate-product-variations.tsx
"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import {
  Plus, Trash, Edit, Save, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge  } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { FormLabel } from "@/components/ui/form";

import { PointsManagement } from "./points-management";
import { CostManagement   } from "@/app/(dashboard)/products/components/cost-management";
import type { CostMap     } from "./affiliate-product-form";

import type { Attribute, Variation, Warehouse } from "@/types/product";

/* ──────────────────────────────────────────────────────────── */
/* Types / helpers                                              */
/* ──────────────────────────────────────────────────────────── */
type PointsMap = Record<string,{regular:number;sale:number|null}>;

interface VariationExt extends Variation {
  prices: PointsMap;
  cost:   CostMap;
  stock:  Record<string,Record<string,number>>;
}

interface Props{
  attributes: Attribute[];
  variations: VariationExt[];
  onVariationsChange: React.Dispatch<React.SetStateAction<VariationExt[]>>;
  warehouses: Warehouse[];
  countries : string[];
}

/* upload widget (unchanged) */
function VariationImagePicker({value,onChange}:{value:string|null;onChange:(url:string|null)=>void}){
  const [preview,setPreview]=useState<string|null>(value);
  const inputId = `var-img-${uuidv4()}`;
  const handleUpload = async (e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file) return;
    const fd=new FormData(); fd.append("file",file);
    const { filePath } = await fetch("/api/upload",{method:"POST",body:fd}).then(r=>r.json());
    setPreview(filePath); onChange(filePath);
  };
  return (
    <>
      {preview
        ?(<div className="relative w-full h-40 rounded-md overflow-hidden mb-2"><img src={preview} alt="Variation" className="object-cover w-full h-full"/></div>)
        :(<div className="w-full h-40 border border-dashed rounded-md flex items-center justify-center mb-2"><span className="text-xs text-muted-foreground">No image</span></div>)}
      <input type="file" accept="image/*" id={inputId} className="hidden" onChange={handleUpload}/>
      <Button variant="outline" type="button" onClick={()=>document.getElementById(inputId)?.click()} className="w-full">
        {preview?"Change Image":"Upload Image"}
      </Button>
    </>
  );
}

export function AffiliateProductVariations({attributes,variations,onVariationsChange,warehouses,countries}:Props){
  const [editingId,setEditingId]=useState<string|null>(null);
  const [expandedId,setExpandedId]=useState<string|null>(null);
  const [skuDraft, setSkuDraft ]=useState("");

  /* ensure every variation has full points/cost/stock map */
  useEffect(()=>{
    if(!countries.length || !warehouses.length) return;
    onVariationsChange(cur=>cur.map(v=>{
      let changed=false;

      /* points */
      const pts:{[k:string]:{regular:number;sale:number|null}}={...v.prices};
      countries.forEach(c=>{
        if(!pts[c]){pts[c]={regular:0,sale:null}; changed=true;}
      });

      /* cost */
      const cost:{[k:string]:number}={...v.cost};
      countries.forEach(c=>{
        if(cost[c]===undefined){cost[c]=0; changed=true;}
      });

      /* stock */
      const stock:Record<string,Record<string,number>>={...v.stock};
      warehouses.forEach(w=>{
        if(!stock[w.id]){stock[w.id]={}; changed=true;}
        w.countries.forEach(c=>{
          if(stock[w.id][c]===undefined){stock[w.id][c]=0; changed=true;}
        });
      });

      return changed?{...v,prices:pts,cost,stock}:v;
    }));
  },[countries,warehouses,onVariationsChange]);

  /* helpers ---------------------------------------------------- */
  const label=(aid:string,tid:string)=>{
    const a=attributes.find(x=>x.id===aid);
    const t=a?.terms.find(y=>y.id===tid);
    return a&&t?`${a.name}: ${t.name}`:"";
  };
  const toggle=(id:string)=>setExpandedId(p=>p===id?null:id);

  /* generate variations --------------------------------------- */
  const generateVariations=()=>{
    if(attributes.every(a=>a.selectedTerms.length===0)){
      toast.error("Select attribute terms first"); return;
    }
    const attrs=attributes.filter(a=>a.useForVariations && a.selectedTerms.length)
                          .map(a=>({id:a.id,terms:a.selectedTerms}));

    const combos:Record<string,string>[]=[];
    const build=(i:number,cur:Record<string,string>)=>{
      if(i===attrs.length) return combos.push(cur);
      const a=attrs[i]; a.terms.forEach(t=>build(i+1,{...cur,[a.id]:t}));
    };
    build(0,{});

    const blankPts   = countries.reduce((acc,c)=>(acc[c]={regular:0,sale:null},acc),{} as PointsMap);
    const blankCost  = countries.reduce((acc,c)=>(acc[c]=0,acc),{} as CostMap);
    const blankStock = warehouses.reduce((acc,w)=>(acc[w.id]=w.countries.reduce((m,c)=>(m[c]=0,m),{} as Record<string,number>),acc),{} as Record<string,Record<string,number>>);

    const merged=combos.map(combo=>{
      const existing=variations.find(v=>Object.entries(combo).every(([k,vId])=>v.attributes[k]===vId));
      return existing || {
        id:uuidv4(),
        attributes:combo,
        sku:`VAR-${uuidv4().slice(0,8)}`,
        image:null,
        prices:JSON.parse(JSON.stringify(blankPts)),
        cost  :JSON.parse(JSON.stringify(blankCost)),
        stock :JSON.parse(JSON.stringify(blankStock)),
      };
    });

    onVariationsChange(merged);
    toast.success(`Generated ${merged.length} variations`);
  };

  /* updaters --------------------------------------------------- */
  const updatePoints=(vid:string,map:PointsMap)=>
    onVariationsChange(cur=>cur.map(v=>v.id===vid?{...v,prices:map}:v));

  const updateCost=(vid:string,map:CostMap)=>
    onVariationsChange(cur=>cur.map(v=>v.id===vid?{...v,cost:map}:v));

  const updateStock=(vid:string,wid:string,c:string,qty:number)=>
    onVariationsChange(cur=>cur.map(v=>
      v.id===vid?{...v,stock:{...v.stock,[wid]:{...v.stock[wid],[c]:qty}}}:v));

  const startEditSku=(v:VariationExt)=>{setEditingId(v.id);setSkuDraft(v.sku);setExpandedId(v.id);};
  const saveSku=()=>{
    if(!editingId) return;
    onVariationsChange(cur=>cur.map(v=>v.id===editingId?{...v,sku:skuDraft.trim()||v.sku}:v));
    setEditingId(null);
  };
  const removeVariation=(id:string)=>onVariationsChange(cur=>cur.filter(v=>v.id!==id));

  /* render ----------------------------------------------------- */
  if(attributes.filter(a=>a.useForVariations).length===0)
    return(<p className="text-center py-8 text-muted-foreground">No attributes marked for variations.</p>);

  return(
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Affiliate Product Variations</h3>
        <Button type="button" onClick={generateVariations}><Plus className="h-4 w-4 mr-2"/>Generate Variations</Button>
      </div>

      {variations.length===0?(
        <p className="text-center py-8 text-muted-foreground">No variations generated yet.</p>
      ):(
        variations.map(v=>(
          <Card key={v.id} className="overflow-hidden">
            <CardHeader className="py-3 px-4 flex items-center justify-between bg-muted/40 cursor-pointer"
              onClick={()=>toggle(v.id)}>
              <CardTitle className="text-base">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(v.attributes).map(([aid,tid])=>(
                    <Badge key={`${aid}-${tid}`} variant="outline">{label(aid,tid)}</Badge>
                  ))}
                </div>
              </CardTitle>
              <div className="flex items-center gap-2">
                {editingId===v.id?(
                  <>
                    <Button variant="ghost" size="sm" type="button" onClick={e=>{e.stopPropagation();saveSku();}}>
                      <Save className="h-4 w-4 mr-1"/>Save
                    </Button>
                    <Button variant="ghost" size="sm" type="button" onClick={e=>{e.stopPropagation();setEditingId(null);}}>
                      <X className="h-4 w-4 mr-1"/>Cancel
                    </Button>
                  </>
                ):(
                  <>
                    <Button variant="ghost" size="sm" type="button" onClick={e=>{e.stopPropagation();startEditSku(v);}}>
                      <Edit className="h-4 w-4 mr-1"/>Edit SKU
                    </Button>
                    <Button variant="ghost" size="sm" type="button" className="text-red-600"
                      onClick={e=>{e.stopPropagation();removeVariation(v.id);}}>
                      <Trash className="h-4 w-4 mr-1"/>Delete
                    </Button>
                  </>
                )}
                {expandedId===v.id?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}
              </div>
            </CardHeader>

            {expandedId===v.id && (
              <CardContent className="p-4 space-y-8">
                {/* SKU */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel className="text-sm mb-1 block">SKU</FormLabel>
                    {editingId===v.id?(
                      <input className="w-full border rounded-md px-3 py-2 text-sm" value={skuDraft}
                             onChange={e=>setSkuDraft(e.target.value)}/>
                    ):(
                      <div className="p-2 border rounded-md text-sm">{v.sku}</div>
                    )}
                  </div>
                </div>

                {/* Image */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel className="text-sm mb-1 block">Variation Image</FormLabel>
                    <VariationImagePicker value={v.image}
                      onChange={fp=>onVariationsChange(cur=>cur.map(x=>x.id===v.id?{...x,image:fp}:x))}/>
                  </div>
                </div>

                {/* POINTS */}
                <PointsManagement
                  title="Points per country"
                  countries={countries}
                  pointsData={v.prices}
                  onChange={m=>updatePoints(v.id,m)}
                />

                {/* COST */}
                <CostManagement
                  title="Cost per country"
                  countries={countries}
                  costData={v.cost}
                  onChange={m=>updateCost(v.id,m)}
                />

                {/* STOCK */}
                <h4 className="font-medium mt-4">Stock Management</h4>
                {warehouses.map(w=>(
                  <Accordion type="single" collapsible key={w.id}>
                    <AccordionItem value={w.id}>
                      <AccordionTrigger>{w.name}</AccordionTrigger>
                      <AccordionContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Country</TableHead>
                              <TableHead className="w-[160px]">Qty</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {w.countries.map(c=>(
                              <TableRow key={`${w.id}-${c}`}>
                                <TableCell>{c}</TableCell>
                                <TableCell>
                                  <input type="number" min="0"
                                         className="w-full border rounded-md px-2 py-1 text-sm"
                                         value={v.stock[w.id][c] || 0}
                                         onChange={e=>updateStock(v.id,w.id,c,Number(e.target.value)||0)}/>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ))}
              </CardContent>
            )}
          </Card>
        ))
      )}
    </div>
  );
}
