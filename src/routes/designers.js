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
  try {
    const designer = { ...req.designerData };
    let meta = req.user?.user_metadata;
    if (!meta) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(req.uid);
      meta = userData?.user?.user_metadata || {};
    }
    designer.bio = meta.bio || meta.description || designer.bio || '';
    designer.description = meta.bio || meta.description || designer.description || '';
    designer.instagram = meta.instagram || designer.instagram || '';
    designer.linkedin = meta.linkedin || designer.linkedin || '';
    designer.upi_id = meta.upi_id || designer.upi_id || '';
    designer.paypal_id = meta.paypal_id || designer.paypal_id || '';
    res.json(designer);
  } catch (err) {
    res.json(req.designerData);
  }
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

    // Try updating physical columns in designers table
    let { data, error } = await supabaseAdmin
      .from('designers')
      .update(updatePayload)
      .eq('id', req.uid)
      .select()
      .single();

    if (error) throw error;

    // Save bio, instagram, linkedin, upi_id, paypal_id into auth user_metadata
    try {
      const userMetaUpdate = {};
      const finalBio = description !== undefined ? description : bio;
      if (finalBio !== undefined) {
        userMetaUpdate.bio = finalBio;
        userMetaUpdate.description = finalBio;
      }
      if (instagram !== undefined) userMetaUpdate.instagram = instagram;
      if (linkedin !== undefined) userMetaUpdate.linkedin = linkedin;
      if (upi_id !== undefined) userMetaUpdate.upi_id = upi_id;
      if (paypal_id !== undefined) userMetaUpdate.paypal_id = paypal_id;
      if (full_name !== undefined) userMetaUpdate.full_name = full_name;

      if (Object.keys(userMetaUpdate).length > 0) {
        const { data: userCurrent } = await supabaseAdmin.auth.admin.getUserById(req.uid);
        const existingMeta = userCurrent?.user?.user_metadata || {};
        await supabaseAdmin.auth.admin.updateUserById(req.uid, {
          user_metadata: { ...existingMeta, ...userMetaUpdate }
        });
      }
    } catch (metaErr) {
      console.warn('Could not update designer user_metadata:', metaErr.message);
    }

    res.json({
      success: true,
      profile: {
        ...data,
        bio: bio !== undefined ? bio : description,
        description: description !== undefined ? description : bio,
        instagram,
        linkedin,
        upi_id,
        paypal_id
      }
    });
  } catch (err) {
    console.error('Error updating designer profile:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/designers/:id - Public details of a designer
router.get('/:id', async (req, res) => {
  try {
    const rawId = req.params.id;
    if (!rawId || rawId === 'undefined' || rawId === 'null') {
      return res.status(404).json({ error: 'Designer not found' });
    }

    let clean = decodeURIComponent(rawId).trim();
    if (clean.startsWith('@')) clean = clean.substring(1).trim();

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    let data = null;

    // 1. If valid UUID, search by ID first
    if (uuidRegex.test(clean)) {
      const { data: byId } = await supabaseAdmin
        .from('designers')
        .select('id, username, full_name, avatar_url, designs_count, total_earnings, points, created_at, status, address, contact, country')
        .eq('id', clean)
        .maybeSingle();

      if (byId) data = byId;
    }

    // 2. Search case-insensitively by username
    if (!data) {
      const { data: byUsername } = await supabaseAdmin
        .from('designers')
        .select('id, username, full_name, avatar_url, designs_count, total_earnings, points, created_at, status, address, contact, country')
        .ilike('username', clean)
        .maybeSingle();

      if (byUsername) data = byUsername;
    }

    // 3. Fallback search by full_name
    if (!data) {
      const { data: byName } = await supabaseAdmin
        .from('designers')
        .select('id, username, full_name, avatar_url, designs_count, total_earnings, points, created_at, status, address, contact, country')
        .ilike('full_name', clean)
        .maybeSingle();

      if (byName) data = byName;
    }

    if (!data) {
      return res.status(404).json({ error: 'Designer not found' });
    }

    // Retrieve bio, instagram, linkedin, speciality from auth user metadata
    let bio = '';
    let instagram = '';
    let linkedin = '';
    let speciality = '';
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(data.id);
      if (userData?.user?.user_metadata) {
        const meta = userData.user.user_metadata;
        bio = meta.bio || meta.description || '';
        instagram = meta.instagram || '';
        linkedin = meta.linkedin || '';
        speciality = meta.speciality || '';
      }
    } catch (uErr) {
      console.warn('Could not fetch user metadata for designer:', uErr.message);
    }

    // Fallback: parse legacy address notes if bio/socials are empty
    if (data.address && typeof data.address === 'string') {
      const parts = data.address.split(' | ');
      parts.forEach(part => {
        if (!bio && part.startsWith('Bio: ')) {
          bio = part.replace('Bio: ', '').trim();
        }
        if (!instagram && part.startsWith('IG: ')) {
          instagram = part.replace('IG: ', '').trim();
        }
        if (!linkedin && part.startsWith('IN: ')) {
          linkedin = part.replace('IN: ', '').trim();
        }
      });
      // Sanitize address for public view by removing internal notes
      data.address = parts[0].replace(/^@\s*/, '').trim();
    }

    // Fallback if instagram is still empty: use designer's username
    if (!instagram && data.username) {
      instagram = data.username;
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
      bio: bio,
      description: bio,
      instagram,
      linkedin,
      speciality: speciality,
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
