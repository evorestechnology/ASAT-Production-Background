import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyDesigner, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/designers - List all designers (admin only)
router.get('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('designers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching designers list:', err.message);
    res.status(500).json({ error: 'Failed to fetch designers' });
  }
});

// GET /api/designers/rankings - Public leaderboard
router.get('/rankings', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('designers')
      .select('id, username, full_name, avatar_url, designs_count, total_earnings, points, status')
      .order('total_earnings', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching designer rankings:', err.message);
    res.status(500).json({ error: 'Failed to fetch rankings' });
  }
});

// GET /api/designers/me - Get logged-in designer's profile
router.get('/me', verifyAuth, verifyDesigner, async (req, res) => {
  res.json(req.designerData);
});

// PUT /api/designers/me - Update own profile (designer)
router.post('/check-username', verifyAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('designers')
      .select('id, username')
      .eq('username', username.trim().toLowerCase());

    if (error) throw error;
    res.json({ available: !data || data.length === 0 || data.every(d => d.id === req.uid) });
  } catch (err) {
    console.error('Error checking username uniqueness:', err.message);
    res.status(500).json({ error: 'Failed to check username' });
  }
});

router.put('/me', verifyAuth, verifyDesigner, async (req, res) => {
  try {
    const {
      full_name,
      contact,
      address,
      country,
      gender,
      dob,
      username,
      avatar_url,
      upi_id,
      paypal_id,
      description,
      bio,
      instagram,
      linkedin,
      terms_accepted,
      terms_accepted_at
    } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (contact !== undefined) updatePayload.contact = contact;
    if (address !== undefined) updatePayload.address = address;
    if (country !== undefined) updatePayload.country = country;
    if (gender !== undefined) updatePayload.gender = gender;
    if (dob !== undefined) updatePayload.dob = dob;
    if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;
    if (upi_id !== undefined) updatePayload.upi_id = upi_id;
    if (paypal_id !== undefined) updatePayload.paypal_id = paypal_id;
    if (description !== undefined) {
      updatePayload.description = description;
      updatePayload.bio = description;
    } else if (bio !== undefined) {
      updatePayload.bio = bio;
      updatePayload.description = bio;
    }
    if (instagram !== undefined) updatePayload.instagram = instagram;
    if (linkedin !== undefined) updatePayload.linkedin = linkedin;
    if (terms_accepted !== undefined) updatePayload.terms_accepted = terms_accepted;
    if (terms_accepted_at !== undefined) updatePayload.terms_accepted_at = terms_accepted_at;

    if (username !== undefined) {
      const trimmedUsername = username.trim().toLowerCase();
      // Verify username uniqueness
      const { data: existing } = await supabaseAdmin
        .from('designers')
        .select('id')
        .eq('username', trimmedUsername);

      const isUnique = !existing || existing.length === 0 || existing.every(d => d.id === req.uid);
      if (!isUnique) {
        return res.status(400).json({ error: 'Username already taken. Please choose another one.' });
      }
      updatePayload.username = trimmedUsername;
    }

    let { data, error } = await supabaseAdmin
      .from('designers')
      .update(updatePayload)
      .eq('id', req.uid)
      .select()
      .single();

    if (error && error.message && error.message.includes('column')) {
      // Column might not exist in table schema; strip unexisting columns and retry
      delete updatePayload.upi_id;
      delete updatePayload.paypal_id;
      delete updatePayload.description;
      delete updatePayload.instagram;
      delete updatePayload.linkedin;
      const retry = await supabaseAdmin
        .from('designers')
        .update(updatePayload)
        .eq('id', req.uid)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (err) {
    console.error('Error updating designer profile:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/designers/:id - Public details of a designer
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Support lookup by either id (UUID) or username
    const column = id.length === 36 ? 'id' : 'username';

    const { data, error } = await supabaseAdmin
      .from('designers')
      .select('id, username, full_name, avatar_url, designs_count, total_earnings, points, created_at, status')
      .eq(column, id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Designer not found' });
    }

    // Compute designer rank from leaderboard
    let rank = 1;
    try {
      const { data: rankings } = await supabaseAdmin
        .from('designers')
        .select('id, points, total_earnings')
        .order('points', { ascending: false });

      if (rankings && rankings.length > 0) {
        const idx = rankings.findIndex(d => d.id === data.id);
        if (idx !== -1) {
          rank = idx + 1;
        }
      }
    } catch (rErr) {
      console.error('Error calculating rank:', rErr.message);
    }

    res.json({
      ...data,
      rank,
      ranking: rank
    });
  } catch (err) {
    console.error('Error fetching public designer profile:', err.message);
    res.status(500).json({ error: 'Failed to fetch designer' });
  }
});

// PUT /api/designers/:id - Update specific designer (admin only)
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, full_name, username, points } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };
    if (status !== undefined) updatePayload.status = status;
    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (username !== undefined) updatePayload.username = username.trim().toLowerCase();
    if (points !== undefined) updatePayload.points = Number(points) || 0;

    const { data, error } = await supabaseAdmin
      .from('designers')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, designer: data });
  } catch (err) {
    console.error('Error updating designer status:', err.message);
    res.status(500).json({ error: 'Failed to update designer' });
  }
});

// GET /api/designers/:id/admin-details - Detailed stats for master admin
router.get('/:id/admin-details', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Parallel queries
    const [designerRes, walletRes, designsRes, ordersRes] = await Promise.all([
      supabaseAdmin.from('designers').select('*').eq('id', id).single(),
      supabaseAdmin.from('wallets').select('*').eq('id', id).maybeSingle(),
      supabaseAdmin.from('designs').select('id, title, status, price, created_at').eq('designer_id', id),
      supabaseAdmin.from('orders').select('*').eq('designer_id', id)
    ]);

    if (designerRes.error) throw designerRes.error;

    res.json({
      designer: designerRes.data,
      wallet: walletRes.data || { balance: 0, total_spent: 0, total_earnings: 0, total_withdrawn: 0 },
      designs: designsRes.data || [],
      orders: ordersRes.data || []
    });
  } catch (err) {
    console.error('Error fetching admin designer details:', err.message);
    res.status(500).json({ error: 'Failed to fetch designer details' });
  }
});

export default router;
