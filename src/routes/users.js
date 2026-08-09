import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole, verifyAdmin } from '../middleware/auth.js';
import { sendAdminInviteEmail } from '../utils/mailer.js';

const router = express.Router();

// GET /api/users/all - List all customer users (admin only)
router.get('/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error listing all users:', err.message);
    res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

// POST /api/users/register - Register customer user profile & initialize wallet
router.post('/register', async (req, res) => {
  try {
    const { id, fullName, email, password } = req.body;
    let finalId = id;
    
    // If password is provided, we need to create the user in Supabase Auth first
    if (password && email) {
      try {
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password: password,
          email_confirm: true // bypass email confirmation
        });
        if (authErr) throw authErr;
        finalId = authData.user.id;
      } catch (authErr) {
        if (authErr.code === 'email_exists' || authErr.message.includes('already been registered')) {
          return res.status(400).json({ error: 'A user with this email address already exists. Please sign in instead.' });
        }
        throw authErr;
      }
    }

    if (!finalId || !email) {
      return res.status(400).json({ error: 'User ID/Email required.' });
    }

    // 1. Insert user profile
    const { data: userProfile, error: profileErr } = await supabaseAdmin
      .from('users')
      .insert({
        id: finalId,
        full_name: fullName || '',
        email: email.trim().toLowerCase(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (profileErr) {
        if (profileErr.code !== '23505') { // ignore unique violation if already exists
            throw profileErr;
        }
    }

    // 2. Initialize wallet
    const { error: walletErr } = await supabaseAdmin
      .from('wallets')
      .insert({
        id: finalId,
        role: 'user',
        balance: 0,
        total_spent: 0,
        total_earnings: 0,
        total_withdrawn: 0
      });

    if (walletErr) {
        if (walletErr.code !== '23505') {
            console.error('Failed to initialize user wallet on register:', walletErr.message);
        }
    }

    res.json({ success: true, profile: userProfile });
  } catch (err) {
    console.error('Error registering user:', err.message);
    res.status(500).json({ error: err.message || 'Failed to register user profile.' });
  }
});

// GET /api/users/me - Get own profile (requires auth)
router.get('/me', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.uid)
      .maybeSingle();

    if (error) throw error;
    
    if (!data) {
      // If user profile is not found, return the role data resolved in resolveAnyRole
      return res.json(req.roleData || { id: req.uid, email: req.user.email });
    }
    
    res.json(data);
  } catch (err) {
    console.error('Error fetching user profile:', err.message);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// PUT /api/users/me - Update own profile (requires auth)
router.put('/me', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { full_name, phone, address, country, avatar_url } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (phone !== undefined) updatePayload.phone = phone;
    if (address !== undefined) updatePayload.address = address;
    if (country !== undefined) updatePayload.country = country;
    if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;

    // Determine table based on role
    const table = req.role === 'admin' ? 'admins' :
                  req.role === 'designer' ? 'designers' :
                  req.role === 'mfg' ? 'manufacturers' : 'users';

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(updatePayload)
      .eq('id', req.uid)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (err) {
    console.error('Error updating profile:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/users/addresses - Get user addresses
router.get('/addresses', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('user_addresses')
      .select('*')
      .eq('user_id', req.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching user addresses:', err.message);
    res.status(500).json({ error: 'Failed to fetch user addresses' });
  }
});

// POST /api/users/addresses - Add user address
router.post('/addresses', verifyAuth, async (req, res) => {
  try {
    const { label, full_name, phone, line1, line2, city, state, pincode, country, is_default } = req.body;

    if (!line1 || !city) {
      return res.status(400).json({ error: 'Address line 1 and city are required.' });
    }

    // Check if user has no addresses yet, make this one default
    const { count, error: countErr } = await supabaseAdmin
      .from('user_addresses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.uid);

    const makeDefault = countErr || count === 0 ? true : !!is_default;

    if (makeDefault) {
      // Unset other default addresses
      await supabaseAdmin
        .from('user_addresses')
        .update({ is_default: false })
        .eq('user_id', req.uid);
    }

    const { data, error } = await supabaseAdmin
      .from('user_addresses')
      .insert({
        user_id: req.uid,
        label: label || 'Home',
        full_name: full_name || '',
        phone: phone || '',
        line1,
        line2: line2 || '',
        city,
        state: state || '',
        pincode: pincode || '',
        country: country || 'India',
        is_default: makeDefault,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, address: data });
  } catch (err) {
    console.error('Error adding user address:', err.message);
    res.status(500).json({ error: 'Failed to add address' });
  }
});

// PUT /api/users/addresses/:id - Update user address
router.put('/addresses/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, full_name, phone, line1, line2, city, state, pincode, country, is_default } = req.body;

    // Verify ownership
    const { data: address, error: fetchErr } = await supabaseAdmin
      .from('user_addresses')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchErr || !address) {
      return res.status(404).json({ error: 'Address not found' });
    }

    if (address.user_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to update this address' });
    }

    if (is_default) {
      // Unset other default addresses
      await supabaseAdmin
        .from('user_addresses')
        .update({ is_default: false })
        .eq('user_id', req.uid);
    }

    const updatePayload = {};
    if (label !== undefined) updatePayload.label = label;
    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (phone !== undefined) updatePayload.phone = phone;
    if (line1 !== undefined) updatePayload.line1 = line1;
    if (line2 !== undefined) updatePayload.line2 = line2;
    if (city !== undefined) updatePayload.city = city;
    if (state !== undefined) updatePayload.state = state;
    if (pincode !== undefined) updatePayload.pincode = pincode;
    if (country !== undefined) updatePayload.country = country;
    if (is_default !== undefined) updatePayload.is_default = is_default;

    const { data, error } = await supabaseAdmin
      .from('user_addresses')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, address: data });
  } catch (err) {
    console.error('Error updating user address:', err.message);
    res.status(500).json({ error: 'Failed to update address' });
  }
});

