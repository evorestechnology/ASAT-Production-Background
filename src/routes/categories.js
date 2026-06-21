import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/categories - List all active categories (public)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('active', true)
      .order('order', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching active categories:', err.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// GET /api/categories/all - List all categories (admin)
router.get('/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('categories')
      .select('*')
      .order('order', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching all categories:', err.message);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// POST /api/categories - Create category (admin)
router.post('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { name, image, area, order, active } = req.body;
    if (!name || !image) {
      return res.status(400).json({ error: 'Category name and image URL are required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('categories')
      .insert({
        name: name.trim(),
        image,
        area: area || 'default',
        order: order !== undefined ? order : 1,
        active: active !== undefined ? active : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, category: data });
  } catch (err) {
    console.error('Error creating category:', err.message);
    res.status(500).json({ error: 'Failed to create category' });
  }
});

// PUT /api/categories/:id - Update category (admin)
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, image, area, order, active } = req.body;

    // Fetch original category to check name change
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const updateData = {
      updated_at: new Date().toISOString()
    };
    if (name !== undefined) updateData.name = name.trim();
    if (image !== undefined) updateData.image = image;
    if (area !== undefined) updateData.area = area;
    if (order !== undefined) updateData.order = order;
    if (active !== undefined) updateData.active = active;

    const { data, error } = await supabaseAdmin
      .from('categories')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Global update: If category name is renamed, update ALL products globally
    if (name && original.name !== name.trim()) {
      const oldName = original.name;
      const newName = name.trim();
      const { error: productsError } = await supabaseAdmin
        .from('products')
        .update({ category: newName })
        .eq('category', oldName);

      if (productsError) {
        console.error('Error updating products category on rename:', productsError.message);
      }
    }

    // Global update: If category active status toggles, update availability of all products globally
    if (active !== undefined && original.active !== active) {
      const { error: productsError } = await supabaseAdmin
        .from('products')
        .update({ available: active, updated_at: new Date().toISOString() })
        .eq('category', original.name);

      if (productsError) {
        console.error('Error updating products availability on active status toggle:', productsError.message);
      }
    }

    res.json({ success: true, category: data });
  } catch (err) {
    console.error('Error updating category:', err.message);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

// DELETE /api/categories/:id - Delete category (admin)
router.delete('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch original category name
    const { data: original } = await supabaseAdmin
      .from('categories')
      .select('name')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    if (original) {
      const { error: productsError } = await supabaseAdmin
        .from('products')
        .update({ available: false, updated_at: new Date().toISOString() })
        .eq('category', original.name);

      if (productsError) {
        console.error('Error marking products unavailable on category delete:', productsError.message);
      }
    }

    res.json({ success: true, message: 'Category deleted successfully.' });
  } catch (err) {
    console.error('Error deleting category:', err.message);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;
