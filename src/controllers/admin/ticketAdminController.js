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
// 🔍 دالة جلب ومعاينة تذكرة معينة لمعالجتها والرد عليها
const viewTicketDetails = async (req, res) => {
  const { id } = req.params;

  try {
    const query = `
      SELECT 
        t.*, 
        COALESCE(u.full_name, 'زائر خارجي') as user_name,
        COALESCE(u.default_role, 'guest') as user_role
      FROM tickets t
      LEFT JOIN users u ON t.user_id = u.id
      WHERE t.id = $1 LIMIT 1;
    `;
    const result = await db.query(query, [id]);
    const ticket = result.rows[0];

    if (!ticket) {
      return res.status(404).send('عذراً، التذكرة المطلوبة غير موجودة.');
    }

    // إذا كانت التذكرة مفتوحة لأول مرة، نغير حالتها تلقائياً إلى "قيد المراجعة"
    if (ticket.status === 'open') {
      await db.query(`UPDATE tickets SET status = 'pending', updated_at = NOW() WHERE id = $1`, [id]);
      ticket.status = 'pending';
    }

    res.render('admin/view-ticket', {
      title: `معالجة تذكرة ${ticket.ticket_no} | واجدة`,
      adminName: req.session.adminName,
      adminRole: req.session.adminRole,
      activePage: 'tickets',
      ticket: ticket
    });

  } catch (error) {
    console.error('❌ Error inside viewTicketDetails:', error);
    res.status(500).send('خطأ داخلي أثناء جلب تفاصيل التذكرة.');
  }
};
module.exports = {
  renderTicketsDashboard,
  viewTicketDetails
};