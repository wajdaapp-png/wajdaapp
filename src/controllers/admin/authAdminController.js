// src/controllers/admin/authAdminController.js
const db = require('../../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ==========================================
// 🔓 1. عرض واجهة تسجيل الدخول (GET)
// ==========================================
const showLoginPage = (req, res) => {
  return res.render('admin/login', { error: null });
};

// ==========================================
// 🔐 2. معالجة وتدقيق بيانات تسجيل الدخول (POST)
// ==========================================
const processLogin = async (req, res) => {
  const email = req.body.email.trim();
  const password = req.body.password.trim();

  try {
    const query = `SELECT * FROM admins WHERE email = $1 LIMIT 1;`;
    const result = await db.query(query, [email]);

    if (result.rows.length === 0) {
      return res.render('admin/login', { error: 'عذراً، هذا البريد الإلكتروني غير مسجل بصلاحيات إدارية.' });
    }

    const admin = result.rows[0];

    if (admin.is_active === false) {
      return res.render('admin/login', { error: 'تم تجميد هذا الحساب الإداري. يرجى مراجعة إدارة واجدة العليا.' });
    }

    const secureHash = admin.password_hash ? admin.password_hash.trim() : '';

    const isMatch = await bcrypt.compare(password, secureHash);

    if (!isMatch) {
      return res.render('admin/login', { error: 'كلمة المرور الأمنية غير صحيحة، يرجى إعادة المحاولة.' });
    }

    await db.query(`UPDATE admins SET last_login = NOW() WHERE id = $1;`, [admin.id]);

    // 🔥 [التعديل الجوهري 1]: ملء الـ Session بالبيانات التي يبحث عنها الـ Middleware فوراً
    req.session.adminId = admin.id;
    req.session.adminName = admin.name;
    req.session.adminRole = admin.sub_role; // ربط الـ sub_role بالـ adminRole المستعملة في الصلاحيات

    // 🎫 2. توليد الـ Token الاحتياطي
    const token = jwt.sign(
      { 
        admin_id: admin.id, 
        name: admin.name,
        role: admin.role,      
        sub_role: admin.sub_role 
      },
      process.env.JWT_SECRET || 'WAJDA_SECRET_SUPER_KEY_2026',
      { expiresIn: '24h' }
    );

    res.cookie('admin_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', 
      maxAge: 24 * 60 * 60 * 1000 
    });

    console.log(`🔑 [Admin Session Established]: سجل [${admin.name}] الدخول بنجاح برتبة (${admin.sub_role})`);

    // 🚀 العبور الآن سيصبح أخضر ومصرح به مئة بالمئة
    return res.redirect('/admin/dashboard');

  } catch (error) {
    console.error('❌ Error inside processLogin Admin Controller:', error);
    return res.render('admin/login', { error: 'حدث خطأ داخلي في السيرفر أثناء معالجة طلب الدخول.' });
  }
};

// ==========================================
// 🚪 3. تسجيل الخروج وتدمير الجلسة (GET)
// ==========================================
const logout = (req, res) => {
  // 🔥 [التعديل الجوهري 2]: تدمير الـ Session ومسح الكوكي معاً لتصفير الحساب بالكامل
  res.clearCookie('admin_session');
  if (req.session) {
    req.session.destroy((err) => {
      if (err) console.error('❌ Error destroying session:', err);
      return res.redirect('/admin/login');
    });
  } else {
    return res.redirect('/admin/login');
  }
};

module.exports = {
  showLoginPage,
  processLogin,
  logout
};