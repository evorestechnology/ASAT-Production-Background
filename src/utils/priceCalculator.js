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

/**
 * When a print style's cost/placements change, this function:
 * 1. Finds all products that reference this print style (by id or name) in their printing_styles JSON snapshot.
 * 2. Updates the cost/placements snapshot inside each product's printing_styles array.
 * 3. Re-saves the product row with the fresh snapshot.
 * 4. Triggers updateAllDesignPricesForBaseProduct for each affected product so designs get repriced.
 *
 * @param {string} printStyleId   - The UUID of the changed print_style row.
 * @param {object} updatedStyle   - The full updated print_style object (from the DB after update).
 */
export async function propagatePrintStyleCostToProducts(printStyleId, updatedStyle) {
  if (!printStyleId || !updatedStyle) return;

  // Parse the new description to extract cost & placements
  let newDesc = {};
  try {
    newDesc = typeof updatedStyle.description === 'string'
      ? JSON.parse(updatedStyle.description)
      : (updatedStyle.description || {});
  } catch (e) {
    newDesc = {};
  }
  const newCost = Number(newDesc.cost) || 0;
  const newPlacements = newDesc.placements || newDesc.placementCategories || [];

  // Fetch all products belonging to this manufacturer
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('mfg_id', updatedStyle.mfg_id);

  if (prodErr || !products || products.length === 0) {
    console.log(`[PrintStyle Propagate] No products found for mfg_id=${updatedStyle.mfg_id}`);
    return;
  }

  let affectedCount = 0;

  for (const product of products) {
    const printingStyles = Array.isArray(product.printing_styles) ? product.printing_styles : [];

    // Check if this product references the changed print style
    const styleIndex = printingStyles.findIndex(ps =>
      ps.id === printStyleId ||
      ps.style_id === printStyleId ||
      (ps.name && updatedStyle.name && ps.name.toLowerCase() === updatedStyle.name.toLowerCase())
    );

    if (styleIndex === -1) continue; // product doesn't use this print style

    // Update the snapshot: patch cost and placements in the product's printing_styles array
    const updatedPrintingStyles = [...printingStyles];
    updatedPrintingStyles[styleIndex] = {
      ...updatedPrintingStyles[styleIndex],
      cost: newCost,
      placements: newPlacements.length > 0 ? newPlacements : updatedPrintingStyles[styleIndex].placements,
    };

    // Save the updated snapshot back to the product
    const { data: savedProduct, error: saveErr } = await supabaseAdmin
      .from('products')
      .update({
        printing_styles: updatedPrintingStyles,
        updated_at: new Date().toISOString()
      })
      .eq('id', product.id)
      .select()
      .single();

    if (saveErr) {
      console.error(`[PrintStyle Propagate] Failed to update product ${product.id}:`, saveErr.message);
      continue;
    }

    console.log(`[PrintStyle Propagate] Updated printing_styles snapshot in product ${product.id} (${product.title})`);
    affectedCount++;

    // Now recalculate all design prices that use this product
    await updateAllDesignPricesForBaseProduct(product.id, savedProduct);
  }

  console.log(`[PrintStyle Propagate] Propagated print style "${updatedStyle.name}" cost change to ${affectedCount} product(s).`);
}
