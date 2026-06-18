const db = require('../../config/db');
const axios = require('axios'); 

// 1️⃣ دالة عرض صفحة إدارة الزبائن وجلب الإحصائيات الشاملة
const getClientsPage = async (req, res) => {
    try {
        // أ. استعلام الإحصائيات (يشمل فقط الحسابات التي دورها 'both' أو 'client')
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_clients,
                COUNT(*) FILTER (WHERE is_online = true) AS online_clients,
                COUNT(*) FILTER (WHERE account_status = 'banned') AS banned_clients,
                COUNT(*) FILTER (WHERE account_status = 'pending_verification') AS pending_clients
            FROM users 
            WHERE default_role IN ('both', 'client');
        `;

        // ب. استعلام جلب قائمة المستخدمين للجدول
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
            bannedClients: parseInt(stats.banned_clients) || 0,
            pendingClients: parseInt(stats.pending_clients) || 0
        };

        res.render('admin/clients', {
            activePage: 'clients', 
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

// 🎯 رابط الـ Discord Webhook لتتبع العمليات الرقابية
const DISCORD_STATUS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1517156290843902012/lYR2L02gOK0KAqhdI_PaY9kYc9i4-GxHajbkWOPG37KMYgcMCHyvzJhoP5E74lyUaL5X';

// 2️⃣ دالة تحديث حالة حساب الزبون (حظر / تفعيل المعلق) وإرسال التقرير لديسكورد
const toggleClientStatus = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; 
    
    let newStatus = 'active';
    let statusText = '🟢 Activated / Verified';
    let embedColor = 3066993; // كود اللون الأخضر الديسيمل في ديسكورد

    if (action === 'ban') {
        newStatus = 'banned';
        statusText = '🔴 Banned / Suspended';
        embedColor = 15158332; // كود اللون الأحمر الديسيمل في ديسكورد
    }

    try {
        // أ. فحص بيانات الزبون وسحب معلوماته الحالية قبل الكتابة والقشط في الداتا
        const clientBeforeQuery = `
            SELECT full_name, email, phone_number, current_city, wallet_balance, account_status 
            FROM users WHERE id = $1;
        `;
        const clientCheck = await db.query(clientBeforeQuery, [id]);
        
        if (clientCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const clientData = clientCheck.rows[0];

        // ب. تحديث حالة الحساب الحية للمستخدم مع استثناء الأدوار المزدوجة العالية إن وُجدت قسرياً
        const updateQuery = `
            UPDATE users 
            SET account_status = $1, updated_at = NOW() 
            WHERE id = $2 AND (default_role != 'both' OR default_role IS NULL)
            RETURNING id;
        `;
        const result = await db.query(updateQuery, [newStatus, id]);

        if (result.rowCount > 0) {
            
            // ج. استدعاء بيانات الإداري الفعلي المسؤل عن الحركة حالياً من الـ Session المستقرة
            const adminName = req.session?.adminName || 'System Admin';
            const adminRole = req.session?.adminRole || 'Administrator';

            // د. بناء الـ Embed الهيكلي الاحترافي بالكامل بالإنجليزية
            const discordEmbed = {
                username: "Wajda Moderation Radar",
                avatar_url: "https://api.getwajda.com/uploads/default-avatar.png",
                embeds: [
                    {
                        title: "⚙️ User Account Status Updated",
                        description: `**${adminName}** (${adminRole}) has programmatically modified a user's account status.`,
                        color: embedColor,
                        fields: [
                            {
                                name: "👤 Client Name",
                                value: `\`${clientData.full_name}\` (ID: ${id})`,
                                inline: true
                            },
                            {
                                name: "📞 Phone Number",
                                value: `${clientData.phone_number || 'Not Specified'}`,
                                inline: true
                            },
                            {
                                name: "📧 Email Address",
                                value: `${clientData.email}`,
                                inline: false
                            },
                            {
                                name: "🌆 Current City",
                                value: `${clientData.current_city || 'Not Specified'}`,
                                inline: true
                            },
                            {
                                name: "💰 Wallet Balance",
                                value: `**${clientData.wallet_balance} DZD**`,
                                inline: true
                            },
                            {
                                name: "🔄 Previous Status",
                                value: `\`${clientData.account_status}\``,
                                inline: true
                            },
                            {
                                name: "📊 New Action Taken",
                                value: `**${statusText}**`,
                                inline: false
                            }
                        ],
                        footer: {
                            text: "Live Moderation Logs - Wajda Platform",
                            icon_url: "https://api.getwajda.com/uploads/default-avatar.png"
                        },
                        timestamp: new Date().toISOString()
                    }
                ]
            };

            // بث إشعار الديسكورد في الخلفية كطلب غير متزامن لضمان سرعة رد السيرفر
            axios.post(DISCORD_STATUS_WEBHOOK_URL, discordEmbed)
                .catch(err => console.error('❌ Discord Status Webhook Failed:', err.message));

            res.json({ success: true, message: `تم تحديث حالة الحساب بنجاح وإرسال التقرير الإنجليزي` });
        } else {
            res.status(404).json({ success: false, message: 'لم يتم العثور على المستخدم المطلوب أو لا تملك الصلاحية لتعديله' });
        }

    } catch (error) {
        console.error('Error updating client status:', error);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديث الحالة' });
    }
};

// 3️⃣ تصدير الدوال بشكل موحد لضمان قراءتها بسلام داخل ملف الـ Routes
module.exports = {
    getClientsPage,
    toggleClientStatus
};