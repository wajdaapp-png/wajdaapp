const multer = require('multer');
const path = require('path');
const fs = require('fs');

// دالة مساعدة لضمان إنشاء المجلدات تلقائياً إذا لم تكن موجودة لمنع أخطاء الرفع
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// =========================================================================
// 👤 1️⃣ مستودع حفظ صور البروفايل (Avatar)
// =========================================================================
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = path.join(__dirname, '../public/uploads');
    ensureDirExists(targetDir); // التأكد من وجود مجلد الـ uploads العام
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const userId = req.body.user_id || 'anonymous';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExt = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${userId}-${uniqueSuffix}${fileExt}`);
  }
});

// =========================================================================
// 🚚 2️⃣ مستودع حفظ أوراق ومستندات الكباتن (مجلد منفصل)
// =========================================================================
const driverDocsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 🎯 توجيه المستندات إلى مجلد مستقل تماماً باسم drivers_docs
    const targetDir = path.join(__dirname, '../public/drivers_docs');
    ensureDirExists(targetDir); 
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const driverId = req.session?.driverId || 'new-driver';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const fileExt = path.extname(file.originalname).toLowerCase();
    // تسمية فريدة تفرق بين صورة الرخصة وصورة المركبة
    cb(null, `doc-${file.fieldname}-${driverId}-${uniqueSuffix}${fileExt}`);
  }
});

// =========================================================================
// 🛡️ 3️⃣ الفلتر الأمني لحظر الملفات الخبيثة وقبول الصور فقط
// =========================================================================
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

// =========================================================================
// 📦 4️⃣ تصدير دوال الرفع الجاهزة للاستخدام في المسارات (Routes)
// =========================================================================

// دالة رفع صوة البروفايل (ملف واحد وحجم أقصى 5 ميجابايت)
const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } 
}).single('avatar');

// دالة رفع مستندات الكابتن المتعددة (حجم أقصى 10 ميجابايت لضمان دقة تفاصيل الوثائق)
const uploadDriverDocs = multer({
  storage: driverDocsStorage,
  fileFilter: fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } 
}).fields([
  { name: 'license_image', maxCount: 1 },
  { name: 'vehicle_image', maxCount: 1 }
]);

module.exports = { 
  uploadAvatar, 
  uploadDriverDocs 
};