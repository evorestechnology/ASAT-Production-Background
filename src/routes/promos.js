import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();
const PROMO_SETTINGS_KEY = 'promo_codes';

// Default promo code seeded if none exist
const DEFAULT_PROMOS = [
  {
    id: 'promo_default_asat15',
    code: 'ASAT15',
    description: 'Site-wide 15% discount',
    discountType: 'percentage',
    discountValue: 15,
    minOrderAmount: 0,
    expiresAt: null, // No expiry
    isActive: true,
    type: 'public', // 'public' or 'private'
    usedBy: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
];

/**
 * Helper: Retrieve promo codes from the settings table
 */
export async function getStoredPromos() {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', PROMO_SETTINGS_KEY)
      .maybeSingle();

    if (error) {
      console.error('Error fetching promos from settings:', error.message);
      return DEFAULT_PROMOS;
    }

    if (!data || !Array.isArray(data.value) || data.value.length === 0) {
      // Seed default promo
      await supabaseAdmin.from('settings').upsert({
        key: PROMO_SETTINGS_KEY,
        value: DEFAULT_PROMOS,
        updated_at: new Date().toISOString()
      });
      return DEFAULT_PROMOS;
    }

    return data.value;
  } catch (err) {
    console.error('getStoredPromos error:', err);
    return DEFAULT_PROMOS;
  }
}

/**
 * Helper: Save promo codes to the settings table
 */
export async function saveStoredPromos(promosList) {
  const { error } = await supabaseAdmin
    .from('settings')
    .upsert({
      key: PROMO_SETTINGS_KEY,
      value: promosList,
      updated_at: new Date().toISOString()
    });

  if (error) throw error;
  return promosList;
}

// ── GET /api/promos - Fetch all promo codes (Master or public) ────────────────
router.get('/', async (req, res) => {
  try {
    const promos = await getStoredPromos();
    
    // Annotate status for each promo
    const now = new Date();
    const enriched = promos.map((p) => {
      const isExpired = p.expiresAt ? new Date(p.expiresAt) < now : false;
      return {
        ...p,
        isExpired,
        status: !p.isActive ? 'inactive' : isExpired ? 'expired' : 'active'
      };
    });

    res.json(enriched);
  } catch (err) {
    console.error('GET /api/promos error:', err.message);
    res.status(500).json({ error: 'Failed to fetch promo codes' });
  }
});

// ── GET /api/promos/public - Fetch active public promo codes for customer ────────────────
router.get('/public', verifyAuth, async (req, res) => {
  try {
    const promos = await getStoredPromos();
    const now = new Date();
    
    // Filter only active, non-expired, public promos that the user hasn't used
    const publicPromos = promos.filter((p) => {
      if (!p.isActive) return false;
      if (p.type === 'private') return false;
      if (p.expiresAt && new Date(p.expiresAt) < now) return false;
      if (p.usedBy && p.usedBy.includes(req.uid)) return false;
      return true;
    });

    res.json(publicPromos);
  } catch (err) {
    console.error('GET /api/promos/public error:', err.message);
    res.status(500).json({ error: 'Failed to fetch public promo codes' });
  }
});

// ── POST /api/promos/validate - Customer validation endpoint ─────────────────
router.post('/validate', verifyAuth, async (req, res) => {
  try {
    const { code, subtotal = 0 } = req.body;
    if (!code || !code.trim()) {
      const msg = 'Promo code is required.';
      return res.status(400).json({ valid: false, error: msg, message: msg });
    }

    const cleanCode = code.trim().toUpperCase();
    const subtotalNum = Number(subtotal) || 0;
    const promos = await getStoredPromos();

    const match = promos.find((p) => (p.code || '').trim().toUpperCase() === cleanCode);
    if (!match) {
      const msg = 'Invalid promo code.';
      return res.status(404).json({ valid: false, error: msg, message: msg });
    }

    if (!match.isActive) {
      const msg = 'This promo code is currently deactivated.';
      return res.status(400).json({ valid: false, error: msg, message: msg });
    }

    // Check if used by this user already
    if (match.usedBy && match.usedBy.includes(req.uid)) {
      const msg = 'You have already used this promo code.';
      return res.status(400).json({ valid: false, error: msg, message: msg });
    }

    // Check expiry
    if (match.expiresAt) {
      const expiryDate = new Date(match.expiresAt);
      if (expiryDate < new Date()) {
        const formattedDate = expiryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        const msg = `This promo code expired on ${formattedDate}.`;
        return res.status(400).json({ valid: false, error: msg, message: msg });
      }
    }

    // Check minimum order amount
    const minOrder = Number(match.minOrderAmount) || 0;
    if (minOrder > 0 && subtotalNum < minOrder) {
      const msg = `Minimum order subtotal of ₹${minOrder} required to apply this code.`;
      return res.status(400).json({
        valid: false,
        error: msg,
        message: msg
      });
    }

    // Compute discount
    let discountAmount = 0;
    const discountVal = Number(match.discountValue) || 0;
    if (match.discountType === 'fixed') {
      discountAmount = Math.min(subtotalNum, discountVal);
    } else {
      // Percentage
      discountAmount = Math.round(subtotalNum * (discountVal / 100));
    }

    return res.json({
      valid: true,
      code: match.code,
      discountType: match.discountType || 'percentage',
      discountValue: discountVal,
      discountAmount,
      description: match.description || '',
      message: `${match.code} applied! Saved ${match.discountType === 'fixed' ? `₹${discountVal}` : `${discountVal}%`}.`
    });
  } catch (err) {
    console.error('POST /api/promos/validate error:', err.message);
    res.status(500).json({ valid: false, error: 'Failed to validate promo code.' });
  }
});

