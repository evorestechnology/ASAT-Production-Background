/**
 * ASAT Firebase Seed Script
 * Run: node scripts/seed.mjs
 *
 * Prerequisites:
 *  1. Download service account key:
 *     Firebase Console → Project Settings → Service Accounts → Generate new private key
 *  2. Save as: scripts/serviceAccount.json
 *  3. Run: node scripts/seed.mjs
 */

import admin from "firebase-admin";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(join(__dirname, "serviceAccount.json"), "utf8"));
} catch {
  console.error("❌ serviceAccount.json not found in scripts/");
  console.error("   Firebase Console → Project Settings → Service Accounts → Generate new private key");
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const db = admin.firestore();
db.settings({ databaseId: "asat" });

const TS = () => admin.firestore.FieldValue.serverTimestamp();

/* ─────────────────────────────────────────────────────────────
   CATALOGUE — 5 categories (master-editable via dashboard)
   Fields: name, area (CSS class), image, basePrice, sizes,
           active, order (sort order in bento grid)
   ───────────────────────────────────────────────────────────── */
const catalogue = [
  {
    id: "cat_tshirts",
    name: "T-Shirts",
    area: "tshirts",         // maps to CSS .bento-card--tshirts
    order: 0,
    image: "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=800&q=80",
    basePrice: 1999,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    active: true,
  },
  {
    id: "cat_hoodies",
    name: "Hoodies",
    area: "hoodies",         // maps to CSS .bento-card--hoodies
    order: 1,
    image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80",
    basePrice: 3499,
    sizes: ["S", "M", "L", "XL", "XXL"],
    active: true,
  },
  {
    id: "cat_shirts",
    name: "Shirts",
    area: "all",             // maps to CSS .bento-card--all (large feature card)
    order: 2,
    image: "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80",
    basePrice: 2499,
    sizes: ["XS", "S", "M", "L", "XL", "XXL"],
    active: true,
  },
  {
    id: "cat_pants",
    name: "Pants",
    area: "pants",           // maps to CSS .bento-card--pants
    order: 3,
    image: "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=80",
    basePrice: 2999,
    sizes: ["28", "30", "32", "34", "36", "38"],
    active: true,
  },
  {
    id: "cat_caps",
    name: "Caps",
    area: "kids",            // maps to CSS .bento-card--kids (reused slot)
    order: 4,
    image: "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=800&q=80",
    basePrice: 999,
    sizes: ["One Size"],
    active: true,
  },
];

/* ─────────────────────────────────────────────────────────────
   DESIGNERS
   ───────────────────────────────────────────────────────────── */
const designers = [
  {
    id: "designer_arjun",
    fullName: "Arjun Sharma",
    email: "arjun@asat.com",
    username: "urban_drip",
    contact: "+91 9876543210",
    country: "India",
    status: "active",
    designsCount: 14,
    totalEarnings: 382000,
    rank: 1,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
    bio: "Streetwear designer blending urban culture with Indian aesthetics",
  },
  {
    id: "designer_priya",
    fullName: "Priya Nair",
    email: "priya@asat.com",
    username: "priya_creates",
    contact: "+91 9123456789",
    country: "India",
    status: "active",
    designsCount: 9,
    totalEarnings: 245000,
    rank: 2,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80",
    bio: "Fusion designer merging traditional patterns with modern cuts",
  },
  {
    id: "designer_rahul",
    fullName: "Rahul Mehta",
    email: "rahul@asat.com",
    username: "boldlines",
    contact: "+91 9988776655",
    country: "India",
    status: "active",
    designsCount: 11,
    totalEarnings: 198000,
    rank: 3,
    avatar: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=300&q=80",
    bio: "Minimalist graphic designer with a bold typographic approach",
  },
  {
    id: "designer_sara",
    fullName: "Sara Menon",
    email: "sara@asat.com",
    username: "sara_style",
    contact: "+91 9871234567",
    country: "India",
    status: "active",
    designsCount: 7,
    totalEarnings: 156000,
    rank: 4,
    avatar: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=300&q=80",
    bio: "Contemporary fashion with vibrant colour palettes",
  },
  {
    id: "designer_karan",
    fullName: "Karan Verma",
    email: "karan@asat.com",
    username: "kv_designs",
    contact: "+91 9654321098",
    country: "India",
    status: "active",
    designsCount: 6,
    totalEarnings: 112000,
    rank: 5,
    avatar: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=300&q=80",
    bio: "Vintage-inspired streetwear with contemporary Indian motifs",
  },
  {
    id: "designer_neha",
    fullName: "Neha Kapoor",
    email: "neha@asat.com",
    username: "neha_ink",
    contact: "+91 9345678901",
    country: "India",
    status: "active",
    designsCount: 5,
    totalEarnings: 89000,
    rank: 6,
    avatar: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80",
    bio: "Illustrative fashion with hand-drawn ink-style graphics",
  },
];

/* ─────────────────────────────────────────────────────────────
   DESIGNS — 16 products across all 5 categories
   New arrivals = created recently (daysAgo 0-7)
   Bestsellers  = high ordersCount (100+)
   ───────────────────────────────────────────────────────────── */
const designs = [
  /* ── T-SHIRTS ── */
  {
    id: "design_t001",
    designerId: "designer_arjun",
    designerUsername: "urban_drip",
    title: "Monsoon Drip Oversized Tee",
    description: "Premium 240gsm cotton tee with distressed graphic print. Perfect for the streets.",
    catalogueItemId: "cat_tshirts",
    category: "T-Shirts",
    price: 2499,
    images: [
      "https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 23,
    daysAgo: 3,
  },
  {
    id: "design_t002",
    designerId: "designer_rahul",
    designerUsername: "boldlines",
    title: "Phantom Streetwear Tee",
    description: "Dual-layer phantom print that shifts under different lighting. A crowd favourite.",
    catalogueItemId: "cat_tshirts",
    category: "T-Shirts",
    price: 2199,
    images: [
      "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 251,
    daysAgo: 45,
  },
  {
    id: "design_t003",
    designerId: "designer_neha",
    designerUsername: "neha_ink",
    title: "Ink Flora Minimal Tee",
    description: "Hand-drawn botanical illustration printed on organic cotton.",
    catalogueItemId: "cat_tshirts",
    category: "T-Shirts",
    price: 1899,
    images: [
      "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 9,
    daysAgo: 2,
  },
  {
    id: "design_t004",
    designerId: "designer_karan",
    designerUsername: "kv_designs",
    title: "Retro Wave Graphic Tee",
    description: "80s retro wave art on a relaxed-fit super-soft cotton base.",
    catalogueItemId: "cat_tshirts",
    category: "T-Shirts",
    price: 2299,
    images: [
      "https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 143,
    daysAgo: 60,
  },

  /* ── HOODIES ── */
  {
    id: "design_h001",
    designerId: "designer_arjun",
    designerUsername: "urban_drip",
    title: "Street Crown Premium Hoodie",
    description: "Best-selling heavyweight fleece with embossed crown logo. A wardrobe staple.",
    catalogueItemId: "cat_hoodies",
    category: "Hoodies",
    price: 5999,
    images: [
      "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 342,
    daysAgo: 90,
  },
  {
    id: "design_h002",
    designerId: "designer_priya",
    designerUsername: "priya_creates",
    title: "Batik Fusion Hoodie",
    description: "Heritage batik patterns reinterpreted on a heavyweight fleece hoodie.",
    catalogueItemId: "cat_hoodies",
    category: "Hoodies",
    price: 4999,
    images: [
      "https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 18,
    daysAgo: 5,
  },
  {
    id: "design_h003",
    designerId: "designer_sara",
    designerUsername: "sara_style",
    title: "Neon Noir Hoodie",
    description: "Dark base with neon accent graphics — standout streetwear.",
    catalogueItemId: "cat_hoodies",
    category: "Hoodies",
    price: 4499,
    images: [
      "https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 178,
    daysAgo: 30,
  },

  /* ── SHIRTS ── */
  {
    id: "design_s001",
    designerId: "designer_rahul",
    designerUsername: "boldlines",
    title: "Block Print Linen Shirt",
    description: "Breathable linen with traditional block print patterns in earthy tones.",
    catalogueItemId: "cat_shirts",
    category: "Shirts",
    price: 3299,
    images: [
      "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 87,
    daysAgo: 20,
  },
  {
    id: "design_s002",
    designerId: "designer_arjun",
    designerUsername: "urban_drip",
    title: "Cuban Collar Resort Shirt",
    description: "Relaxed resort-style shirt with tropical print on a crisp cotton blend.",
    catalogueItemId: "cat_shirts",
    category: "Shirts",
    price: 2799,
    images: [
      "https://images.unsplash.com/photo-1603252109303-2751441dd157?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 12,
    daysAgo: 4,
  },
  {
    id: "design_s003",
    designerId: "designer_karan",
    designerUsername: "kv_designs",
    title: "Indigo Dye Casual Shirt",
    description: "Hand-dyed indigo casual shirt with artisanal texture and relaxed silhouette.",
    catalogueItemId: "cat_shirts",
    category: "Shirts",
    price: 3499,
    images: [
      "https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 204,
    daysAgo: 75,
  },

  /* ── PANTS ── */
  {
    id: "design_p001",
    designerId: "designer_priya",
    designerUsername: "priya_creates",
    title: "Metro Cargo Joggers",
    description: "Technical twill fabric with utility pockets and a comfortable tapered fit.",
    catalogueItemId: "cat_pants",
    category: "Pants",
    price: 3299,
    images: [
      "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 31,
    daysAgo: 6,
  },
  {
    id: "design_p002",
    designerId: "designer_karan",
    designerUsername: "kv_designs",
    title: "Heritage Slim Chinos",
    description: "Italian-blend twill slim-fit chinos with signature metal buttons.",
    catalogueItemId: "cat_pants",
    category: "Pants",
    price: 3499,
    images: [
      "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 198,
    daysAgo: 55,
  },
  {
    id: "design_p003",
    designerId: "designer_neha",
    designerUsername: "neha_ink",
    title: "Wide Leg Linen Trousers",
    description: "Breezy wide-leg silhouette in premium linen — effortlessly elevated.",
    catalogueItemId: "cat_pants",
    category: "Pants",
    price: 2999,
    images: [
      "https://images.unsplash.com/photo-1624378439575-d8705ad7ae80?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 7,
    daysAgo: 1,
  },

  /* ── CAPS ── */
  {
    id: "design_c001",
    designerId: "designer_sara",
    designerUsername: "sara_style",
    title: "Classic 6-Panel Streetcap",
    description: "Structured 6-panel cap with embroidered ASAT logo and adjustable strap.",
    catalogueItemId: "cat_caps",
    category: "Caps",
    price: 1299,
    images: [
      "https://images.unsplash.com/photo-1588850561407-ed78c282e89b?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 167,
    daysAgo: 40,
  },
  {
    id: "design_c002",
    designerId: "designer_arjun",
    designerUsername: "urban_drip",
    title: "Drip Snapback",
    description: "Premium twill snapback with flat brim and urban graphic embroidery.",
    catalogueItemId: "cat_caps",
    category: "Caps",
    price: 1499,
    images: [
      "https://images.unsplash.com/photo-1521369909029-2afed882baee?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 19,
    daysAgo: 5,
  },
  {
    id: "design_c003",
    designerId: "designer_rahul",
    designerUsername: "boldlines",
    title: "Dad Hat Minimal",
    description: "Unstructured dad hat in washed canvas with tonal logo. Relaxed and refined.",
    catalogueItemId: "cat_caps",
    category: "Caps",
    price: 999,
    images: [
      "https://images.unsplash.com/photo-1534215754734-18e55d13e346?auto=format&fit=crop&w=800&q=80",
    ],
    status: "approved",
    ordersCount: 94,
    daysAgo: 25,
  },
];

/* ─────────────────────────────────────────────────────────────
   SETTINGS
   ───────────────────────────────────────────────────────────── */
const settings = {
  earnings: {
    designer: 30,
    mfg: 40,
    platform: 30,
  },
  homepage: {
    marqueeItems: [
      "★ FREE SHIPPING ON ORDERS ABOVE ₹2,000",
      "★ NEW DROP 001 — NOW LIVE",
      "★ PREMIUM DESIGNER STREETWEAR",
      "★ 7-DAY HASSLE-FREE RETURNS",
      "★ AUTHENTIC INDIAN DESIGNER FASHION",
    ],
  },
};

/* ─────────────────────────────────────────────────────────────
   SEED RUNNER
   ───────────────────────────────────────────────────────────── */
async function seed() {
  console.log("\n🌱  ASAT Firebase Seed Script\n");

  // 1. Catalogue & Categories
  console.log("📦  Seeding catalogue & categories...");
  for (const item of catalogue) {
    const { id, ...data } = item;
    await db.collection("catalogue").doc(id).set({ ...data, createdAt: TS(), updatedAt: TS() });
    await db.collection("categories").doc(id).set({ ...data, createdAt: TS(), updatedAt: TS() });
    console.log(`   ✓ [${data.area}] ${data.name}`);
  }

  // 2. Designers
  console.log("\n👤  Seeding designers...");
  for (const d of designers) {
    const { id, ...data } = d;
    await db.collection("designers").doc(id).set({ ...data, createdAt: TS(), updatedAt: TS() });
    await db.collection("wallets").doc(id).set({
      role: "designer",
      balance: Math.floor(data.totalEarnings * 0.2),
      totalEarnings: data.totalEarnings,
      totalWithdrawn: Math.floor(data.totalEarnings * 0.8),
      createdAt: TS(),
    });
    console.log(`   ✓ ${data.fullName} (@${data.username})`);
  }

  // 3. Designs
  console.log("\n🎨  Seeding designs...");
  for (const design of designs) {
    const { id, daysAgo, ...data } = design;
    const createdAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await db.collection("designs").doc(id).set({
      ...data,
      isNew: daysAgo <= 7,
      createdAt: admin.firestore.Timestamp.fromDate(createdAt),
      updatedAt: TS(),
    });
    console.log(`   ✓ [${data.category}] ${data.title} — ${data.ordersCount} orders`);
  }

  // 4. Settings
  console.log("\n⚙️   Seeding settings...");
  for (const [key, value] of Object.entries(settings)) {
    await db.collection("settings").doc(key).set(value);
    console.log(`   ✓ settings/${key}`);
  }

  console.log("\n✅  Seed complete!\n");
  console.log("   Collections written:");
  console.log("   → catalogue (5 categories)");
  console.log("   → designers (6 profiles)");
  console.log("   → designs   (16 products)");
  console.log("   → wallets   (6 records)");
  console.log("   → settings  (earnings, homepage)\n");
  process.exit(0);
}

seed().catch((err) => {
  console.error("❌ Seed failed:", err.message);
  process.exit(1);
});
