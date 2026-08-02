import { supabaseAdmin } from '../supabaseAdmin.js';

/**
 * Dynamically syncs a design's price with its linked base product cost & printing styles.
 * Returns the design object with recalculated price and updated description.pricing.
 */
export function syncDesignPriceWithBaseProduct(design) {
  if (!design || !design.products) return design;
  try {
    let desc = {};
    if (typeof design.description === 'string' && design.description.trim().startsWith('{')) {
      desc = JSON.parse(design.description);
    } else if (typeof design.description === 'object' && design.description !== null) {
      desc = design.description;
    }

    const pricing = desc.pricing || {};
    const baseProductCost = Number(design.products.cost) || 0;
    const designerCost = Number(pricing.designerCost) || 0;
    const markup = Number(pricing.markup) || 0;
    let printingCost = Number(pricing.printingCost) || 0;

    // Recalculate printing style placement cost if base product has printing_styles
    const printingStyles = Array.isArray(design.products.printing_styles) ? design.products.printing_styles : [];
    const placementsObj = desc.placements || desc.colorPlacements || {};
    const colorKeys = Object.keys(placementsObj);

    if (colorKeys.length > 0 && printingStyles.length > 0) {
      let maxColorPrintingCost = 0;
      for (const colorKey of colorKeys) {
        const colorPlacements = Array.isArray(placementsObj[colorKey]) ? placementsObj[colorKey] : [];
        let colorCost = 0;
        for (const placement of colorPlacements) {
          const techKey = placement.technique || placement.style || '';
          const placementId = placement.placementId || placement.id || placement.label || '';

          const ps = printingStyles.find(x => 
            (x.style && x.style.toLowerCase() === techKey.toLowerCase()) || 
            (x.name && x.name.toLowerCase() === techKey.toLowerCase()) ||
            (x.id && x.id === techKey)
          );
          if (ps) {
            const pl = (ps.placements || []).find(p => 
              (p.id && String(p.id).toLowerCase() === String(placementId).toLowerCase()) || 
              (p.label && String(p.label).toLowerCase() === String(placementId).toLowerCase()) ||
              (p.name && String(p.name).toLowerCase() === String(placementId).toLowerCase())
            );
            if (pl) {
              colorCost += Number(pl.price ?? pl.cost ?? pl.cost_dark ?? pl.cost_light ?? 0);
            } else if (ps.cost !== undefined) {
              colorCost += Number(ps.cost) || 0;
            }
          } else if (placement.price !== undefined || placement.cost !== undefined) {
            colorCost += Number(placement.price || placement.cost) || 0;
          }
        }
        if (colorCost > maxColorPrintingCost) maxColorPrintingCost = colorCost;
      }
      if (maxColorPrintingCost > 0) {
        printingCost = maxColorPrintingCost;
      }
    }

    const calculatedPrice = baseProductCost + printingCost + designerCost + markup;
    if (calculatedPrice > 0) {
      design.price = calculatedPrice;
      if (!desc.pricing) desc.pricing = {};
      desc.pricing.baseCost = baseProductCost;
      desc.pricing.printingCost = printingCost;
      desc.pricing.designerCost = designerCost;
      desc.pricing.totalPrice = calculatedPrice;
      design.description = typeof design.description === 'string' ? JSON.stringify(desc) : desc;
    }
  } catch (err) {
    console.error('Error syncing design price:', err.message);
  }
  return design;
}

/**
 * Updates all designs in the database linked to a given baseProductId when cost/printing_styles change.
 */
export async function updateAllDesignPricesForBaseProduct(baseProductId, updatedProduct) {
  if (!baseProductId || !updatedProduct) return;
  try {
    const { data: designs, error } = await supabaseAdmin
      .from('designs')
      .select('*')
      .eq('base_product_id', baseProductId);

    if (error || !designs || designs.length === 0) return;

    for (const design of designs) {
      try {
        const synced = syncDesignPriceWithBaseProduct({ ...design, products: updatedProduct });
        if (synced) {
          const descStr = typeof synced.description === 'string' ? synced.description : JSON.stringify(synced.description);
          await supabaseAdmin
            .from('designs')
            .update({
              price: synced.price,
              description: descStr,
              updated_at: new Date().toISOString()
            })
            .eq('id', design.id);

          console.log(`[Base Product Update] Recalculated design ${design.id} price to ₹${synced.price}`);
        }
      } catch (dErr) {
        console.error(`Error updating design ${design.id}:`, dErr.message);
      }
    }
  } catch (err) {
    console.error('Error in updateAllDesignPricesForBaseProduct:', err.message);
  }
}
