// src/app.js

const { initializeApp, cert, apps } = require('firebase-admin/app');

try {
  if (!apps || apps.length === 0) {
    const serviceAccount = require('./config/firebase-service-account.json'); 
    initializeApp({ credential: cert(serviceAccount) });
    console.log('🔥 [Firebase Boot] تم قفل وتأمين تطبيق الفايربيس بنجاح!');
  }
} catch (error) {
  console.error('❌ [Firebase Boot Error]:', error.message);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http'); 
const cookieParser = require('cookie-parser');
const session = require('express-session'); // 🎯 استدعاء المكتبة
const { Server } = require('socket.io'); 
const authRoutes = require('./routes/app/authRoutes');
const db = require('./config/db'); 
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 1212;
const server = http.createServer(app);

// =========================================================================
// 🌐 [الترتيب الصحيح 1]: إعداد الـ Body Parsers و الـ Cookies أولاً
// =========================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // لقراءة الاستمارات بسلام
app.use(cookieParser());

// =========================================================================
// 🛡️ [الترتيب الصحيح 2]: تفعيل الـ Session فوراً قبل الملفات الساكنة والمسارات
// =========================================================================
app.use(session({
  secret: 'wajda_captain_secure_key_2026',
  resave: false,
  saveUninitialized: false, // اجعلها false لمنع توليد جلسات فارغة عشوائية مع كل طلب ساكن
  cookie: { 
    secure: false, // false للـ localhost مئة بالمئة
    maxAge: 24 * 60 * 60 * 1000 
  }
}));

// =========================================================================
// 🧩 [الترتيب الصحيح 3]: إعداد قوالب EJS والملفات الساكنة (تأتي بعد الـ Session لتأخذ الكوكيز)
// =========================================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public'))); 
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// =========================================================================
// 📡 إعداد السوكيت والاتصالات الحية
// =========================================================================
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use((req, res, next) => {
  req.io = io;
  next();
});

const dashboardController = require('./controllers/admin/dashboardController');

io.on('connection', (socket) => {
  console.log(`🔌 [Radar Connect] ID: ${socket.id}`);
  const emitLiveStats = async () => {
    const liveStats = await dashboardController.getLiveStatsData(); 
    socket.emit('dashboard_stats_update', liveStats);
  };
  emitLiveStats();
  const statsInterval = setInterval(emitLiveStats, 5000);
  socket.on('disconnect', () => { clearInterval(statsInterval); });
});

// =========================================================================
// 💻 مسارات الـ APIs والويب
// =========================================================================

// 🌐 1. مسار الواجهة التعريفية العامة (تأتي في الأعلى قسراً)
app.use('/', require('./routes/homeRoutes'));

// 📱 2. مسارات الـ APIs الخاصة بتطبيق الهواتف الذكية (فلاتر)
app.use('/api/auth', authRoutes);
app.use('/api/orders', require('./routes/app/orderRoutes'));
app.use('/api/drivers', require('./routes/app/driverRoutes'));
app.use('/api/clients', require('./routes/app/clientRoutes'));
app.use('/api/users', require('./routes/app/userRoutes'));
app.use('/api/tax', require('./routes/app/taxRoutes'));

// 💻 3. مسارات ويب لوحات التحكم (الإدارة والسائقين)
app.use('/admin', require('./routes/adminRoutes'));
app.use('/driver', require('./routes/driverRoutes'));

// تشغيل السيرفر
server.listen(PORT, '0.0.0.0', async () => {
  console.log('🚀 -------------------------------------------------------------');
  console.log(`🚀 Wajda Real-time Server is running on: http://localhost:${PORT}`);
  try {
    await db.query('SELECT NOW()');
    console.log('🐘 PostgreSQL database connected successfully!');
  } catch (err) {
    console.error('❌ Database connection error:', err.message);
  }
  console.log('🚀 -------------------------------------------------------------');
});