const db = require('../../config/db');

const getOrdersPage = async (req, res) => {
    try {
        // 1. استعلام حساب إحصائيات الرحلات الحالية
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_orders,
                COUNT(*) FILTER (WHERE status IN ('pending', 'searching')) AS pending_orders,
                COUNT(*) FILTER (WHERE status IN ('accepted', 'ongoing', 'arrived')) AS live_active_orders,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled_orders
            FROM core_orders;
        `;

        // 2. استعلام جلب قائمة الطلبات مع عمل JOIN لجلب أسماء الزبائن والكباتن
        const ordersQuery = `
            SELECT 
                o.id,
                o.order_type,
                COALESCE(o.status, 'pending') AS status,
                o.pickup_address,
                o.dropoff_address,
                o.created_at,
                c.full_name AS client_name,
                d.full_name AS driver_name
            FROM core_orders o
            LEFT JOIN users c ON o.user_id = c.id
            LEFT JOIN users d ON o.driver_id = d.id
            ORDER BY o.created_at DESC
            LIMIT 50;
        `;

        const [statsResult, ordersResult] = await Promise.all([
            db.query(statsQuery),
            db.query(ordersQuery)
        ]);

        const stats = statsResult.rows[0];

        const ordersStats = {
            totalOrders: parseInt(stats.total_orders) || 0,
            pendingOrders: parseInt(stats.pending_orders) || 0,
            liveActiveOrders: parseInt(stats.live_active_orders) || 0,
            cancelledOrders: parseInt(stats.cancelled_orders) || 0
        };

        res.render('admin/orders', {
            activePage: 'orders', // لتفعيل الخلفية البرتقالية لزر تتبع الرحلات حياً في السايدبار
            ordersStats: ordersStats,
            orders: ordersResult.rows,
            adminName: req.session?.adminName || 'مدير النظام', 
            adminRole: req.session?.adminRole || 'غرفة المراقبة'
        });

    } catch (error) {
        console.error('Error fetching live orders data:', error);
        res.status(500).send('حدث خطأ داخلي في الخادم عند جلب رادار الطلبات الحية');
    }
};

module.exports = {
    getOrdersPage
};