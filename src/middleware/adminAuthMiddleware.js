// src/middleware/adminAuthMiddleware.js
const jwt = require('jsonwebtoken');

// 📊 مصفوفة توزيع الصلاحيات والروابط المسموحة لها قسراً
const rolePermissions = {
  management_officer: ['dashboard', 'drivers', 'clients', 'orders', 'finance', 'notifications', 'settings', 'tickets'],
  software_admin:     ['dashboard', 'drivers', 'clients', 'orders', 'finance', 'notifications', 'settings', 'tickets'],
  finance_officer:    ['dashboard', 'finance'],
  drivers_manager:    ['dashboard', 'drivers'],
  clients_manager:    ['dashboard', 'clients'],
  orders_manager:     ['dashboard', 'orders'],
  notifications_manager: ['dashboard', 'notifications'],
  support_team:       ['dashboard', 'tickets']
};

const adminAuthMiddleware = (req, res, next) => {
  const token = req.cookies.admin_session;

  // 📑 سطر التشخيص الحاسم لمعرفة سبب الطرد
  console.log('🔍 [Middleware Check] الكوكي المستلم في المتصفح هو:', token ? '✅ موجود ومشفر' : '❌ غائب تماماً (Undefined)');

  if (!token) {
    console.log('⚠️ [Security Alert]: تم طرد الحساب لعدم وجود توكن جلسة.');
    return res.redirect('/admin/login');
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'WAJDA_SECRET_SUPER_KEY_2026');

    // حقن البيانات في الـ Request
    req.admin = {
      id: decoded.admin_id,
      name: decoded.name,
      role: decoded.role,       // owner أو admin
      sub_role: decoded.sub_role // قد يكون نصاً أو مصفوفة قادمة من البوستجرس
    };

    next();
  } catch (error) {
    console.error('❌ [Middleware Error]: رمز الجلسة تالف أو منتهي.');
    res.clearCookie('admin_session');
    return res.redirect('/admin/login');
  }
};

// 🎯 2. ميدلواير فحص الصلاحيات الفرعية وتوليد الـ Sidebar ديناميكياً
const checkAdminPermission = (requiredPermission) => {
  return (req, res, next) => {
    // التحقق الاحتياطي من وجود بيانات الـ admin بعد فك التوكن
    if (!req.admin) {
      return res.redirect('/admin/login');
    }

    const subRoleData = req.admin.sub_role;
    let allowedPages = [];

    // 🧼 [معالجة الـ Array الجوهرية]: تحويل مصفوفات البوستجرس إلى فحص مرن مدمج
    if (Array.isArray(subRoleData)) {
      // إذا كان للمستخدم عدة أدوار (مثل الـ owner في صورتك)، نجمع كل صلاحياته في قائمة واحدة
      subRoleData.forEach(role => {
        if (rolePermissions[role]) {
          allowedPages = [...allowedPages, ...rolePermissions[role]];
        }
      });
      // تنظيف المصفوفة من التكرار
      allowedPages = [...new Set(allowedPages)];
    } else if (typeof subRoleData === 'string') {
      // تنظيف الأقواس الحاصرة إن وجدت بسبب طبيعة البوستجرس العشوائية في قراءة الـ Arrays أحياناً
      const cleanRole = subRoleData.replace(/[{}]/g, '');
      allowedPages = rolePermissions[cleanRole] || [];
    }

    // 🟢 التحقق من امتلاك الصلاحية المطلوبة للمسار
    if (allowedPages.includes(requiredPermission)) {
      // إرسال المصفوفة للـ EJS لبناء روابط السايدبار المسموحة فقط
      res.locals.allowedPages = allowedPages;
      res.locals.adminName = req.admin.name;
      res.locals.adminRole = Array.isArray(subRoleData) ? subRoleData[0] : subRoleData; // للغرض العرضي الأسفل
      return next();
    }

    // 🛑 الرد بالمنع في حال عدم المطابقة
    return res.status(403).send(`
      <div style="text-align:center; padding:50px; background:#121212; color:#fff; font-family:Cairo,sans-serif; min-height:100vh;">
        <h1 style="color:#f97316;">🛑 وصول غير مصرح به لغرفة القيادة</h1>
        <p>حسابك الإداري لا يملك الصلاحية الأمنية الكافية لدخول بوابة: [${requiredPermission}].</p>
        <a href="/admin/dashboard" style="color:#fff; background:#f97316; padding:10px 20px; border-radius:8px; text-decoration:none; display:inline-block; margin-top:20px;">العودة للرادار المركزي</a>
      </div>
    `);
  };
};

module.exports = {
  adminAuthMiddleware,
  checkAdminPermission
};