// ── POST /api/promos - Create new promo code (Admin only) ────────────────────
router.post('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const {
      code,
      discountType = 'percentage',
      discountValue,
      expiresAt = null,
      isActive = true,
      description = '',
      type = 'public',
      minOrderAmount = 0
    } = req.body;

    if (!code || !code.trim()) {
      return res.status(400).json({ error: 'Promo code name is required.' });
    }

    const cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const val = Number(discountValue);
    if (isNaN(val) || val <= 0) {
      return res.status(400).json({ error: 'Discount value must be a positive number.' });
    }

    if (discountType === 'percentage' && val > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
    }

    // Validate optional expiry date
    let cleanExpiresAt = null;
    if (expiresAt) {
      const d = new Date(expiresAt);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid expiry date format.' });
      }
      cleanExpiresAt = d.toISOString();
    }

    const promos = await getStoredPromos();
    // Check if code already exists
    if (promos.some((p) => p.code.toUpperCase() === cleanCode)) {
      return res.status(400).json({ error: `Promo code "${cleanCode}" already exists.` });
    }

    const newPromo = {
      id: `promo_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      code: cleanCode,
      description: description.trim(),
      discountType: discountType === 'fixed' ? 'fixed' : 'percentage',
      discountValue: val,
      minOrderAmount: Math.max(0, Number(minOrderAmount) || 0),
      expiresAt: cleanExpiresAt,
      isActive: Boolean(isActive),
      type: type === 'private' ? 'private' : 'public',
      usedBy: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    promos.unshift(newPromo);
    await saveStoredPromos(promos);

    res.status(201).json({ success: true, data: newPromo, message: `Promo code ${newPromo.code} created successfully.` });
  } catch (err) {
    console.error('POST /api/promos error:', err.message);
    res.status(500).json({ error: 'Failed to create promo code.' });
  }
});

// ── PUT /api/promos/:id - Update existing promo code (Admin only) ────────────
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      code,
      discountType,
      discountValue,
      expiresAt,
      isActive,
      description,
      type,
      minOrderAmount
    } = req.body;

    const promos = await getStoredPromos();
    const idx = promos.findIndex((p) => p.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Promo code not found.' });
    }

    const existing = promos[idx];

    // If changing code name, check for duplicates
    let cleanCode = existing.code;
    if (code && code.trim()) {
      cleanCode = code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      const duplicate = promos.find((p) => p.id !== id && p.code.toUpperCase() === cleanCode);
      if (duplicate) {
        return res.status(400).json({ error: `Promo code "${cleanCode}" already exists.` });
      }
    }

    let cleanExpiresAt = existing.expiresAt;
    if (expiresAt !== undefined) {
      if (!expiresAt) {
        cleanExpiresAt = null;
      } else {
        const d = new Date(expiresAt);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ error: 'Invalid expiry date format.' });
        }
        cleanExpiresAt = d.toISOString();
      }
    }

    const updatedPromo = {
      ...existing,
      code: cleanCode,
      description: description !== undefined ? description.trim() : existing.description,
      discountType: discountType !== undefined ? (discountType === 'fixed' ? 'fixed' : 'percentage') : existing.discountType,
      discountValue: discountValue !== undefined ? Number(discountValue) : existing.discountValue,
      minOrderAmount: minOrderAmount !== undefined ? Math.max(0, Number(minOrderAmount) || 0) : existing.minOrderAmount,
      expiresAt: cleanExpiresAt,
      isActive: isActive !== undefined ? Boolean(isActive) : existing.isActive,
      type: type !== undefined ? (type === 'private' ? 'private' : 'public') : (existing.type || 'public'),
      updatedAt: new Date().toISOString()
    };

    if (updatedPromo.discountType === 'percentage' && updatedPromo.discountValue > 100) {
      return res.status(400).json({ error: 'Percentage discount cannot exceed 100%.' });
    }

    promos[idx] = updatedPromo;
    await saveStoredPromos(promos);

    res.json({ success: true, data: updatedPromo, message: `Promo code ${updatedPromo.code} updated.` });
  } catch (err) {
    console.error('PUT /api/promos/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update promo code.' });
  }
});

// ── DELETE /api/promos/:id - Delete promo code (Admin only) ──────────────────
router.delete('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const promos = await getStoredPromos();
    const filtered = promos.filter((p) => p.id !== id);

    if (filtered.length === promos.length) {
      return res.status(404).json({ error: 'Promo code not found.' });
    }

    await saveStoredPromos(filtered);
    res.json({ success: true, message: 'Promo code deleted successfully.' });
  } catch (err) {
    console.error('DELETE /api/promos/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete promo code.' });
  }
});

export default router;