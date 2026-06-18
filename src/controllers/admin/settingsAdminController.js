const db = require('../../config/db');
const nodemailer = require('nodemailer');
const axios = require('axios'); 

// 📜 1. جلب قائمة المسؤولين وعرض صفحة الإدارة
const getSettingsPage = async (req, res) => {
  try {
    const adminsQuery = `
      SELECT id, name, email, role, sub_role, COALESCE(is_active, true) AS is_active, created_at 
      FROM admins ORDER BY created_at DESC;
    `;
    const adminsResult = await db.query(adminsQuery);
    return res.render('admin/settings', {
      activePage: 'settings',
      adminList: adminsResult.rows,
      adminName: req.session?.adminName || 'مدير النظام',
      adminRole: req.session?.adminRole || 'المسؤول الإداري'
    });
  } catch (error) {
    console.error('❌ Error inside getSettingsPage:', error);
    return res.status(500).send('خطأ داخلي في السيرفر.');
  }
};

// ➕ 2. إنشاء حساب مسؤول جديد
const createAdmin = async (req, res) => {
  const { name, email, password, role, sub_role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'يرجى ملء كافة الحقول الأساسية.' });
  }

  try {
    // تشفير كلمة المرور
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // تحويل الصلاحيات الفرعية إلى مصفوفة صالحة لـ PostgreSQL (ARRAY)
    const subRoleArray = Array.isArray(sub_role) ? sub_role : (sub_role ? [sub_role] : []);

    const query = `
      INSERT INTO admins (name, email, password_hash, role, sub_role, is_active, created_at)
      VALUES ($1, $2, $3, $4, $5, true, NOW())
      RETURNING id;
    `;
    
    await db.query(query, [name, email, passwordHash, role, subRoleArray]);
    return res.status(201).json({ success: true, message: 'تم إنشاء حساب المسؤول بنجاح 🎉' });

  } catch (error) {
    console.error('❌ Error inside createAdmin:', error);
    if (error.code === '23505') { // خطأ تكرار البريد الإلكتروني فريد
      return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل بالفعل لمسؤول آخر.' });
    }
    return res.status(500).json({ success: false, message: 'خطأ سيرفر داخلي أثناء إنشاء الحساب.' });
  }
};

// 🔄 3. تعديل صلاحيات ورتب وحالة مسؤول حالي
const updateAdminPermissions = async (req, res) => {
  const { id, role, sub_role, is_active } = req.body;

  try {
    const subRoleArray = Array.isArray(sub_role) ? sub_role : (sub_role ? [sub_role] : []);
    
    const query = `
      UPDATE admins
      SET role = $1, sub_role = $2, is_active = $3, updated_at = NOW()
      WHERE id = $4;
    `;

    await db.query(query, [role, subRoleArray, is_active, id]);
    return res.status(200).json({ success: true, message: 'تم تحديث صلاحيات المسؤول بنجاح ✅' });

  } catch (error) {
    console.error('❌ Error inside updateAdminPermissions:', error);
    return res.status(500).json({ success: false, message: 'خطأ داخلي أثناء محاولة تحديث الصلاحيات.' });
  }
};

module.exports = {
  getSettingsPage,
  createAdmin,
  updateAdminPermissions
};