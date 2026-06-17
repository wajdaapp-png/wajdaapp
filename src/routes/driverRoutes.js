// src/routes/driverRoutes.js

const express = require('express');
const router = express.Router();
const driverController = require('../controllers/driver/driverController'); // استدعاء الكنترولر

// 🎯 استدعاء صمام الأمان (Middleware) المطور والمحمي رتبوياً
const { isDriverAuthenticated } = require('../middleware/driverAuthMiddleware');

// 💡 مبرمج استباقي لمنع التكرار: إذا كان مسجل دخوله بالفعل، يمنع فتحه لصفحة الـ login ويرسله للرئيسية
const redirectIfAuthenticated = (req, res, next) => {
  if (req.session && req.session.driverId && req.session.driverRole === 'both') {
    return res.redirect('/driver/');
  }
  next(); 
};

// =========================================================================
// 🧭 1️⃣ لوحة تحكم السائق الرئيسية (محمية بالكامل وحصرياً بالـ Middleware)
// =========================================================================
router.get('/', isDriverAuthenticated, driverController.renderDriverHome);

// =========================================================================
// 🔐 2️⃣ مسارات تسجيل الدخول (عرض الواجهة + معالجة البيانات وبث الجلسة)
// =========================================================================
router.get('/login', redirectIfAuthenticated, driverController.renderDriverLogin);

router.post('/login', driverController.processDriverLogin);

// =========================================================================
// 📝 3️⃣ مسار ترقية الحساب والتسجيل ككابتن (في حال كان المستخدم client)
// =========================================================================
router.get('/register', driverController.renderDriverRegister);

// =========================================================================
// 🚪 4️⃣ مسار تسجيل الخروج وتطهير الجلسة تماماً
// =========================================================================
router.get('/logout', driverController.logoutDriver);

router.get('/terms', driverController.renderDriverTerms);

module.exports = router;