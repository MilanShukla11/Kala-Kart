require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const dir = './public/uploads';
if (!fs.existsSync(dir)){
    fs.mkdirSync(dir, { recursive: true });
}

// Configure Multer to save files in public/uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './public/uploads/')
  },
  filename: function (req, file, cb) {
    // Give the file a unique name using the current timestamp
    cb(null, Date.now() + path.extname(file.originalname))
  }
});

const upload = multer({ storage: storage });

// GET: Fetch all pending products for the NGO
app.get('/api/admin/pending-products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_approved', false); // Only fetch unapproved items

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// PUT: Approve a specific product
app.put('/api/admin/approve-product/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('products')
    .update({ is_approved: true })
    .eq('id', id)
    .select(); // Returns the updated row

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Product approved successfully!', product: data });
});

// DELETE: Reject (delete) a product
app.delete('/api/admin/reject-product/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Product rejected and removed.' });
});

// GET: Fetch all approved products for the public marketplace
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('is_approved', true);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// POST: Create a new order (Mock Version)
// POST: Create a new order (Updated for Cart Checkout)
app.post('/api/orders/create', async (req, res) => {
  const { price, buyer_email } = req.body; 
  
  try {
    const mockTransactionId = `txn_${Math.floor(Math.random() * 1000000)}`;

    const { data: dbOrder, error } = await supabase
      .from('orders')
      .insert([{ 
        total_amount: price, 
        payment_status: 'PENDING', 
        razorpay_order_id: mockTransactionId,
        buyer_email: buyer_email // Saving the user's email
      }])
      .select()
      .single();

    if (error) throw error;
    res.json({ dbOrderId: dbOrder.id, amount: price });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET: Fetch My Orders
app.get('/api/orders/my-orders', async (req, res) => {
  const { email } = req.query;
  
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('buyer_email', email)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// (Keep your /api/orders/verify route exactly as it is!)

// POST: Verify payment and update database (Remains exactly the same!)
app.post('/api/orders/verify', async (req, res) => {
  const { dbOrderId } = req.body;
  
  const { error } = await supabase
    .from('orders')
    .update({ payment_status: 'PAID' })
    .eq('id', dbOrderId);
      
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// POST: Artisan uploads a new product (Now handles images!)
// Ensure this part of your POST route looks like this:
app.post('/api/artisan/products', upload.single('image'), async (req, res) => {
  const { title, description, price, category_id, artisan_name, village } = req.body;
  
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

  const { data, error } = await supabase
    .from('products')
    .insert([{ 
      title, 
      description, 
      price, 
      image_url: imageUrl, 
      category_id: parseInt(category_id), // Ensure it's an integer for Postgres
      is_approved: false,
      artisan_name,
      village
    }])
    .select();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Success!', product: data });
});

app.get('/health', (req, res) => {
  res.json({ status: 'Digital Haat Bazar Server is live!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));