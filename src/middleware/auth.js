import { supabaseAdmin } from '../supabaseAdmin.js';

// Middleware to verify Supabase JWT
export async function verifyAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  const token = header.split('Bearer ')[1];
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.uid = user.id;
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware to verify Admin role
export async function verifyAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('admins')
      .select('*')
      .eq('id', req.uid)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.adminData = data;
    req.role = 'admin';
    next();
  } catch (err) {
    console.error('Admin check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify admin access' });
  }
}

// Middleware to verify Designer role
export async function verifyDesigner(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('designers')
      .select('*')
      .eq('id', req.uid)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'Designer access required' });
    }
    req.designerData = data;
    req.role = 'designer';
    next();
  } catch (err) {
    console.error('Designer check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify designer access' });
  }
}

// Middleware to verify Manufacturer role
export async function verifyMfg(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .select('*')
      .eq('id', req.uid)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'Manufacturer access required' });
    }
    req.mfgData = data;
    req.role = 'mfg';
    next();
  } catch (err) {
    console.error('Mfg check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify manufacturer access' });
  }
}

// Middleware to verify User/Customer role
export async function verifyUser(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.uid)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: 'User access required' });
    }
    req.userData = data;
    req.role = 'user';
    next();
  } catch (err) {
    console.error('User check failed:', err.message);
    return res.status(500).json({ error: 'Failed to verify user access' });
  }
}

// Middleware to verify ANY valid role and resolve it (useful for dashboard, wallets, profile pages)
export async function resolveAnyRole(req, res, next) {
  try {
    const uid = req.uid;
    // Check admin
    const { data: admin } = await supabaseAdmin.from('admins').select('*').eq('id', uid).maybeSingle();
    if (admin) {
      req.role = 'admin';
      req.roleData = admin;
      return next();
    }
    // Check designer
    const { data: designer } = await supabaseAdmin.from('designers').select('*').eq('id', uid).maybeSingle();
    if (designer) {
      req.role = 'designer';
      req.roleData = designer;
      return next();
    }
    // Check mfg
    const { data: mfg } = await supabaseAdmin.from('manufacturers').select('*').eq('id', uid).maybeSingle();
    if (mfg) {
      req.role = 'mfg';
      req.roleData = mfg;
      return next();
    }
    // Check user
    const { data: user } = await supabaseAdmin.from('users').select('*').eq('id', uid).maybeSingle();
    if (user) {
      req.role = 'user';
      req.roleData = user;
      return next();
    }

    return res.status(403).json({ error: 'No registered profile found for this user.' });
  } catch (err) {
    console.error('Role resolution failed:', err.message);
    return res.status(500).json({ error: 'Failed to resolve user role' });
  }
}
