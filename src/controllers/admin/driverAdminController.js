// استيراد ملف الاتصال المعتمد لديك في المشروع
const db = require('../../config/db');

// 1. جلب كافة السائقين وعرض الإحصائيات في الصفحة الرئيسية لإدارة الكباتن
const getDriversPage = async (req, res) => {
    try {
        // استعلام لحساب الإحصائيات الأربعة المطلوبة في الكروت العلوية للـ View
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_drivers,
                COUNT(*) FILTER (WHERE is_online = true) AS active_drivers,
                COUNT(*) FILTER (WHERE account_status = 'pending') AS pending_drivers,
                COUNT(*) FILTER (WHERE account_status = 'banned') AS banned_drivers
            FROM users 
            WHERE default_role = 'both';
        `;

        // استعلام جلب قائمة السائقين لجدول البيانات
        const driversQuery = `
            SELECT 
                id, 
                full_name AS name, 
                phone_number AS phone, 
                COALESCE(account_status, 'pending') AS status, 
                COALESCE(wallet_balance, 0) AS wallet_balance,
                -- قيم افتراضية مؤقتة لنوع السيارة ورقم اللوحة لعدم وجودها في جدول users
                'car' AS vehicle_type, 
                'N/A' AS plate_number
            FROM users 
            WHERE default_role = 'both'
            ORDER BY id DESC;
        `;

        // تنفيذ الاستعلامات باستخدام دالة db.query الممررة من ملف الإعدادات الخاص بك
        const [statsResult, driversResult] = await Promise.all([
            db.query(statsQuery),
            db.query(driversQuery)
        ]);

        const stats = statsResult.rows[0];

        // تحضير البيانات لتطابق المتغيرات في ملف الـ EJS تماماً
        const driversStats = {
            totalDrivers: parseInt(stats.total_drivers) || 0,
            activeDrivers: parseInt(stats.active_drivers) || 0,
            pendingDrivers: parseInt(stats.pending_drivers) || 0,
            bannedDrivers: parseInt(stats.banned_drivers) || 0
        };

        // إرسال البيانات وتصيير الصفحة
        res.render('admin/drivers', {
            activePage: 'drivers',
            driversStats: driversStats,
            drivers: driversResult.rows,
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

// تصدير الدوال البرمجية ككائن موحد جاهز للاستخدام في ملف الـ Routes
module.exports = {
    getDriversPage,
    toggleDriverStatus,
    getEditDriverPage,
    
};