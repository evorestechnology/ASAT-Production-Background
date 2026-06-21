-- ══════════════════════════════════════════════════════════════
-- ASAT Database Schema for Supabase (PostgreSQL)
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════

-- ─── CORE TABLES ────────────────────────────────────────────

-- Users
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- User Addresses
CREATE TABLE IF NOT EXISTS user_addresses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT,
  full_name  TEXT,
  phone      TEXT,
  line1      TEXT NOT NULL,
  line2      TEXT,
  city       TEXT NOT NULL,
  state      TEXT,
  pincode    TEXT,
  country    TEXT DEFAULT 'India',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Admins
CREATE TABLE IF NOT EXISTS admins (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT UNIQUE NOT NULL,
  full_name  TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Designers
CREATE TABLE IF NOT EXISTS designers (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  email           TEXT UNIQUE NOT NULL,
  username        TEXT UNIQUE NOT NULL,
  contact         TEXT,
  country_code    TEXT,
  gender          TEXT,
  dob             DATE,
  address         TEXT,
  country         TEXT,
  avatar_url      TEXT,
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','suspended','blocked')),
  designs_count   INT DEFAULT 0,
  total_earnings  NUMERIC(12,2) DEFAULT 0,
  points          INT DEFAULT 0,
  rank            INT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Manufacturers
CREATE TABLE IF NOT EXISTS manufacturers (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT,
  email         TEXT UNIQUE NOT NULL,
  contact       TEXT,
  address       TEXT,
  gst           TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE,
  name        TEXT NOT NULL,
  image       TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Catalogue (base products/garment types)
CREATE TABLE IF NOT EXISTS catalogue (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT,
  base_price       NUMERIC(10,2),
  sizes            JSONB DEFAULT '[]',
  colors           JSONB DEFAULT '[]',
  size_chart_image TEXT,
  image            TEXT,
  active           BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Products (manufacturer products)
CREATE TABLE IF NOT EXISTS products (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  category         TEXT,
  cost             NUMERIC(10,2) NOT NULL,
  gender           TEXT,
  cover_image      TEXT,
  colors           JSONB DEFAULT '[]',
  printing_styles  JSONB DEFAULT '[]',
  size_chart_image TEXT,
  sizes            JSONB DEFAULT '[]',
  mfg_id           UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  mfg_name         TEXT,
  available        BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Designs (designer uploads)
CREATE TABLE IF NOT EXISTS designs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT NOT NULL,
  description       TEXT,
  price             NUMERIC(10,2) NOT NULL,
  catalogue_item_id UUID REFERENCES catalogue(id),
  designer_id       UUID NOT NULL REFERENCES designers(id),
  designer_username TEXT,
  images            JSONB DEFAULT '[]',
  colors            JSONB DEFAULT '[]',
  sizes             JSONB DEFAULT '[]',
  gender            TEXT CHECK (gender IN ('male','female','unisex')),
  status            TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','restricted','active')),
  collection        TEXT,
  orders_count      INT DEFAULT 0,
  total_earnings    NUMERIC(12,2) DEFAULT 0,
  reviewed_by       UUID,
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           TEXT UNIQUE NOT NULL,
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name      TEXT,
  items              JSONB DEFAULT '[]',
  total_amount       NUMERIC(12,2) NOT NULL,
  designer_earnings  NUMERIC(12,2) DEFAULT 0,
  mfg_earnings       NUMERIC(12,2) DEFAULT 0,
  platform_earnings  NUMERIC(12,2) DEFAULT 0,
  designer_id        UUID REFERENCES designers(id) ON DELETE SET NULL,
  designer_username  TEXT,
  mfg_id             UUID REFERENCES manufacturers(id) ON DELETE SET NULL,
  status             TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','manufacturing','shipping','completed')),
  contact            TEXT,
  phone              TEXT,
  address            TEXT,
  country            TEXT,
  tracking_id        TEXT,
  status_history     JSONB DEFAULT '[]',
  shipped_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Wallets
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','designer','mfg')),
  balance         NUMERIC(12,2) DEFAULT 0,
  total_spent     NUMERIC(12,2) DEFAULT 0,
  total_earnings  NUMERIC(12,2) DEFAULT 0,
  total_withdrawn NUMERIC(12,2) DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Withdrawals
CREATE TABLE IF NOT EXISTS withdrawals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES wallets(id),
  username     TEXT,
  role         TEXT CHECK (role IN ('designer','mfg')),
  amount       NUMERIC(12,2) NOT NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  processed_at TIMESTAMPTZ,
  processed_by UUID,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Tickets
CREATE TABLE IF NOT EXISTS tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  subject     TEXT NOT NULL,
  category    TEXT,
  order_id    TEXT,
  status      TEXT DEFAULT 'open',
  last_reply  TEXT DEFAULT 'user',
  assigned_to UUID,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Ticket Messages
CREATE TABLE IF NOT EXISTS ticket_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL,
  sender_role TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- OTPs (temporary)
CREATE TABLE IF NOT EXISTS otps (
  email      TEXT PRIMARY KEY,
  otp        TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Settings (key-value store)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Print Styles (manufacturer uploaded print styles)
CREATE TABLE IF NOT EXISTS print_styles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mfg_id      UUID NOT NULL REFERENCES manufacturers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  image       TEXT,
  active      BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);


-- ═══════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_designs_designer      ON designs(designer_id);
CREATE INDEX IF NOT EXISTS idx_designs_status         ON designs(status);
CREATE INDEX IF NOT EXISTS idx_designs_catalogue      ON designs(catalogue_item_id);
CREATE INDEX IF NOT EXISTS idx_designs_gender         ON designs(gender);
CREATE INDEX IF NOT EXISTS idx_orders_user            ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_designer        ON orders(designer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_id        ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user       ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_user           ON tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_msgs_ticket     ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user    ON user_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_designers_username     ON designers(username);
CREATE INDEX IF NOT EXISTS idx_designers_status       ON designers(status);
CREATE INDEX IF NOT EXISTS idx_designers_points       ON designers(points DESC);
CREATE INDEX IF NOT EXISTS idx_print_styles_mfg       ON print_styles(mfg_id);
CREATE INDEX IF NOT EXISTS idx_products_mfg           ON products(mfg_id);
CREATE INDEX IF NOT EXISTS idx_products_available     ON products(available);


-- ═══════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════

INSERT INTO settings (key, value) VALUES
  ('earnings', '{"designer": 30, "mfg": 40, "platform": 30}')
ON CONFLICT (key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ═══════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_addresses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins          ENABLE ROW LEVEL SECURITY;
ALTER TABLE designers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE manufacturers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE designs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE otps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE print_styles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE products        ENABLE ROW LEVEL SECURITY;

-- ─── Users ───
DROP POLICY IF EXISTS "Users can read own profile" ON users;
CREATE POLICY "Users can read own profile"    ON users FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update own profile" ON users;
CREATE POLICY "Users can update own profile"  ON users FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can insert own profile" ON users;
CREATE POLICY "Users can insert own profile"  ON users FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins full access to users" ON users;
CREATE POLICY "Admins full access to users"   ON users FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── User Addresses ───
DROP POLICY IF EXISTS "Users manage own addresses" ON user_addresses;
CREATE POLICY "Users manage own addresses"  ON user_addresses FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins read all addresses" ON user_addresses;
CREATE POLICY "Admins read all addresses"   ON user_addresses FOR SELECT USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Admins ───
DROP POLICY IF EXISTS "Admins can read own profile" ON admins;
CREATE POLICY "Admins can read own profile" ON admins FOR SELECT USING (auth.uid() = id);

-- ─── Designers ───
DROP POLICY IF EXISTS "Public read active designers" ON designers;
CREATE POLICY "Public read active designers"     ON designers FOR SELECT USING (status = 'active');
DROP POLICY IF EXISTS "Designers can read own profile" ON designers;
CREATE POLICY "Designers can read own profile"   ON designers FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Designers can update own profile" ON designers;
CREATE POLICY "Designers can update own profile" ON designers FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Designers can insert own profile" ON designers;
CREATE POLICY "Designers can insert own profile" ON designers FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins full access designers" ON designers;
CREATE POLICY "Admins full access designers"     ON designers FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Manufacturers ───
DROP POLICY IF EXISTS "Mfg can read own profile" ON manufacturers;
CREATE POLICY "Mfg can read own profile"   ON manufacturers FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Mfg can update own profile" ON manufacturers;
CREATE POLICY "Mfg can update own profile" ON manufacturers FOR UPDATE USING (auth.uid() = id);
DROP POLICY IF EXISTS "Mfg can insert own profile" ON manufacturers;
CREATE POLICY "Mfg can insert own profile" ON manufacturers FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins full access mfg" ON manufacturers;
CREATE POLICY "Admins full access mfg"     ON manufacturers FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Categories ───
DROP POLICY IF EXISTS "Anyone can read categories" ON categories;
CREATE POLICY "Anyone can read categories" ON categories FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage categories" ON categories;
CREATE POLICY "Admins manage categories"   ON categories FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Catalogue ───
DROP POLICY IF EXISTS "Anyone can read active catalogue" ON catalogue;
CREATE POLICY "Anyone can read active catalogue" ON catalogue FOR SELECT USING (active = true);
DROP POLICY IF EXISTS "Admins full access catalogue" ON catalogue;
CREATE POLICY "Admins full access catalogue"     ON catalogue FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);
DROP POLICY IF EXISTS "Mfg can read catalogue" ON catalogue;
CREATE POLICY "Mfg can read catalogue"          ON catalogue FOR SELECT USING (
  EXISTS (SELECT 1 FROM manufacturers WHERE id = auth.uid())
);

-- ─── Products ───
DROP POLICY IF EXISTS "Anyone can read active products" ON products;
CREATE POLICY "Anyone can read active products" ON products FOR SELECT USING (available = true);
DROP POLICY IF EXISTS "Mfg can manage own products" ON products;
CREATE POLICY "Mfg can manage own products"     ON products FOR ALL USING (auth.uid() = mfg_id);
DROP POLICY IF EXISTS "Admins full access products" ON products;
CREATE POLICY "Admins full access products"     ON products FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Designs ───
DROP POLICY IF EXISTS "Public read approved designs" ON designs;
CREATE POLICY "Public read approved designs"     ON designs FOR SELECT USING (status = 'approved');
DROP POLICY IF EXISTS "Designers read own designs" ON designs;
CREATE POLICY "Designers read own designs"       ON designs FOR SELECT USING (auth.uid() = designer_id);
DROP POLICY IF EXISTS "Designers insert own designs" ON designs;
CREATE POLICY "Designers insert own designs"     ON designs FOR INSERT WITH CHECK (auth.uid() = designer_id);
DROP POLICY IF EXISTS "Designers update own designs" ON designs;
CREATE POLICY "Designers update own designs"     ON designs FOR UPDATE USING (auth.uid() = designer_id);
DROP POLICY IF EXISTS "Admins full access designs" ON designs;
CREATE POLICY "Admins full access designs"       ON designs FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);
DROP POLICY IF EXISTS "Mfg read approved designs" ON designs;
CREATE POLICY "Mfg read approved designs"        ON designs FOR SELECT USING (
  EXISTS (SELECT 1 FROM manufacturers WHERE id = auth.uid()) AND status = 'approved'
);

-- ─── Orders ───
DROP POLICY IF EXISTS "Users read own orders" ON orders;
CREATE POLICY "Users read own orders"        ON orders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert orders" ON orders;
CREATE POLICY "Users insert orders"          ON orders FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Designers read own orders" ON orders;
CREATE POLICY "Designers read own orders"    ON orders FOR SELECT USING (auth.uid() = designer_id);
DROP POLICY IF EXISTS "Admins full access orders" ON orders;
CREATE POLICY "Admins full access orders"    ON orders FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);
DROP POLICY IF EXISTS "Mfg read and update orders" ON orders;
CREATE POLICY "Mfg read and update orders"   ON orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM manufacturers WHERE id = auth.uid())
);
DROP POLICY IF EXISTS "Mfg update orders" ON orders;
CREATE POLICY "Mfg update orders"            ON orders FOR UPDATE USING (
  EXISTS (SELECT 1 FROM manufacturers WHERE id = auth.uid())
);

-- ─── Wallets ───
DROP POLICY IF EXISTS "Users read own wallet" ON wallets;
CREATE POLICY "Users read own wallet"     ON wallets FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users insert own wallet" ON wallets;
CREATE POLICY "Users insert own wallet"   ON wallets FOR INSERT WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Admins full access wallet" ON wallets;
CREATE POLICY "Admins full access wallet" ON wallets FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Withdrawals ───
DROP POLICY IF EXISTS "Users read own withdrawals" ON withdrawals;
CREATE POLICY "Users read own withdrawals"    ON withdrawals FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users insert own withdrawals" ON withdrawals;
CREATE POLICY "Users insert own withdrawals"  ON withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins full access withdrawals" ON withdrawals;
CREATE POLICY "Admins full access withdrawals" ON withdrawals FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Tickets ───
DROP POLICY IF EXISTS "Users manage own tickets" ON tickets;
CREATE POLICY "Users manage own tickets"    ON tickets FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins full access tickets" ON tickets;
CREATE POLICY "Admins full access tickets"  ON tickets FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Ticket Messages ───
DROP POLICY IF EXISTS "Users read own ticket messages" ON ticket_messages;
CREATE POLICY "Users read own ticket messages" ON ticket_messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM tickets WHERE tickets.id = ticket_messages.ticket_id AND tickets.user_id = auth.uid())
);
DROP POLICY IF EXISTS "Users insert own ticket messages" ON ticket_messages;
CREATE POLICY "Users insert own ticket messages" ON ticket_messages FOR INSERT WITH CHECK (
  auth.uid() = sender_id
);
DROP POLICY IF EXISTS "Admins full access messages" ON ticket_messages;
CREATE POLICY "Admins full access messages" ON ticket_messages FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── OTPs ── (backend service role only; no client access)
DROP POLICY IF EXISTS "No client access to otps" ON otps;
CREATE POLICY "No client access to otps" ON otps FOR ALL USING (false);

