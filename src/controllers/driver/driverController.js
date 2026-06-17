// src/controllers/driver/driverController.js

const db = require('../../config/db'); // 🎯 تم تصحيح المسار النسبي ليتوافق مع المجلد الفرعي الجديد
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// =========================================================================
// 🌐 1️⃣ دالة عرض الصفحة الرئيسية للكابتن (Dashboard View)
// =========================================================================
const renderDriverHome = async (req, res) => {
  const driverId = req.session.driverId;

  try {
    // 🔍 1. جلب البيانات المالية للمستخدم
    const driverQuery = `
      SELECT 
        full_name,
        COALESCE(wallet_balance, 0)::NUMERIC AS wallet_balance, 
        COALESCE(max_debt_limit, 0)::NUMERIC AS max_debt_limit, 
        COALESCE(total_driver_revenue, 0)::NUMERIC AS total_driver_revenue
      FROM users 
      WHERE id = $1 LIMIT 1;
    `;
    const driverResult = await db.query(driverQuery, [driverId]);
    const driverData = driverResult.rows[0];

    if (!driverData) {
        return res.redirect('/driver/login');
    }

    // 🔍 2. حساب عدد رحلات اليوم
    const todayTripsQuery = `
      SELECT COUNT(id) AS today_count 
      FROM invoices 
      WHERE driver_id = $1 
        AND created_at >= CURRENT_DATE;
    `;
    const tripsResult = await db.query(todayTripsQuery, [driverId]);
    const todayTripsCount = tripsResult.rows[0]?.today_count || 0;

    // 🔍 3. جلب سجل الفواتير السابقة بالكامل مع حقول الصورة الحقيقية (invoices)
    const invoicesQuery = `
      SELECT 
        invoice_no,
        order_type,
        total_platform_earnings::NUMERIC AS total_platform_earnings,
        trip_price::NUMERIC AS trip_price,
        driver_tax_amount::NUMERIC AS driver_tax_amount,
        driver_net_profit::NUMERIC AS driver_net_profit,
        created_at
      FROM invoices
      WHERE driver_id = $1
      ORDER BY created_at DESC
      LIMIT 20; -- جلب آخر 20 فاتورة مغلقة
    `;
    const invoicesResult = await db.query(invoicesQuery, [driverId]);

    // 🎯 4. تمرير البيانات وقائمة الفواتير إلى الـ EJS
    return res.render('driver/index', { 
      title: "لوحة تحكم الكابتن | - واجدة",
      driverName: driverData.full_name,
      walletBalance: parseFloat(driverData.wallet_balance).toFixed(2),
      maxDebtLimit: parseFloat(driverData.max_debt_limit).toFixed(0),
      totalRevenue: parseFloat(driverData.total_driver_revenue).toFixed(2),
      todayTrips: todayTripsCount,
      invoices: invoicesResult.rows // مصفوفة الفواتير الحقيقية
    });

  } catch (error) {
    console.error('❌ Error inside renderDriverHome:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل لوحة التحكم والفواتير.');
  }
};

// =========================================================================
// 🔐 2️⃣ واجهة عرض صفحة تسجيل الدخول (Login View)
// =========================================================================
const renderDriverLogin = async (req, res) => {
  try {
    // إذا كان السائق مسجل دخوله بالفعل ويملك صلاحية both، نوجهه تلقائياً للرئيسية
    if (req.session && req.session.driverId && req.session.driverRole === 'both') {
      return res.redirect('/driver/');
    }
    return res.render('driver/login', { error: null });
  } catch (error) {
    console.error('❌ Error inside renderDriverLogin:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة تسجيل الدخول.');
  }
};

// =========================================================================
// 🔐 3️⃣ دالة معالجة تسجيل دخول الكباتن (المحدثة بصمام الحفظ الفوري)
// =========================================================================
const processDriverLogin = async (req, res) => {
  const { uid, password } = req.body;

  if (!uid || !password) {
    return res.render('driver/login', { error: 'يرجى إدخال رقم الهاتف/البريد وكلمة المرور.' });
  }

  try {
    const query = `
      SELECT id, full_name, email, phone_number, password_hash, default_role, account_status 
      FROM users 
      WHERE (phone_number = $1 OR email = $1) LIMIT 1;
    `;
    const result = await db.query(query, [uid.trim()]);

    if (result.rows.length === 0) {
      return res.render('driver/login', { error: 'عذراً، البيانات المدخلة غير صحيحة أو الحساب غير موجود.' });
    }

    const user = result.rows[0];

    if (user.account_status === 'banned' || user.account_status === 'suspended') {
      return res.render('driver/login', { error: '🚫 عذراً يا كابتن، حسابك مقيد أو محظور مؤقتاً من قبل الإدارة.' });
    }

    // التحقق من صحة كلمة المرور المشفرة
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.render('driver/login', { error: 'كلمة المرور التي أدخلتها خاطئة، يرجى إعادة المحاولة.' });
    }

    // 🎯 1. حقن بيانات الجلسة (Session) الأساسية بالسيرفر
    req.session.driverId = user.id;
    req.session.driverName = user.full_name;
    req.session.driverRole = user.default_role;

    // ⚡ 2. صمام الأمان الفولاذي: إجبار السيرفر على حفظ الجلسة في الذاكرة قبل التوجيه
    req.session.save((err) => {
      if (err) {
        console.error('❌ [Session Save Error] فشل قفل وثبات الجلسة:', err);
        return res.render('driver/login', { error: 'حدث خطأ أثناء تهيئة جلسة الدخول.' });
      }

      // 🔄 الفرز اللوجستي الفوري والتوجيه التجاري بعد ضمان التثبيت:
      if (user.default_role === 'client') {
        console.log(`ℹ️ [User Redirected to Register]: المستخدم (${user.full_name}) زبون، تم توجيهه لترقية حسابه ككابتن.`);
        return res.redirect('/driver/register');
      }

      console.log(`🟢 [Driver Web Login Successfully]: الكابتن (${user.full_name}) دخل للوحة التحكم وثبتت جلسته.`);
      return res.redirect('/driver/');
    });

  } catch (error) {
    console.error('❌ Error inside processDriverLogin:', error);
    return res.render('driver/login', { error: 'حدث خطأ داخلي في السيرفر.' });
  }
};

// =========================================================================
// 📝 4️⃣ واجهة عرض صفحة ترقية الحساب (Register View)
// =========================================================================
const renderDriverRegister = async (req, res) => {
  try {
    return res.render('driver/register', { title: "انضم لكباتن واجدة | ترقية الحساب" });
  } catch (error) {
    console.error('❌ Error inside renderDriverRegister:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة التسجيل.');
  }
};

// =========================================================================
// 🚪 5️⃣ دالة تسجيل الخروج وتطهير الجلسة بالكامل (Logout)
// =========================================================================
const logoutDriver = (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('❌ Error destroying driver session:', err);
      return res.status(500).send('تعذر تسجيل الخروج.');
    }
    res.redirect('/driver/login');
  });
};
// 📄 واجهة عرض شروط وقوانين المنصة (Terms & Conditions View)
const renderDriverTerms = async (req, res) => {
  try {
    return res.render('driver/terms', { title: "الشروط والقوانين اللوجستية | واجدة" });
  } catch (error) {
    console.error('❌ Error inside renderDriverTerms:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة الشروط.');
  }
};
module.exports = { 
  renderDriverHome,
  renderDriverLogin,
  processDriverLogin,
  renderDriverRegister,
  logoutDriver,
  renderDriverTerms
};