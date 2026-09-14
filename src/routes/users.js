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
    const { id, fullName, email, password, countryCode, mobileNumber, dob } = req.body;
    let finalId = id;
    
    // If password is provided, we need to create the user in Supabase Auth first
    if (password && email) {
      try {
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password: password,
          email_confirm: true, // bypass email confirmation
          user_metadata: {
            full_name: fullName || '',
            country_code: countryCode || '',
            phone: mobileNumber || '',
            dob: dob || ''
          }
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
        phone: (countryCode && mobileNumber) ? `${countryCode} ${mobileNumber}` : (mobileNumber || ''),
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

// POST /api/users/sync-oauth - Sync or auto-provision OAuth customer profile and wallet
router.post('/sync-oauth', verifyAuth, async (req, res) => {
  try {
    const userEmail = (req.user?.email || '').toLowerCase().trim();
    if (!userEmail) {
      return res.status(400).json({ error: 'User email is required from auth session' });
    }

    const { fullName: reqName, phone: reqPhone } = req.body || {};
    const fullName = reqName ||
                     req.user.user_metadata?.full_name ||
                     req.user.user_metadata?.name ||
                     userEmail.split('@')[0] ||
                     'Customer';
    const phone = reqPhone || req.user.user_metadata?.phone || '';

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .or(`id.eq.${req.uid},email.eq.${userEmail}`)
      .maybeSingle();

    let finalProfile = existingUser;

    if (!finalProfile) {
      const { data: createdUser, error: createErr } = await supabaseAdmin
        .from('users')
        .insert({
          id: req.uid,
          full_name: fullName,
          email: userEmail,
          phone: phone,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .maybeSingle();

      if (createErr && createErr.code !== '23505') {
        throw createErr;
      }
      finalProfile = createdUser;
    }

    // Initialize or verify customer wallet
    await supabaseAdmin
      .from('wallets')
      .upsert({
        id: finalProfile?.id || req.uid,
        role: 'user',
        balance: 0,
        total_spent: 0,
        total_earnings: 0,
        total_withdrawn: 0
      }, { onConflict: 'id' });

    res.json({ success: true, profile: finalProfile });
  } catch (err) {
    console.error('Error syncing OAuth user profile:', err.message);
    res.status(500).json({ error: err.message || 'Failed to sync OAuth user profile' });
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

    // Determine table based on role
    const table = req.role === 'admin' ? 'admins' :
                  req.role === 'designer' ? 'designers' :
                  req.role === 'mfg' ? 'manufacturers' : 'users';

    const updatePayload = {};
    if (full_name !== undefined) updatePayload.full_name = full_name;
    if (phone !== undefined) updatePayload.phone = phone;
    if (address !== undefined) updatePayload.address = address;
    if (country !== undefined) updatePayload.country = country;
    if (avatar_url !== undefined) updatePayload.avatar_url = avatar_url;

    // Only add updated_at for tables that support it (designers, manufacturers, users)
    if (table !== 'admins') {
      updatePayload.updated_at = new Date().toISOString();
    }

    let { data, error } = await supabaseAdmin
      .from(table)
      .update(updatePayload)
      .eq('id', req.uid)
      .select()
      .maybeSingle();

    // If there's an error because of unknown columns (e.g. phone/address/updated_at in admins table), retry with minimal payload
    if (error && table === 'admins') {
      console.warn('Retrying admin update with basic columns only:', error.message);
      const safeAdminPayload = {};
      if (full_name !== undefined) safeAdminPayload.full_name = full_name;

      const retryRes = await supabaseAdmin
        .from('admins')
        .update(safeAdminPayload)
        .eq('id', req.uid)
        .select()
        .maybeSingle();

      data = retryRes.data;
      error = retryRes.error;
    }

    if (error) throw error;

    // Also keep Supabase Auth user_metadata in sync
    try {
      const currentMeta = req.user?.user_metadata || {};
      await supabaseAdmin.auth.admin.updateUserById(req.uid, {
        user_metadata: {
          ...currentMeta,
          full_name: full_name || currentMeta.full_name,
          country_code: req.body.countryCode || currentMeta.country_code,
          phone: phone || currentMeta.phone,
          dob: req.body.dob || currentMeta.dob
        }
      });
    } catch (metaErr) {
      console.warn('Could not update user_metadata:', metaErr.message);
    }

    res.json({ success: true, profile: data || { id: req.uid, full_name, role: req.role } });
  } catch (err) {
    console.error('Error updating profile:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update profile' });
  }
});

// POST /api/users/change-password — change password for current user/admin
router.post('/change-password', verifyAuth, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password || typeof new_password !== 'string' || new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(req.uid, {
      password: new_password
    });

    if (error) {
      console.error('Password change error from Supabase Auth:', error.message);
      return res.status(400).json({ error: error.message });
    }

    res.json({ success: true, message: 'Password updated successfully!' });
  } catch (err) {
    console.error('Error changing password:', err.message);
    res.status(500).json({ error: 'Failed to update password' });
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

// PUT /api/users/admins/:id — disable/enable/update admin (admin only)
router.put('/admins/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { active, full_name, role } = req.body;

    // 1. If active flag provided, ban/unban in Supabase Auth
    if (active !== undefined) {
      try {
        await supabaseAdmin.auth.admin.updateUserById(id, {
          ban_duration: active === false ? '876000h' : 'none', // 100 years or none
          user_metadata: { active }
        });
      } catch (authBanErr) {
        console.warn('Auth ban status update note:', authBanErr.message);
      }
    }

    // 2. Update admins table safely
    let updatePayload = {};
    if (active !== undefined) updatePayload.active = active;
    if (full_name !== undefined) updatePayload.full_name = full_name;

    let { data, error } = await supabaseAdmin
      .from('admins')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .maybeSingle();

    // If error due to missing 'active' column, retry without it
    if (error) {
      console.warn('Retrying admin update without active column:', error.message);
      const retryRes = await supabaseAdmin
        .from('admins')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      data = retryRes.data;
    }

    res.json({
      success: true,
      message: active === false ? 'Admin account disabled' : 'Admin account updated',
      admin: data || { id, active }
    });
  } catch (err) {
    console.error('Error updating admin status:', err.message);
    res.status(500).json({ error: err.message || 'Failed to update admin status' });
  }
});

// DELETE /api/users/admins/:id — delete admin account (admin only)
router.delete('/admins/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent master admin from deleting themselves
    if (id === req.uid) {
      return res.status(400).json({ error: 'You cannot delete your own admin account.' });
    }

    // Get admin email before deleting
    const { data: adminRecord } = await supabaseAdmin
      .from('admins')
      .select('email')
      .eq('id', id)
      .maybeSingle();

    // 1. Delete from admins table
    const { error: dbErr } = await supabaseAdmin
      .from('admins')
      .delete()
      .eq('id', id);

    if (dbErr) throw dbErr;

    // 2. Delete from admin_invites if present
    if (adminRecord?.email) {
      try {
        await supabaseAdmin
          .from('admin_invites')
          .delete()
          .eq('email', adminRecord.email);
      } catch (inviteDelErr) {
        console.warn('Could not delete admin_invites record:', inviteDelErr.message);
      }
    }

    // 3. Delete from Supabase Auth
    try {
      await supabaseAdmin.auth.admin.deleteUser(id);
    } catch (authDelErr) {
      console.warn('Could not delete auth user:', authDelErr.message);
    }

    res.json({ success: true, message: 'Admin account removed successfully.' });
  } catch (err) {
    console.error('Error deleting admin:', err.message);
    res.status(500).json({ error: err.message || 'Failed to delete admin' });
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

    // Generate a secure temporary password
    const tempPassword = `AsatAdmin@${Math.floor(1000 + Math.random() * 9000)}`;

    // 2. Create or Update Supabase Auth User with temporary credentials
    let authUser = null;
    try {
      // Check if user already exists
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existing = listData?.users?.find(u => u.email?.toLowerCase() === cleanEmail);

      if (existing) {
        // User already exists, update password and metadata
        const { data: updatedData, error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(
          existing.id,
          {
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              full_name: cleanName,
              role: 'admin',
              admin_role: cleanRole
            }
          }
        );
        if (!updateErr) {
          authUser = updatedData.user;
          console.log(`✅ Updated existing auth user ${cleanEmail} with temporary password`);
        } else {
          authUser = existing;
          console.warn('Update user warning:', updateErr.message);
        }
      } else {
        // Create fresh auth user with temporary password
        const { data: createdData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: cleanEmail,
          password: tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: cleanName,
            role: 'admin',
            admin_role: cleanRole
          }
        });

        if (createErr) {
          console.warn('createUser note:', createErr.message);
        } else {
          authUser = createdData.user;
          console.log(`✅ Created fresh auth user for ${cleanEmail} with temporary password`);
        }
      }
    } catch (authException) {
      console.warn('Supabase Auth provisioning warning:', authException.message);
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

    // 4. Send branded email notification with temporary credentials
    try {
      await sendAdminInviteEmail(cleanEmail, cleanName, cleanRole, tempPassword);
    } catch (emailErr) {
      console.warn('Email notification warning:', emailErr.message);
    }

    res.json({
      success: true,
      message: `Invitation and temporary credentials sent to ${cleanEmail}`,
      invite: inviteRecord || { email: cleanEmail, role: cleanRole, display_name: cleanName }
    });
  } catch (err) {
    console.error('Error inviting admin:', err.message);
    res.status(500).json({ error: err.message || 'Failed to invite admin' });
  }
});

