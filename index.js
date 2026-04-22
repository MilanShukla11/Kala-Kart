require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

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
    .eq('is_approved', false); 

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

// POST: Create a real Razorpay order
app.post('/api/orders/create', async (req, res) => {
  const { price, buyer_email } = req.body; 
  
  try {
    // 1. Tell Razorpay to create an order (Amount must be in paise/smallest currency unit)
    const options = {
      amount: price * 100, 
      currency: "INR",
      receipt: `receipt_${Date.now()}`
    };
    const razorpayOrder = await razorpay.orders.create(options);

    // 2. Save the pending order to Supabase using the REAL Razorpay Order ID
    const { data: dbOrder, error } = await supabase
      .from('orders')
      .insert([{ 
        total_amount: price, 
        payment_status: 'PENDING', 
        razorpay_order_id: razorpayOrder.id,
        buyer_email: buyer_email
      }])
      .select()
      .single();

    if (error) throw error;
    
    // Send both IDs back to the frontend
    res.json({ 
        dbOrderId: dbOrder.id, 
        razorpayOrderId: razorpayOrder.id, 
        amount: price 
    });
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
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, dbOrderId } = req.body;

  // 1. Generate our own signature using our secret key
  const sign = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSign = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(sign.toString())
    .digest("hex");

  // 2. Compare our signature with the one Razorpay sent
  if (razorpay_signature === expectedSign) {
    // Payment is 100% legit. Update Supabase.
    await supabase
      .from('orders')
      .update({ payment_status: 'PAID' })
      .eq('id', dbOrderId);

    res.json({ success: true, message: "Payment verified!" });
  } else {
    // Someone is trying to fake a payment!
    res.status(400).json({ success: false, message: "Invalid signature" });
  }
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