const db = require('../../config/db');

// 📜 1. جلب بيانات التقارير المالية وإعدادات المنظومة
const getFinancePage = async (req, res) => {
    try {
        // استعلام حساب الإحصائيات المالية الكلية من جدول الفواتير
        const statsQuery = `
            SELECT 
                COALESCE(SUM(total_invoice_amount), 0) AS total_turnover,
                COALESCE(SUM(total_platform_earnings), 0) AS total_platform_cut,
                COALESCE(SUM(driver_net_profit), 0) AS total_drivers_cut,
                COUNT(*) AS total_invoices_count
            FROM invoices;
        `;

        // استعلام جلب سجل التدفقات المالية الشامل للجدول
        const ledgerQuery = `
            SELECT 
                i.id, i.invoice_no, i.order_type, i.trip_price,
                i.total_platform_earnings AS platform_share,
                i.driver_net_profit AS driver_share,
                i.total_invoice_amount AS total_amount,
                i.created_at, c.full_name AS client_name, d.full_name AS driver_name
            FROM invoices i
            LEFT JOIN users c ON i.client_id = c.id
            LEFT JOIN users d ON i.driver_id = d.id
            ORDER BY i.created_at DESC
            LIMIT 50;
        `;

        // استعلام جلب إعدادات الضرائب والرسوم الحية (مطابق تماماً لبيانات قاعدة البيانات المرفقة)
        const settingsQuery = `
            SELECT 
                MAX(CASE WHEN key_name = 'driver_tax_percentage' THEN key_value END) AS driver_tax,
                MAX(CASE WHEN key_name = 'client_fixed_fee' THEN key_value END) AS client_fee,
                MAX(CASE WHEN key_name = 'min_delivery_price' THEN key_value END) AS min_price
            FROM system_settings;
        `;

        const [statsResult, ledgerResult, settingsResult] = await Promise.all([
            db.query(statsQuery),
            db.query(ledgerQuery),
            db.query(settingsQuery)
        ]);

        const stats = statsResult.rows[0];
        const currentSettings = settingsResult.rows[0] || { driver_tax: 5.00, client_fee: 50.00, min_price: 100.00 };

        const financeStats = {
            totalTurnover: parseFloat(stats.total_turnover).toFixed(2),
            totalPlatformCut: parseFloat(stats.total_platform_cut).toFixed(2),
            totalDriversCut: parseFloat(stats.total_drivers_cut).toFixed(2),
            totalInvoicesCount: parseInt(stats.total_invoices_count) || 0
        };

        res.render('admin/finance', {
            activePage: 'finance',
            financeStats: financeStats,
            transactions: ledgerResult.rows,
            sysSettings: currentSettings, // تمرير الإعدادات الضريبية للـ EJS
            adminName: req.session?.adminName || 'مدير النظام', 
            adminRole: req.session?.adminRole || 'مسؤول الحسابات'
        });

    } catch (error) {
        console.error('Error fetching finance data:', error);
        res.status(500).send('حدث خطأ داخلي في الخادم عند جلب التقارير المالية');
    }
};

// 💾 2. دالة حفظ وتحديث الرسوم والضرائب الفورية (API)
const updateTaxSettings = async (req, res) => {
    const { driver_tax, client_fee, min_price } = req.body;
    try {
        // تحديث جماعي للمفاتيح الثلاثة داخل قاعدة البيانات بشكل متوازٍ وآمن
        const queries = [
            db.query(`UPDATE system_settings SET key_value = $1, updated_at = NOW() WHERE key_name = 'driver_tax_percentage';`, [driver_tax]),
            db.query(`UPDATE system_settings SET key_value = $1, updated_at = NOW() WHERE key_name = 'client_fixed_fee';`, [client_fee]),
            db.query(`UPDATE system_settings SET key_value = $1, updated_at = NOW() WHERE key_name = 'min_delivery_price';`, [min_price])
        ];
        
        await Promise.all(queries);
        return res.status(200).json({ success: true, message: 'تم حفظ المتغيرات المالية وتعميمها على الخوادم بنجاح ✅' });
    } catch (error) {
        console.error('Error updating tax settings:', error);
        return res.status(500).json({ success: false, message: 'فشل تحديث المعطيات المالية في قاعدة البيانات.' });
    }
};

module.exports = {
    getFinancePage,
    updateTaxSettings
};