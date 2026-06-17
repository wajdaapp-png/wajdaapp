const db = require('../../config/db');

const getClientsPage = async (req, res) => {
    try {
       // 1. استعلام الإحصائيات (يشمل فقط الحسابات التي دورها 'both' أو 'client')
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_clients,
                COUNT(*) FILTER (WHERE is_online = true) AS online_clients,
                COUNT(*) FILTER (WHERE account_status = 'banned') AS banned_clients
            FROM users 
            WHERE default_role IN ('both', 'client');
        `;

        // 2. استعلام جلب قائمة المستخدمين للجدول (يشمل فقط 'both' و 'client')
        const clientsQuery = `
            SELECT 
                id, 
                full_name AS name, 
                phone_number AS phone, 
                email,
                current_city,
                avatar_url,
                COALESCE(account_status, 'active') AS status, 
                COALESCE(wallet_balance, 0) AS wallet_balance
            FROM users 
            WHERE default_role IN ('both', 'client')
            ORDER BY id DESC;
        `;

        const [statsResult, clientsResult] = await Promise.all([
            db.query(statsQuery),
            db.query(clientsQuery)
        ]);

        const stats = statsResult.rows[0];

        const clientsStats = {
            totalClients: parseInt(stats.total_clients) || 0,
            onlineClients: parseInt(stats.online_clients) || 0,
            bannedClients: parseInt(stats.banned_clients) || 0
        };

        res.render('admin/clients', {
            activePage: 'clients', // تفعيل الخلفية البرتقالية لزر إدارة الزبائن في السايدبار
            clientsStats: clientsStats,
            clients: clientsResult.rows,
            adminName: req.session?.adminName || 'مدير النظام', 
            adminRole: req.session?.adminRole || 'مسؤول النظام'
        });

    } catch (error) {
        console.error('Error fetching clients data:', error);
        res.status(500).send('حدث خطأ داخلي في الخادم عند جلب بيانات الزبائن');
    }
};

// تحديث حالة حساب الزبون (حظر / تفعيل)
const toggleClientStatus = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; 
    
    let newStatus = 'active';
    if (action === 'ban') {
        newStatus = 'banned';
    } else if (action === 'activate') {
        newStatus = 'active';
    }

    try {
        const updateQuery = `
            UPDATE users 
            SET account_status = $1, updated_at = NOW() 
            WHERE id = $2 AND (default_role != 'both' OR default_role IS NULL)
            RETURNING id;
        `;
        
        const result = await db.query(updateQuery, [newStatus, id]);

        if (result.rowCount > 0) {
            res.json({ success: true, message: `تم تحديث حالة الحساب بنجاح` });
        } else {
            res.status(404).json({ success: false, message: 'لم يتم العثور على المستخدم المطلوب' });
        }

    } catch (error) {
        console.error('Error updating client status:', error);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديث الحالة' });
    }
};

module.exports = {
    getClientsPage,
    toggleClientStatus
};