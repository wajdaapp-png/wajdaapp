// استيراد ملف الاتصال المعتمد لديك في المشروع
const db = require('../../config/db');

const getDriversPage = async (req, res) => {
    try {
        // 1. حساب الإحصائيات من جدول المستخدمين والطلبات معاً
        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE default_role = 'both') AS total_drivers,
                COUNT(*) FILTER (WHERE is_online = true AND default_role = 'both') AS active_drivers,
                (SELECT COUNT(*) FROM driver_applications WHERE status = 'pending') AS pending_drivers,
                COUNT(*) FILTER (WHERE account_status = 'banned' AND default_role = 'both') AS banned_drivers
            FROM users;
        `;

        // 2. جلب الكباتن المعتمدين + طلبات الانضمام المعلقة معاً باستخدام LEFT JOIN
        const driversQuery = `
            SELECT 
                u.id, 
                u.full_name AS name, 
                u.phone_number AS phone, 
                u.wallet_balance::NUMERIC AS wallet_balance,
                u.account_status,
                da.status AS app_status,
                COALESCE(da.vehicle_type, 'car') AS vehicle_type, 
                COALESCE(da.vehicle_plate, 'N/A') AS plate_number,
                da.license_number,
                da.license_image,
                da.vehicle_image,
                da.working_city
            FROM users u
            LEFT JOIN driver_applications da ON u.id = da.user_id
            WHERE u.default_role = 'both' OR da.status = 'pending'
            ORDER BY da.created_at DESC, u.id DESC;
        `;

        const [statsResult, driversResult] = await Promise.all([
            db.query(statsQuery),
            db.query(driversQuery)
        ]);

        const stats = statsResult.rows[0];
        
        // فرز المصفوفة برمجياً لتسهيل عرضها في تبويبات الواجهة
        const allRecords = driversResult.rows;
        const certifiedDrivers = allRecords.filter(r => r.account_status === 'active' || r.account_status === 'banned');
        const pendingApplications = allRecords.filter(r => r.app_status === 'pending' && r.account_status !== 'both');

        const driversStats = {
            totalDrivers: parseInt(stats.total_drivers) || 0,
            activeDrivers: parseInt(stats.active_drivers) || 0,
            pendingDrivers: parseInt(stats.pending_drivers) || 0,
            bannedDrivers: parseInt(stats.banned_drivers) || 0
        };

        res.render('admin/drivers', {
            activePage: 'drivers',
            driversStats: driversStats,
            drivers: certifiedDrivers,         // الكباتن النشطين والمحظورين
            pendingApps: pendingApplications,   // طلبات الانتظار الجديدة
            adminName: req.session?.adminName || 'مدير النظام', 
            adminRole: req.session?.adminRole || 'مسؤول السائقين'
        });

    } catch (error) {
        console.error('Error fetching drivers data:', error);
        res.status(500).send('حدث خطأ داخلي في الخادم عند جلب بيانات الكباتن');
    }
};
// 2. تحديث حالة السائق (حظر الحساب أو إعادة تفعيله) - استجابة JSON للـ Fetch API في الـ View
const toggleDriverStatus = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; // ستحتوي على 'ban' أو 'activate'
    
    // تحويل الأكشن القادم من الواجهة إلى الحالة المقابلة في قاعدة البيانات
    let newStatus = 'active';
    if (action === 'ban') {
        newStatus = 'banned';
    } else if (action === 'activate') {
        newStatus = 'active';
    }

    try {
        // تحديث الحقل في جدول users باستخدام db.query
        const updateQuery = `
            UPDATE users 
            SET account_status = $1, updated_at = NOW() 
            WHERE id = $2 AND default_role = 'both'
            RETURNING id;
        `;
        
        const result = await db.query(updateQuery, [newStatus, id]);

        if (result.rowCount > 0) {
            res.json({ success: true, message: `تم تحديث حالة الكابتن بنجاح إلى ${newStatus}` });
        } else {
            res.status(404).json({ success: false, message: 'لم يتم العثور على الكابتن المطلوب' });
        }

    } catch (error) {
        console.error('Error updating driver status:', error);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديث الحالة' });
    }
};

// 3. صفحة تعديل بيانات كابتن معين
const getEditDriverPage = async (req, res) => {
    const { id } = req.params;
    try {
        const query = `SELECT * FROM users WHERE id = $1 AND default_role = 'both'`;
        const result = await db.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).send('الكابتن غير موجود');
        }

        res.render('admin/edit-driver', { 
            driver: result.rows[0],
            adminName: req.session?.adminName || 'مدير النظام',
            adminRole: req.session?.adminRole || 'مسؤول السائقين'
        });
    } catch (error) {
        console.error('Error fetching driver for edit:', error);
        res.status(500).send('خطأ في الخادم');
    }
};
const approveDriverApplication = async (req, res) => {
    const { id } = req.params; // معرف المستخدم (user_id)
    try {
        // 1. تحديث حالة الطلب في جدول الطلبات
        await db.query(`UPDATE driver_applications SET status = 'approved', updated_at = NOW() WHERE user_id = $1`, [id]);
        
        // 2. ترقية رتبة المستخدم وتفعيل حسابه في جدول users الرئيسي
        await db.query(`UPDATE users SET default_role = 'both', account_status = 'active', updated_at = NOW() WHERE id = $1`, [id]);

        res.json({ success: true, message: 'تم قبول الكابتن وترقية حسابه بنجاح! 🚀' });
    } catch (error) {
        console.error('Error approving driver:', error);
        res.status(500).json({ success: false, message: 'خطأ أثناء معالجة ترقية الكابتن' });
    }
};

// أضفها إلى module.exports الأسفل بجانب بقية الدوال
// تصدير الدوال البرمجية ككائن موحد جاهز للاستخدام في ملف الـ Routes
module.exports = {
    getDriversPage,
    toggleDriverStatus,
    getEditDriverPage,
    approveDriverApplication
    
};