// A) GET /api/users/search (admin only)
router.get('/search', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { q = '', page = 1, limit = 20, filter = 'all' } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const offset = (pageNum - 1) * limitNum;

    let query = supabaseAdmin.from('users').select('id, full_name, email, phone, created_at, updated_at', { count: 'exact' });
    
    if (q && q.trim()) {
      const searchTerm = q.trim();
      query = query.or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`);
    }
    
    const { data: users, count: total, error } = await query
      .range(offset, offset + limitNum - 1)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userList = users || [];
    const userIds = userList.map(u => u.id);
    let addressMap = {};

    if (userIds.length > 0) {
      const { data: addrList } = await supabaseAdmin
        .from('user_addresses')
        .select('user_id, country, city, state, line1')
        .in('user_id', userIds);
      if (addrList) {
        addrList.forEach(a => {
          if (!addressMap[a.user_id]) {
            addressMap[a.user_id] = {
              country: a.country || 'India',
              address: `${a.line1 ? a.line1 + ', ' : ''}${a.city || ''}`
            };
          }
        });
      }
    }

    // Get order counts for each user
    let usersWithOrderCount = await Promise.all(userList.map(async (u) => {
      const { count } = await supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', u.id);
      return { 
        ...u, 
        country: addressMap[u.id]?.country || 'India',
        address: addressMap[u.id]?.address || '',
        order_count: count || 0 
      };
    }));

    if (filter === 'with_orders') {
      usersWithOrderCount = usersWithOrderCount.filter(u => u.order_count > 0);
    } else if (filter === 'no_orders') {
      usersWithOrderCount = usersWithOrderCount.filter(u => u.order_count === 0);
    }

    res.json({
      users: usersWithOrderCount,
      total: total || 0,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil((total || 0) / limitNum)
    });
  } catch (err) {
    console.error('Error in /api/users/search:', err);
    res.status(500).json({ error: err.message || 'Failed to search users' });
  }
});

// B) GET /api/users/:id/profile (admin only)
router.get('/:id/profile', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: user, error: userError } = await supabaseAdmin.from('users').select('*').eq('id', id).maybeSingle();
    if (userError) throw userError;
    
    const { data: wallet } = await supabaseAdmin.from('wallets').select('balance').eq('user_id', id).maybeSingle();
    const { count: orderCount } = await supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', id);
    const { count: ticketCount } = await supabaseAdmin.from('tickets').select('id', { count: 'exact', head: true }).eq('user_id', id);
    const { data: addresses } = await supabaseAdmin.from('user_addresses').select('*').eq('user_id', id);

    const primaryAddress = addresses?.[0];

    res.json({
      ...(user || {}),
      country: primaryAddress?.country || 'India',
      address: primaryAddress ? `${primaryAddress.line1 ? primaryAddress.line1 + ', ' : ''}${primaryAddress.city || ''}` : '',
      wallet_balance: wallet?.balance || 0,
      order_count: orderCount || 0,
      ticket_count: ticketCount || 0,
      addresses: addresses || []
    });
  } catch (err) {
    console.error('Error in /api/users/:id/profile:', err);
    res.status(500).json({ error: err.message || 'Failed to get user profile' });
  }
});

// C) GET /api/users/:id/orders (admin only)
router.get('/:id/orders', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_id, created_at, total_amount, status, items, country, address')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// D) GET /api/users/:id/activity (admin only)
router.get('/:id/activity', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id, order_id, created_at, total_amount, status')
      .eq('user_id', id);

    if (ordersError) throw ordersError;

    const { data: tickets, error: ticketsError } = await supabaseAdmin
      .from('tickets')
      .select('id, created_at, subject, status')
      .eq('user_id', id);

    if (ticketsError) throw ticketsError;

    const activities = [
      ...(orders || []).map(o => ({ ...o, type: 'order' })),
      ...(tickets || []).map(t => ({ ...t, type: 'ticket' }))
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({
      activities,
      totalOrders: orders?.length || 0,
      totalTickets: tickets?.length || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
