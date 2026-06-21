import express from 'express';
import multer from 'multer';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth } from '../middleware/auth.js';

const router = express.Router();

// Configure multer to store files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // limit 10MB
  }
});

// POST /api/storage/upload - Upload file to Supabase storage via backend
router.post('/upload', verifyAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { path, bucket } = req.body;
    if (!path) {
      return res.status(400).json({ error: 'Storage path is required.' });
    }

    const targetBucket = bucket || 'asat-uploads';

    // Upload using supabaseAdmin client
    const { data, error } = await supabaseAdmin.storage
      .from(targetBucket)
      .upload(path, req.file.buffer, {
        contentType: req.file.mimetype,
        cacheControl: '3600',
        upsert: true
      });

    if (error) throw error;

    // Retrieve public URL
    const { data: urlData } = supabaseAdmin.storage
      .from(targetBucket)
      .getPublicUrl(data.path);

    res.json({
      success: true,
      path: data.path,
      publicUrl: urlData.publicUrl
    });
  } catch (err) {
    console.error('File upload failed:', err.message);
    res.status(500).json({ error: err.message || 'File upload failed.' });
  }
});

export default router;
