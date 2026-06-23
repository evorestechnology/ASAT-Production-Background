import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/tickets - Get own tickets (requires auth)
router.get('/', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .eq('user_id', req.uid)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching tickets:', err.message);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// GET /api/tickets/all - Get all tickets (admin only)
router.get('/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data: tickets, error } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    if (!tickets || tickets.length === 0) {
      return res.json([]);
    }

    const userIds = [...new Set(tickets.map(t => t.user_id))];

    // Fetch profiles from all tables in parallel
    const [usersRes, designersRes, mfgsRes] = await Promise.all([
      supabaseAdmin.from('users').select('id, full_name, email').in('id', userIds),
      supabaseAdmin.from('designers').select('id, username, full_name, email').in('id', userIds),
      supabaseAdmin.from('manufacturers').select('id, business_name, email').in('id', userIds)
    ]);

    const profileMap = {};

    usersRes.data?.forEach(u => {
      profileMap[u.id] = { username: u.full_name, email: u.email, role: 'user' };
    });

    designersRes.data?.forEach(d => {
      profileMap[d.id] = { username: d.username || d.full_name, email: d.email, role: 'designer' };
    });

    mfgsRes.data?.forEach(m => {
      profileMap[m.id] = { username: m.business_name, email: m.email, role: 'mfg' };
    });

    const enrichedTickets = tickets.map(t => ({
      ...t,
      user_profile: profileMap[t.user_id] || { username: 'Unknown', email: 'Unknown', role: 'user' }
    }));

    res.json(enrichedTickets);
  } catch (err) {
    console.error('Error fetching all tickets:', err.message);
    res.status(500).json({ error: 'Failed to fetch all tickets' });
  }
});

// POST /api/tickets - Create a new ticket (requires auth)
router.post('/', verifyAuth, async (req, res) => {
  try {
    const { subject, category, order_id, description } = req.body;
    if (!subject) {
      return res.status(400).json({ error: 'Subject is required.' });
    }

    // Resolve user's role for the ticket message
    let senderRole = 'user';
    const { data: admin } = await supabaseAdmin.from('admins').select('id').eq('id', req.uid).maybeSingle();
    if (admin) {
      senderRole = 'admin';
    } else {
      const { data: designer } = await supabaseAdmin.from('designers').select('id').eq('id', req.uid).maybeSingle();
      if (designer) {
        senderRole = 'designer';
      } else {
        const { data: mfg } = await supabaseAdmin.from('manufacturers').select('id').eq('id', req.uid).maybeSingle();
        if (mfg) {
          senderRole = 'mfg';
        }
      }
    }

    const { data: ticket, error } = await supabaseAdmin
      .from('tickets')
      .insert({
        user_id: req.uid,
        subject: subject.trim(),
        category: category || 'General Support',
        order_id: order_id || null,
        status: 'open',
        last_reply: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // If description is provided, insert it as the first message in ticket_messages
    if (description && description.trim()) {
      const { error: msgError } = await supabaseAdmin
        .from('ticket_messages')
        .insert({
          ticket_id: ticket.id,
          sender_id: req.uid,
          sender_role: senderRole,
          text: description.trim(),
          created_at: new Date().toISOString()
        });
      if (msgError) {
        console.error('Error inserting initial ticket description message:', msgError.message);
      }
    }

    res.json({ success: true, ticket });
  } catch (err) {
    console.error('Error creating ticket:', err.message);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// GET /api/tickets/:id/messages - Get ticket messages
router.get('/:id/messages', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user owns the ticket OR is admin
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from('tickets')
      .select('user_id')
      .eq('id', id)
      .single();

    if (ticketErr || !ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    if (req.role !== 'admin' && ticket.user_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to view this ticket.' });
    }

    const { data: messages, error } = await supabaseAdmin
      .from('ticket_messages')
      .select('*')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(messages || []);
  } catch (err) {
    console.error('Error fetching ticket messages:', err.message);
    res.status(500).json({ error: 'Failed to fetch ticket messages' });
  }
});

// POST /api/tickets/:id/messages - Send a message on ticket
router.post('/:id/messages', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text cannot be empty.' });
    }

    // Check if user owns the ticket OR is admin
    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from('tickets')
      .select('*')
      .eq('id', id)
      .single();

    if (ticketErr || !ticket) {
      return res.status(404).json({ error: 'Ticket not found.' });
    }

    if (req.role !== 'admin' && ticket.user_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to reply to this ticket.' });
    }

    const senderRole = req.role; // 'admin', 'designer', 'mfg', 'user'
    
    // Insert ticket message
    const { data: message, error } = await supabaseAdmin
      .from('ticket_messages')
      .insert({
        ticket_id: id,
        sender_id: req.uid,
        sender_role: senderRole,
        text: text.trim(),
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    // Update ticket's last reply role and updated_at
    const lastReply = senderRole === 'admin' ? 'admin' : 'user';
    await supabaseAdmin
      .from('tickets')
      .update({
        last_reply: lastReply,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    res.json({ success: true, message });
  } catch (err) {
    console.error('Error sending ticket message:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// PUT /api/tickets/:id - Update ticket status (admin only)
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assigned_to } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };

    if (status !== undefined) updatePayload.status = status;
    if (assigned_to !== undefined) updatePayload.assigned_to = assigned_to;

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, ticket: data });
  } catch (err) {
    console.error('Error updating ticket:', err.message);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

export default router;