// DELETE /api/users/addresses/:id - Delete user address
router.delete('/addresses/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const { data: address, error: fetchErr } = await supabaseAdmin
      .from('user_addresses')
      .select('user_id')
      .eq('id', id)
      .single();

    if (fetchErr || !address) {
      return res.status(404).json({ error: 'Address not found' });
    }

    if (address.user_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to delete this address' });
    }

    const { error } = await supabaseAdmin
      .from('user_addresses')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Address deleted successfully.' });
  } catch (err) {
    console.error('Error deleting user address:', err.message);
    res.status(500).json({ error: 'Failed to delete address' });
  }
});

// GET /api/users/admins — list all admins (admin only)
router.get('/admins', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('admins')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching admins:', err.message);
    res.status(500).json({ error: 'Failed to fetch admins' });
  }
});

// PUT /api/users/admins/:id — disable/update admin (admin only)
router.put('/admins/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const { data, error } = await supabaseAdmin
      .from('admins')
      .update({ active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, admin: data });
  } catch (err) {
    console.error('Error updating admin status:', err.message);
    res.status(500).json({ error: 'Failed to update admin status' });
  }
});

// POST /api/users/admins/invite — invite an admin (admin only)
router.post('/admins/invite', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { email, role, display_name } = req.body;
    if (!email || !display_name) {
      return res.status(400).json({ error: 'Email and Display Name are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = display_name.trim();
    const cleanRole = role || 'support';

    // 1. Record the invite in admin_invites table (if table exists)
    let inviteRecord = null;
    try {
      const { data: inviteData, error: inviteErr } = await supabaseAdmin
        .from('admin_invites')
        .upsert({
          email: cleanEmail,
          role: cleanRole,
          display_name: cleanName,
          status: 'pending',
          created_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (!inviteErr) {
        inviteRecord = inviteData;
      }
    } catch (e) {
      console.warn('Notice: admin_invites table not available or insert skipped:', e.message);
    }

    // 2. Trigger Supabase Auth Invite
    let authUser = null;
    try {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        cleanEmail,
        {
          data: {
            full_name: cleanName,
            role: 'admin',
            admin_role: cleanRole
          }
        }
      );

      if (authErr) {
        // If user already exists in auth, find existing user
        console.warn('inviteUserByEmail note:', authErr.message);
        const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
        const existing = listData?.users?.find(u => u.email?.toLowerCase() === cleanEmail);
        if (existing) {
          authUser = existing;
        }
      } else {
        authUser = authData.user;
        console.log(`✅ Supabase Auth invitation dispatched for ${cleanEmail}`);
      }
    } catch (authException) {
      console.warn('Supabase Auth invite error:', authException.message);
    }

    // 3. Upsert admin record in public.admins if user ID is known
    if (authUser?.id) {
      await supabaseAdmin.from('admins').upsert({
        id: authUser.id,
        email: cleanEmail,
        full_name: cleanName,
        created_at: new Date().toISOString()
      });
    }

    // 4. Send branded email notification
    try {
      await sendAdminInviteEmail(cleanEmail, cleanName, cleanRole);
    } catch (emailErr) {
      console.warn('Email notification warning:', emailErr.message);
    }

    res.json({
      success: true,
      message: `Invitation successfully sent to ${cleanEmail}`,
      invite: inviteRecord || { email: cleanEmail, role: cleanRole, display_name: cleanName }
    });
  } catch (err) {
    console.error('Error inviting admin:', err.message);
    res.status(500).json({ error: err.message || 'Failed to invite admin' });
  }
});

export default router;
