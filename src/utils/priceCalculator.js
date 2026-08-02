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
            const pidClean = String(placementId).toLowerCase();
            const pl = (ps.placements || []).find(p => {
              const pId = String(p.id || '').toLowerCase();
              const pLabel = String(p.label || '').toLowerCase();
              const pName = String(p.name || '').toLowerCase();
              return pId === pidClean || pLabel === pidClean || pName === pidClean ||
                     (pId && pidClean && (pId.endsWith('_' + pidClean) || pidClean.endsWith('_' + pId)));
            });
            if (pl) {
              const isDtg = techKey.toLowerCase() === 'dtg' || (ps.style || '').toLowerCase() === 'dtg';
              let singlePlCost = 0;
              if (isDtg && (pl.cost_dark !== undefined || pl.cost_light !== undefined)) {
                const cd = Number(pl.cost_dark) || 0;
                const cl = Number(pl.cost_light) || 0;
                singlePlCost = (cd > 0 || cl > 0) ? Math.max(cd, cl) : (Number(pl.price) || 0);
              } else {
                singlePlCost = Number(pl.price ?? pl.cost ?? pl.cost_dark ?? pl.cost_light ?? 0);
              }
              colorCost += singlePlCost;
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
 * 1. Finds all products belonging to this manufacturer.
 * 2. For each product whose printing_styles snapshot references this style (by UUID, name, or category),
 *    updates the placement prices and top-level cost in the snapshot.
 * 3. Re-saves the product row with the fresh snapshot.
 * 4. Triggers updateAllDesignPricesForBaseProduct for each affected product so designs get repriced.
 *
 * Product printing_styles snapshot format:
 *   [{ style: "DTF", cost: 0, placements: [{id, label, price, cost_dark, cost_light}] }]
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
  // Placements can be in placementCategories or flat placements array
  const hasFlatPlacements = Array.isArray(newDesc.placements) && newDesc.placements.length > 0;
  const newPlacements = hasFlatPlacements ? newDesc.placements : (newDesc.placementCategories || []);

  // Fetch all products belonging to this manufacturer
  const { data: products, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('mfg_id', updatedStyle.mfg_id);

  if (prodErr || !products || products.length === 0) {
    console.log(`[PrintStyle Propagate] No products found for mfg_id=${updatedStyle.mfg_id}`);
    return;
  }

  // Build a flat label→prices map & full list of placements from the updated print style's placement definitions
  const newPlacementPriceMap = {};
  const fullPlacementListFromStyle = [];

  for (const np of newPlacements) {
    let placementsObjOrArr = np.placements;
    if (placementsObjOrArr) {
      const placementItems = Array.isArray(placementsObjOrArr)
        ? placementsObjOrArr
        : Object.entries(placementsObjOrArr).map(([optName, p]) => ({ ...p, label: optName }));

      for (const p of placementItems) {
        const rawLabel = p.label || p.name || p.id || '';
        const capLabel = rawLabel ? (rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)) : 'Placement';
        const plId = np.category ? `${np.category}_${rawLabel}` : rawLabel;
        const pr = Number(p.price ?? p.cost ?? 0);
        const cd = Number(p.darkPrice ?? p.cost_dark ?? p.price_dark ?? 0);
        const cl = Number(p.lightPrice ?? p.cost_light ?? p.price_light ?? 0);

        fullPlacementListFromStyle.push({
          id: plId,
          label: capLabel,
          price: pr,
          cost_dark: cd,
          cost_light: cl
        });

        const labelKey = rawLabel.toLowerCase().trim();
        if (labelKey) {
          newPlacementPriceMap[labelKey] = { price: pr, cost_dark: cd, cost_light: cl };
        }
        if (np.category && labelKey) {
          const catKey = `${np.category}_${labelKey}`.toLowerCase().trim();
          newPlacementPriceMap[catKey] = { price: pr, cost_dark: cd, cost_light: cl };
        }
      }
    } else {
      const key = (np.label || np.name || np.id || '').toLowerCase().trim();
      if (key) {
        const pr = Number(np.price ?? np.cost ?? 0);
        const cd = Number(np.cost_dark ?? np.darkPrice ?? np.price_dark ?? 0);
        const cl = Number(np.cost_light ?? np.lightPrice ?? np.price_light ?? 0);
        newPlacementPriceMap[key] = { price: pr, cost_dark: cd, cost_light: cl };
        fullPlacementListFromStyle.push({
          id: np.id || key,
          label: np.label || key,
          price: pr,
          cost_dark: cd,
          cost_light: cl
        });
      }
    }
  }

  const updatedStyleCategory = (newDesc.category || '').toLowerCase().trim();
  const updatedStyleName = (updatedStyle.name || '').toLowerCase().trim();

  let affectedCount = 0;

  for (const product of products) {
    const printingStyles = Array.isArray(product.printing_styles) ? product.printing_styles : [];
    if (printingStyles.length === 0) continue;

    let changed = false;
    const updatedPrintingStyles = printingStyles.map(ps => {
      // The snapshot key for the style type (e.g. "dtf", "DTF", style name)
      const psStyleKey = (ps.style || ps.name || ps.type || '').toLowerCase().trim();
      const psId = ps.id || ps.style_id || '';

      // Match by: explicit UUID stored in snapshot first, or by matching style category/name
      const matches = psId
        ? (psId === printStyleId)
        : ((psStyleKey && updatedStyleCategory && psStyleKey === updatedStyleCategory) ||
           (psStyleKey && updatedStyleName && psStyleKey === updatedStyleName));

      if (!matches) return ps;
      changed = true;

      // Helper to find matching placement prices from map
      const findPricesInMap = (pl) => {
        const idClean = String(pl.id || '').toLowerCase().trim();
        const labelClean = String(pl.label || pl.name || '').toLowerCase().trim();

        if (idClean && newPlacementPriceMap[idClean]) return newPlacementPriceMap[idClean];
        if (labelClean && newPlacementPriceMap[labelClean]) return newPlacementPriceMap[labelClean];

        const idStripped = idClean.replace(/[\s_\-]/g, '');
        const labelStripped = labelClean.replace(/[\s_\-]/g, '');

        for (const [mapKey, prices] of Object.entries(newPlacementPriceMap)) {
          const mapStripped = mapKey.replace(/[\s_\-]/g, '');
          if (
            (idStripped && mapStripped === idStripped) ||
            (labelStripped && mapStripped === labelStripped) ||
            (labelStripped && mapStripped.endsWith(labelStripped)) ||
            (idStripped && mapStripped.endsWith(idStripped)) ||
            (labelStripped && labelStripped.endsWith(mapStripped))
          ) {
            return prices;
          }
        }
        return null;
      };

      // Update each placement's prices where we have matching label in the price map
      const updatedPlacementsArr = (ps.placements || []).map(pl => {
        const newPrices = findPricesInMap(pl);
        if (newPrices) {
          changed = true;
          return { ...pl, ...newPrices };
        }
        return pl;
      });

      // Append any newly added placements defined in the updated print style
      for (const newPl of fullPlacementListFromStyle) {
        const alreadyExists = updatedPlacementsArr.some(pl => {
          const matchedPrices = findPricesInMap(pl);
          const newPlPrices = findPricesInMap(newPl);
          return (matchedPrices && newPlPrices && matchedPrices === newPlPrices) ||
                 (pl.id && newPl.id && String(pl.id).toLowerCase().trim() === String(newPl.id).toLowerCase().trim()) ||
                 (pl.label && newPl.label && String(pl.label).toLowerCase().trim() === String(newPl.label).toLowerCase().trim());
        });
        if (!alreadyExists) {
          updatedPlacementsArr.push(newPl);
          changed = true;
        }
      }

      return { ...ps, cost: newCost, placements: updatedPlacementsArr };
    });

    if (!changed) continue;

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

    // Recalculate all design prices that use this product
    await updateAllDesignPricesForBaseProduct(product.id, savedProduct);
  }

  console.log(`[PrintStyle Propagate] Propagated print style "${updatedStyle.name}" cost change to ${affectedCount} product(s).`);
}

