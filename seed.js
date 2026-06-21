import { supabaseAdmin } from './src/supabaseAdmin.js';
import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

async function seed() {
  console.log('Seeding Manufacturers...');
  const mfg1 = {
    id: uuid(),
    business_name: 'Global Print Solutions',
    email: 'contact@globalprint.com',
    contact: '+1 555-0101',
    address: '123 Print Ave, NY',
    gst: 'GST12345678',
    status: 'active'
  };
  const mfg2 = {
    id: uuid(),
    business_name: 'Premium Textiles Co.',
    email: 'info@premiumtextiles.com',
    contact: '+1 555-0202',
    address: '456 Fabric St, CA',
    gst: 'GST87654321',
    status: 'active'
  };
  await supabaseAdmin.from('manufacturers').insert([mfg1, mfg2]);

  console.log('Seeding Categories...');
  const cat1 = {
    id: uuid(),
    slug: 't-shirts',
    name: 'T-Shirts',
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80',
    description: 'High-quality basic and premium t-shirts.',
    active: true,
    area: 'Apparel'
  };
  const cat2 = {
    id: uuid(),
    slug: 'hoodies',
    name: 'Hoodies',
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80',
    description: 'Warm and comfortable hoodies for all seasons.',
    active: true,
    area: 'Apparel'
  };
  const cat3 = {
    id: uuid(),
    slug: 'mugs',
    name: 'Mugs',
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=80',
    description: 'Ceramic mugs for your daily coffee or tea.',
    active: true,
    area: 'Accessories'
  };
  await supabaseAdmin.from('categories').insert([cat1, cat2, cat3]);

  console.log('Seeding Catalogue...');
  const catItem1 = {
    id: uuid(),
    name: 'Classic Unisex T-Shirt',
    category: 't-shirts',
    base_price: 450,
    image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80',
    colors: ['Black', 'White', 'Navy'],
    sizes: ['S', 'M', 'L', 'XL'],
    active: true,
    description: 'A classic unisex t-shirt for all purposes.'
  };
  const catItem2 = {
    id: uuid(),
    name: 'Premium Heavyweight Hoodie',
    category: 'hoodies',
    base_price: 1200,
    image: 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80',
    colors: ['Black', 'Grey', 'Olive'],
    sizes: ['M', 'L', 'XL', 'XXL'],
    active: true,
    description: 'Warm, cozy, and heavy hoodie.'
  };
  const catItem3 = {
    id: uuid(),
    name: '11oz Ceramic Mug',
    category: 'mugs',
    base_price: 250,
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=800&q=80',
    colors: ['White', 'Black'],
    sizes: ['One Size'],
    active: true,
    description: 'Perfect for morning coffee.'
  };
  await supabaseAdmin.from('catalogue').upsert([catItem1, catItem2, catItem3]);

  console.log('Seeding Designers...');
  
  // Create auth users first
  const { data: authUser1 } = await supabaseAdmin.auth.admin.createUser({
      email: 'designer_new1@asat.com',
      password: 'password123',
      email_confirm: true,
      user_metadata: { role: 'designer', full_name: 'Alex Design' }
  });
  
  const { data: authUser2 } = await supabaseAdmin.auth.admin.createUser({
      email: 'designer_new2@asat.com',
      password: 'password123',
      email_confirm: true,
      user_metadata: { role: 'designer', full_name: 'Sam Creates' }
  });

  const desId1 = authUser1?.user?.id || uuid();
  const desId2 = authUser2?.user?.id || uuid();

  await supabaseAdmin.from('users').upsert([
    { id: desId1, email: 'designer_new1@asat.com', full_name: 'Alex Design', role: 'designer', status: 'active' },
    { id: desId2, email: 'designer_new2@asat.com', full_name: 'Sam Creates', role: 'designer', status: 'active' }
  ]);

  await supabaseAdmin.from('designers').upsert([
    { id: desId1, email: 'designer_new1@asat.com', full_name: 'Alex Design', username: 'alex_d2', status: 'active' },
    { id: desId2, email: 'designer_new2@asat.com', full_name: 'Sam Creates', username: 'sam_c2', status: 'active' }
  ]);

  console.log('Seeding Designs...');
  const designs = [
    {
      id: uuid(),
      title: 'Neon Cyberpunk Skull',
      description: JSON.stringify({
        text: 'A glowing neon skull design for the cyberpunk lovers.',
        pricing: { baseCost: 450, printingCost: 200, designerCost: 150, markup: 99 }
      }),
      price: 899,
      catalogue_item_id: catItem1.id,
      designer_id: desId1,
      designer_username: 'alex_d',
      images: ['https://images.unsplash.com/photo-1618336753974-aae8e04506aa?auto=format&fit=crop&w=800&q=80'],
      colors: ['Black'],
      sizes: ['M', 'L', 'XL'],
      gender: 'unisex',
      status: 'pending'
    },
    {
      id: uuid(),
      title: 'Minimalist Wave',
      description: JSON.stringify({
        text: 'Simple and elegant wave illustration.',
        pricing: { baseCost: 1200, printingCost: 100, designerCost: 200, markup: 99 }
      }),
      price: 1599,
      catalogue_item_id: catItem2.id,
      designer_id: desId2,
      designer_username: 'sam_creations',
      images: ['https://images.unsplash.com/photo-1502444330042-d1a1ddf9bb5b?auto=format&fit=crop&w=800&q=80'],
      colors: ['Grey', 'Olive'],
      sizes: ['L', 'XL'],
      gender: 'unisex',
      status: 'approved'
    },
    {
      id: uuid(),
      title: 'Coffee Powered Mug',
      description: JSON.stringify({
        text: 'Funny typography mug design for caffeine addicts.',
        pricing: { baseCost: 250, printingCost: 50, designerCost: 50, markup: 49 }
      }),
      price: 399,
      catalogue_item_id: catItem3.id,
      designer_id: desId1,
      designer_username: 'alex_d',
      images: ['https://images.unsplash.com/photo-1517551044458-79ee898b9e67?auto=format&fit=crop&w=800&q=80'],
      colors: ['White'],
      sizes: ['One Size'],
      gender: 'unisex',
      status: 'restricted',
      rejection_reason: 'Design violates copyright policy.'
    },
    {
      id: uuid(),
      title: 'Retro Sunset Vibes',
      description: JSON.stringify({
        text: '80s inspired synthwave sunset.',
        pricing: { baseCost: 450, printingCost: 200, designerCost: 200, markup: 149 }
      }),
      price: 999,
      catalogue_item_id: catItem1.id,
      designer_id: desId2,
      designer_username: 'sam_creations',
      images: ['https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=800&q=80'],
      colors: ['Black', 'Navy'],
      sizes: ['S', 'M', 'L'],
      gender: 'unisex',
      status: 'pending'
    },
    {
      id: uuid(),
      title: 'Abstract Geometric Pattern',
      description: JSON.stringify({
        text: 'Colorful geometric shapes and patterns.',
        pricing: { baseCost: 1200, printingCost: 100, designerCost: 100, markup: 99 }
      }),
      price: 1499,
      catalogue_item_id: catItem2.id,
      designer_id: desId1,
      designer_username: 'alex_d',
      images: ['https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?auto=format&fit=crop&w=800&q=80'],
      colors: ['Black'],
      sizes: ['M', 'L', 'XL'],
      gender: 'unisex',
      status: 'approved'
    }
  ];

  const { error } = await supabaseAdmin.from('designs').insert(designs);
  if (error) {
    console.error('Failed to insert designs:', error);
  }

  console.log('Database seeded successfully!');
}

seed().catch(console.error);
