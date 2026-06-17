// src/controllers/homeController.js
const db = require('../../config/db');

// 🌐 1. الواجهة التعريفية الرئيسية (Landing Page)
const renderIndex = (req, res) => {
  try {
    return res.render('home/index', { title: 'واجدة | أسرع شبكة شحن وتوصيل في الزيبان' });
  } catch (error) {
    console.error('❌ Error inside renderIndex:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل الصفحة الرئيسية.');
  }
};

// ℹ️ 2. صفحة من نحن
const renderAbout = (req, res) => {
  try {
    return res.render('home/about', { title: 'من نحن | منصة واجدة' });
  } catch (error) {
    console.error('❌ Error inside renderAbout:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة من نحن.');
  }
};

// 🔒 3. صفحة سياسة الخصوصية
const renderPrivacy = (req, res) => {
  try {
    return res.render('home/privacy', { title: 'سياسة الخصوصية | منصة واجدة' });
  } catch (error) {
    console.error('❌ Error inside renderPrivacy:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة سياسة الخصوصية.');
  }
};

// 📜 4. صفحة شروط الاستخدام
const renderTerms = (req, res) => {
  try {
    return res.render('home/terms', { title: 'شروط الاستخدام | منصة واجدة' });
  } catch (error) {
    console.error('❌ Error inside renderTerms:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة شروط الاستخدام.');
  }
};

// 📞 5. صفحة الاتصال بالدعم الفني
const renderContact = (req, res) => {
  try {
    return res.render('home/contact', { title: 'الاتصال بالدعم الفني | منصة واجدة' });
  } catch (error) {
    console.error('❌ Error inside renderContact:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل صفحة الاتصال بالدعم.');
  }
};
// 🚀 دالة معالجة وحقن تذكرة الدعم الجديدة بالهاتف والإيميل (POST)
const createSupportTicket = async (req, res) => {
  try {
    const { phone, email, subject, priority, description } = req.body;

    // 1. توليد رقم تذكرة عشوائي فريد ومؤمن (مثال: TKT-2026-F982)
    const randomHex = Math.floor(1000 + Math.random() * 9000).toString(16).toUpperCase();
    const ticketNo = `TKT-2026-${randomHex}`;

    // 2. حقن التذكرة في قاعدة البيانات مع الحقول الجديدة وحفظ الـ user_id كـ null مؤقتاً للزوار
    const insertQuery = `
      INSERT INTO tickets (phone, email, subject, priority, description, status, ticket_no)
      VALUES ($1, $2, $3, $4, $5, 'open', $6)
      RETURNING ticket_no;
    `;
    
    await db.query(insertQuery, [phone, email, subject, priority, description, ticketNo]);

    // 3. إعادة التوجيه لصفحة الدعم مع تجميل الرسالة التفاعلية
    return res.send(`
      <script>
        alert('🎉 تم فتح تذكرة الدعم الفني بنجاح! رقم تذكرتك الرسمي هو: ${ticketNo}\\nسيتواصل معك فريق الدعم عبر الهاتف: ${phone}');
        window.location.href = '/contact';
      </script>
    `);

  } catch (error) {
    console.error('❌ Error inside createSupportTicket:', error);
    return res.status(500).send('حدث خطأ فني أثناء محاولة إرسال التذكرة لقاعدة البيانات.');
  }
};
// 🎯 تصدير جميع الدوال ليتعرف عليها ملف الـ Routes بأمان
module.exports = {
  renderIndex,
  renderAbout,
  renderPrivacy,
  renderTerms,
  renderContact,
  createSupportTicket
};