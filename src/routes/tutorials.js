import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// Fallback memory store if database table does not exist
let memoryTutorials = [
  {
    id: 'tut-1',
    title: 'High-Res Mockup Preparation Guidelines',
    description: 'Learn how to position your graphic logos, handle transparent PNGs, and format mockups for DTG & Screen printing.',
    video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    tag: 'Mockup Creation',
    target_role: 'designer',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString()
  },
  {
    id: 'tut-2',
    title: 'Understanding Tech Packs & Placement Rules',
    description: 'A complete step-by-step walkthrough on set up chest, back, and sleeve placements correctly.',
    video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
    tag: 'Tech Pack Setup',
    target_role: 'designer',
    created_at: new Date(Date.now() - 86400000 * 2).toISOString()
  }
];

// GET /api/tutorials - List tutorials
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tutorials')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return res.json(data);
    }
  } catch (err) {
    console.warn('Database tutorials table not available, using memory store:', err.message);
  }
  res.json(memoryTutorials);
});

// POST /api/tutorials - Add new tutorial (Admin only)
router.post('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { title, description, video_url, tag, target_role } = req.body;
    if (!title || !video_url) {
      return res.status(400).json({ error: 'Title and Video URL are required.' });
    }

    const payload = {
      title: title.trim(),
      description: (description || '').trim(),
      video_url: video_url.trim(),
      tag: (tag || 'General').trim(),
      target_role: target_role || 'designer',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    try {
      const { data, error } = await supabaseAdmin
        .from('tutorials')
        .insert(payload)
        .select()
        .single();

      if (!error && data) {
        memoryTutorials.unshift(data);
        return res.status(201).json({ success: true, tutorial: data });
      }
    } catch (dbErr) {
      console.warn('Could not insert to DB, saving to memory fallback:', dbErr.message);
    }

    const newObj = { id: `tut_${Date.now()}`, ...payload };
    memoryTutorials.unshift(newObj);
    res.status(201).json({ success: true, tutorial: newObj });
  } catch (err) {
    console.error('Error creating tutorial:', err.message);
    res.status(500).json({ error: 'Failed to create tutorial' });
  }
});

// PUT /api/tutorials/:id - Update tutorial (Admin only)
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, video_url, tag, target_role } = req.body;

    const payload = {
      updated_at: new Date().toISOString()
    };
    if (title !== undefined) payload.title = title.trim();
    if (description !== undefined) payload.description = description.trim();
    if (video_url !== undefined) payload.video_url = video_url.trim();
    if (tag !== undefined) payload.tag = tag.trim();
    if (target_role !== undefined) payload.target_role = target_role;

    try {
      const { data, error } = await supabaseAdmin
        .from('tutorials')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (!error && data) {
        const idx = memoryTutorials.findIndex(t => t.id === id);
        if (idx !== -1) memoryTutorials[idx] = data;
        return res.json({ success: true, tutorial: data });
      }
    } catch (dbErr) {
      console.warn('Could not update DB, updating memory fallback:', dbErr.message);
    }

    const idx = memoryTutorials.findIndex(t => t.id === id);
    if (idx !== -1) {
      memoryTutorials[idx] = { ...memoryTutorials[idx], ...payload };
      return res.json({ success: true, tutorial: memoryTutorials[idx] });
    }

    res.status(404).json({ error: 'Tutorial not found' });
  } catch (err) {
    console.error('Error updating tutorial:', err.message);
    res.status(500).json({ error: 'Failed to update tutorial' });
  }
});

// DELETE /api/tutorials/:id - Delete tutorial (Admin only)
router.delete('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    try {
      await supabaseAdmin.from('tutorials').delete().eq('id', id);
    } catch (dbErr) {
      console.warn('Could not delete from DB:', dbErr.message);
    }

    memoryTutorials = memoryTutorials.filter(t => t.id !== id);
    res.json({ success: true, message: 'Tutorial deleted successfully' });
  } catch (err) {
    console.error('Error deleting tutorial:', err.message);
    res.status(500).json({ error: 'Failed to delete tutorial' });
  }
});

export default router;
