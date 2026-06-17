// src/controllers/admin/notificationAdminController.js
const db = require('../../config/db'); // تأكد من صحة مسار ملف قاعدة البيانات الموحدة

// =========================================================================
// 📜 1. جلب سجل الإشعارات وعرض صفحة لوحة التحكم (Render EJS)
// =========================================================================
const getNotificationsPage = async (req, res) => {
  try {
    const query = `
      SELECT 
        id, title, body, COALESCE(image_url, '') AS image_url, 
        expiry_date, created_at, recipient_type,
        cardinality(viewed_by_users) AS total_views -- حساب عدد المشاهدات الفعلي حياً من طول الـ Array
      FROM notifications
      ORDER BY created_at DESC;
    `;
    
    const result = await db.query(query);

    // عرض الصفحة وتمرير البيانات المطلوبة بما فيها activePage لمنع خطأ الـ Sidebar
    return res.render('admin/notifications', {
      activePage: 'notifications', // تفعيل الزر الخاص بالإشعارات في القائمة الجانبية
      notifications: result.rows,
      adminName: req.session?.adminName || 'مدير النظام', 
      adminRole: req.session?.adminRole || 'المسؤول الإداري'
    });

  } catch (error) {
    console.error('❌ Error inside getNotificationsPage Admin Controller:', error);
    return res.status(500).send('خطأ سيرفر داخلي أثناء تحميل صفحة الإشعارات.');
  }
};

// =========================================================================
// 📢 2. إنشاء وضخ إشعار جديد موجه للفئات من لوحة التحكم حياً
// =========================================================================
const createNotification = async (req, res) => {
  const { title, body, image_url, expiry_date, recipient_type } = req.body;

  if (!title || !body || !recipient_type) {
    return res.status(400).json({ 
      success: false, 
      message: 'المعطيات ناقصة. يرجى ملء العناوين والنصوص وتحديد فئة المستلم بدقة.' 
    });
  }

  try {
    const query = `
      INSERT INTO notifications (title, body, image_url, expiry_date, recipient_type, viewed_by_users)
      VALUES ($1, $2, $3, $4, $5, '{}')
      RETURNING id, created_at;
    `;

    const values = [
      title,
      body,
      image_url || null,
      expiry_date || null,
      recipient_type // 'driver', 'client', 'all'
    ];

    const result = await db.query(query, values);

    console.log(`📢 [Admin Notification]: تم ضخ إشعار بنجاح برقم [#${result.rows[0].id}] للفئة: (${recipient_type})`);

    return res.status(201).json({
      success: true,
      message: 'تم إرسال وضخ الإشعار بنجاح في المنظومة الموحدة ✅',
      notification: result.rows[0]
    });

  } catch (error) {
    console.error('❌ Error inside createNotification Admin Controller:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'خطأ داخلي في الخادم أثناء محاولة تسجيل وإرسال التنبيه.' 
    });
  }
};

// =========================================================================
// 📜 3. جلب سجل الإشعارات المرسلة مسبقاً كـ API
// =========================================================================
const getAllSentNotifications = async (req, res) => {
  try {
    const query = `
      SELECT 
        id, title, body, COALESCE(image_url, '') AS image_url, 
        expiry_date, created_at, recipient_type,
        cardinality(viewed_by_users) AS total_views
      FROM notifications
      ORDER BY created_at DESC;
    `;
    
    const result = await db.query(query);

    return res.status(200).json({
      success: true,
      notifications: result.rows
    });
  } catch (error) {
    console.error('❌ Error inside getAllSentNotifications Admin Controller:', error);
    return res.status(500).json({ success: false, message: 'خطأ سيرفر داخلي أثناء جلب السجل.' });
  }
};

module.exports = {
  getNotificationsPage,
  createNotification,
  getAllSentNotifications
};