-- ─── Settings ───
DROP POLICY IF EXISTS "Anyone can read settings" ON settings;
CREATE POLICY "Anyone can read settings" ON settings FOR SELECT USING (true);
DROP POLICY IF EXISTS "Admins manage settings" ON settings;
CREATE POLICY "Admins manage settings"   ON settings FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- ─── Print Styles ───
DROP POLICY IF EXISTS "Public read active print styles" ON print_styles;
CREATE POLICY "Public read active print styles" ON print_styles FOR SELECT USING (active = true);
DROP POLICY IF EXISTS "Mfg manage own print styles" ON print_styles;
CREATE POLICY "Mfg manage own print styles"     ON print_styles FOR ALL USING (auth.uid() = mfg_id);
DROP POLICY IF EXISTS "Admins full access print styles" ON print_styles;
CREATE POLICY "Admins full access print styles"  ON print_styles FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);


-- ═══════════════════════════════════════════════════════════
-- STORAGE BUCKET
-- ═══════════════════════════════════════════════════════════
-- Run this separately or create via Supabase Dashboard:
-- 1. Go to Storage → Create bucket "asat-uploads" with Public access
-- 2. Add policy: Allow authenticated users to upload
-- 3. Add policy: Allow public read access
INSERT INTO storage.buckets (id, name, public) VALUES ('asat-uploads', 'asat-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'asat-uploads' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Anyone can view uploads" ON storage.objects;
CREATE POLICY "Anyone can view uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'asat-uploads');

DROP POLICY IF EXISTS "Users can update own uploads" ON storage.objects;
CREATE POLICY "Users can update own uploads"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'asat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Users can delete own uploads" ON storage.objects;
CREATE POLICY "Users can delete own uploads"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'asat-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
