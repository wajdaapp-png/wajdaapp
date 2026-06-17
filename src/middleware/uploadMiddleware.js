// src/middleware/uploadMiddleware.js
const multer = require('multer');
const path = require('path');

// 1. ضبط مستودع الحفظ وتسمية الملفات ديناميكياً
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // تحديد مجلد الحفظ العام الذي أنشأناه سابقاً
    cb(null, path.join(__dirname, '../public/uploads'));
  },
  filename: (req, file, cb) => {
    // توليد اسم فريد: avatar-userid-timestamp.extension
    const userId = req.body.user_id || 'anonymous';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExt = path.extname(file.originalname);
    cb(null, `avatar-${userId}-${uniqueSuffix}${fileExt}`);
  }
});

// 2. فلترة الملفات للتأكد من أنها صور فقط (حماية أمنية)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const extCheck = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimeCheck = allowedTypes.test(file.mimetype);

  if (extCheck && mimeCheck) {
    return cb(null, true);
  } else {
    cb(new Error('عذراً، النظام يقبل رفع الصور فقط (jpg, jpeg, png, webp)!'));
  }
};

// 3. تصدير الإعدادات مع تحديد الحد الأقصى لحجم الصورة (مثلاً 5 ميجابايت)
const uploadAvatar = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('avatar'); // 'avatar' هو اسم الحقل (Key) القادم من Flutter

module.exports = { uploadAvatar };