/**
 * Dynamically enriches product printing_styles with live placements from print_styles table.
 * Ensures any new placement added by manufacturer is immediately available when querying products.
 */
export async function enrichProductsWithLivePrintStyles(productsList) {
  if (!Array.isArray(productsList) || productsList.length === 0) return productsList;

  try {
    const mfgIds = Array.from(new Set(productsList.map(p => p.mfg_id).filter(Boolean)));
    if (mfgIds.length === 0) return productsList;

    const { data: styles } = await supabaseAdmin
      .from('print_styles')
      .select('*')
      .in('mfg_id', mfgIds)
      .eq('active', true);

    if (!styles || styles.length === 0) return productsList;

    const mfgStyleMap = {};
    for (const st of styles) {
      if (!mfgStyleMap[st.mfg_id]) mfgStyleMap[st.mfg_id] = [];
      mfgStyleMap[st.mfg_id].push(st);
    }

    return productsList.map(product => {
      const liveStyles = mfgStyleMap[product.mfg_id];
      if (!liveStyles || liveStyles.length === 0) return product;

      const printingStyles = Array.isArray(product.printing_styles) ? product.printing_styles : [];
      const updatedStyles = printingStyles.map(ps => {
        const psStyleKey = (ps.style || ps.name || ps.type || '').toLowerCase().trim();
        const matchingLiveStyle = liveStyles.find(st => {
          let desc = {};
          try { desc = typeof st.description === 'string' ? JSON.parse(st.description) : (st.description || {}); } catch(e){}
          const cat = (desc.category || '').toLowerCase().trim();
          const name = (st.name || '').toLowerCase().trim();
          return st.id === ps.id || (psStyleKey && cat && psStyleKey === cat) || (psStyleKey && name && psStyleKey === name);
        });

        if (!matchingLiveStyle) return ps;

        let liveDesc = {};
        try { liveDesc = typeof matchingLiveStyle.description === 'string' ? JSON.parse(matchingLiveStyle.description) : (matchingLiveStyle.description || {}); } catch(e){}

        const hasFlat = Array.isArray(liveDesc.placements) && liveDesc.placements.length > 0;
        const livePlacementsRaw = hasFlat ? liveDesc.placements : (liveDesc.placementCategories || []);

        const livePlacementItems = [];
        for (const np of livePlacementsRaw) {
          let pItems = np.placements;
          if (pItems) {
            const items = Array.isArray(pItems) ? pItems : Object.entries(pItems).map(([optName, p]) => ({ ...p, label: optName }));
            for (const p of items) {
              const rawLabel = p.label || p.name || p.id || '';
              const capLabel = rawLabel ? (rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1)) : 'Placement';
              const plId = np.category ? `${np.category}_${rawLabel}` : rawLabel;
              livePlacementItems.push({
                id: plId,
                label: capLabel,
                price: Number(p.price ?? p.cost ?? 0),
                cost_dark: Number(p.darkPrice ?? p.cost_dark ?? p.price_dark ?? 0),
                cost_light: Number(p.lightPrice ?? p.cost_light ?? p.price_light ?? 0)
              });
            }
          } else {
            const key = (np.label || np.name || np.id || '').toLowerCase().trim();
            if (key) {
              livePlacementItems.push({
                id: np.id || key,
                label: np.label || key,
                price: Number(np.price ?? np.cost ?? 0),
                cost_dark: Number(np.cost_dark ?? np.darkPrice ?? np.price_dark ?? 0),
                cost_light: Number(np.cost_light ?? np.lightPrice ?? np.price_light ?? 0)
              });
            }
          }
        }

        const existingPlacements = Array.isArray(ps.placements) ? ps.placements : [];
        const mergedPlacements = [...existingPlacements];

        for (const livePl of livePlacementItems) {
          const idx = mergedPlacements.findIndex(p => {
            const pid = String(p.id || '').toLowerCase().trim();
            const plabel = String(p.label || p.name || '').toLowerCase().trim();
            const liveId = String(livePl.id || '').toLowerCase().trim();
            const liveLabel = String(livePl.label || '').toLowerCase().trim();
            return pid === liveId || plabel === liveLabel || pid.endsWith('_' + liveLabel) || liveId.endsWith('_' + plabel);
          });

          if (idx >= 0) {
            mergedPlacements[idx] = { ...mergedPlacements[idx], price: livePl.price, cost_dark: livePl.cost_dark, cost_light: livePl.cost_light };
          } else {
            mergedPlacements.push(livePl);
          }
        }

        return { ...ps, placements: mergedPlacements };
      });

      return { ...product, printing_styles: updatedStyles };
    });
  } catch (err) {
    console.error('Error enriching products with live print styles:', err.message);
    return productsList;
  }
}
