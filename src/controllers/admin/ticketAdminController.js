// src/controllers/adminController.js
const db = require('../../config/db');

const renderTicketsDashboard = async (req, res) => {
  try {
    // 🔍 الاستعلام المحدث: جلب الهاتف والإيميل مع دعم LEFT JOIN للمسجلين والزوار معاً
    const ticketsQuery = `
      SELECT 
        t.id,
        t.ticket_no,
        t.subject,
        t.priority,
        t.status,
        t.created_at,
        t.phone,
        t.email,
        COALESCE(u.full_name, 'زائر خارجي') as full_name,
        COALESCE(u.default_role, 'guest') as default_role
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      ORDER BY 
        CASE WHEN t.status = 'open' THEN 1 WHEN t.status = 'pending' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT 50;
    `;
    const result = await db.query(ticketsQuery);

    return res.render('admin/tickets', {
      title: "تذاكر الدعم الفني | واجدة",
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      activePage: 'tickets',
      tickets: result.rows
    });
  } catch (error) {
    console.error('❌ Error inside renderTicketsDashboard:', error);
    return res.status(500).send('حدث خطأ أثناء تحميل نظام التذاكر.');
  }
};

module.exports = {
  renderTicketsDashboard
};