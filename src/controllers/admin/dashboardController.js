// src/controllers/admin/dashboardController.js
const db = require('../../config/db');
const getLiveStatsData = async () => {
  const [driversRes, pendingRes,todayTrips, financeRes, recentInvoicesRes, orderTypesRes] = await Promise.all([
    db.query(`SELECT COUNT(*) FROM users d JOIN users u ON d.id = u.id WHERE u.account_status = 'active' AND d.is_online = true AND u.default_role = 'both';`),
    db.query(`SELECT COUNT(*) FROM core_orders WHERE status IN ('pending_offers', 'active', 'picked_up');`),
    db.query(`SELECT COUNT(*) FROM core_orders WHERE status IN ('completed', 'reviewed') AND created_at >= NOW() - INTERVAL '24 hours';`),
    db.query(`SELECT COALESCE(SUM(total_platform_earnings), 0) as total FROM public.invoices WHERE created_at::date = CURRENT_DATE;`),
    db.query(`
      SELECT invoice_no, order_type, total_invoice_amount, total_platform_earnings, driver_net_profit, created_at 
      FROM public.invoices 
      ORDER BY id DESC 
      LIMIT 5;
    `),

    db.query(`
      SELECT order_type, COUNT(*) as count 
      FROM public.invoices 
      GROUP BY order_type;
    `)
  ]);
  
  return {
    activeDrivers: driversRes.rows[0].count || 0,
    pendingOrders: pendingRes.rows[0].count || 0,
    todayTrips: todayTrips.rows[0].count || 0,
    todayEarnings: parseFloat(financeRes.rows[0].total || 0).toLocaleString('ar-DZ'),
    recentInvoices: recentInvoicesRes.rows, 
    orderTypes: orderTypesRes.rows
  };
};

// الدالة الأساسية لعرض الصفحة لأول مرة (HTTP GET)
const showDashboard = async (req, res) => {
  try {
    if (!req.admin) return res.redirect('/admin/login');

    // استدعاء الدالة المركزية لجلب الداتا الحالية بذكاء
    const stats = await getLiveStatsData();

    return res.render('admin/dashboard', { 
      activePage: 'dashboard',  
      adminName: req.admin.name, 
      adminRole: req.admin.sub_role,
      stats
    });
  } catch (error) {
    console.error('❌ Dashboard view error:', error);
    return res.status(500).send('حدث خطأ داخلي.');
  }
};


module.exports = {
  showDashboard,
  getLiveStatsData
  
};