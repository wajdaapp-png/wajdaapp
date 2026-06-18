const db = require('../../config/db');
const nodemailer = require('nodemailer');
const axios = require('axios'); 

// تهيئة الـ Transporter الخاص بـ Namecheap SMTP
console.log('✉️ [SMTP Init]: Initializing Nodemailer transporter with Namecheap config...');
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'mail.privateemail.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true, 
    auth: {
        user: process.env.SMTP_USER, 
        pass: process.env.SMTP_PASS  
    },
    tls: {
        rejectUnauthorized: false
    }
});

// 1️⃣ دالة عرض صفحة إدارة الزبائن وجلب الإحصائيات الشاملة
const getClientsPage = async (req, res) => {
    console.log('🔍 [GetClientsPage]: Fetching dashboard statistics and user list...');
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) AS total_clients,
                COUNT(*) FILTER (WHERE is_online = true) AS online_clients,
                COUNT(*) FILTER (WHERE account_status = 'banned') AS banned_clients,
                COUNT(*) FILTER (WHERE account_status = 'pending_verification') AS pending_clients
            FROM users 
            WHERE default_role IN ('both', 'client');
        `;

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

        console.log('📊 [GetClientsPage]: Executing concurrent database queries...');
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

        console.log(`✅ [GetClientsPage]: Data loaded successfully. Total: ${clientsStats.totalClients}, Pending: ${clientsStats.pendingClients}`);

        res.render('admin/clients', {
            activePage: 'clients', 
            clientsStats: clientsStats,
            clients: clientsResult.rows,
            adminName: req.session?.adminName || 'مدير النظام', 
            adminRole: req.session?.adminRole || 'مسؤول النظام'
        });

    } catch (error) {
        console.error('❌ [GetClientsPage Error]:', error);
        res.status(500).send('حدث خطأ داخلي في الخادم عند جلب بيانات الزبائن');
    }
};

// 🎯 رابط الـ Discord Webhook
const DISCORD_STATUS_WEBHOOK_URL = 'https://discord.com/api/webhooks/1517156290843902012/lYR2L02gOK0KAqhdI_PaY9kYc9i4-GxHajbkWOPG37KMYgcMCHyvzJhoP5E74lyUaL5X';

// 2️⃣ دالة تحديث حالة حساب الزبون (حظر / تفعيل المعلق) + إرسال إشعار ديسكورد + إرسال الإيميل الرسمي
const toggleClientStatus = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; 
    
    console.log(`\n🚀 [ToggleStatus Started]: Incoming request for User ID: [${id}] | Action: [${action}]`);
    
    // طباعة وفحص بيانات الجلسة الحية في الـ Log فوراً لمعرفة هوية الأدمن
    console.log(`🔑 [Admin Session Check]: Session Admin Name: [${req.session?.adminName}] | Role: [${req.session?.adminRole}]`);

    let newStatus = 'active';
    let statusText = '🟢 Activated / Verified';
    let embedColor = 3066993; 

    if (action === 'ban') {
        newStatus = 'banned';
        statusText = '🔴 Banned / Suspended';
        embedColor = 15158332; 
    }

    try {
        // أ. فحص بيانات الزبون الحالية
        console.log(`📡 [DB Fetch]: Checking existing client data for ID: ${id}...`);
        const clientBeforeQuery = `
            SELECT full_name, email, phone_number, current_city, wallet_balance, account_status 
            FROM users WHERE id = $1;
        `;
        const clientCheck = await db.query(clientBeforeQuery, [id]);
        
        if (clientCheck.rowCount === 0) {
            console.warn(`⚠️ [DB Fetch Warning]: User with ID ${id} not found in database.`);
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const clientData = clientCheck.rows[0];
        console.log(`👤 [Client Found]: Name: [${clientData.full_name}] | Email: [${clientData.email}] | Status Before: [${clientData.account_status}]`);
        
        // ب. تحديث حالة الحساب الحية للمستخدم في قاعدة البيانات
        console.log(`💾 [DB Update]: Updating status to [${newStatus}] for ID: ${id}...`);
        const updateQuery = `
            UPDATE users 
            SET account_status = $1, updated_at = NOW() 
            WHERE id = $2 AND (default_role != 'both' OR default_role IS NULL)
            RETURNING id;
        `;
        const result = await db.query(updateQuery, [newStatus, id]);

        if (result.rowCount > 0) {
            console.log(`📊 [DB Update Success]: Row updated in PostgreSQL for User ID: ${id}`);
            
            const adminName = req.session?.adminName || 'System Admin';
            const adminRole = req.session?.adminRole || 'Administrator';

            // -----------------------------------------------------------
            // 🎯 ج. بناء وإرسال الإيميل التلقائي بناءً على الإجراء
            // -----------------------------------------------------------
            let emailSubject = '';
            let emailHtmlContent = '';

            if (action === 'activate') {
                emailSubject = '🥳 تم تفعيل حسابك بنجاح | منصة واجدة';
                emailHtmlContent = `
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
                    </style>
                    <div style="direction: rtl; text-align: right; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #111; color: #fff; padding: 35px; border-radius: 24px; border: 1px solid #222; max-width: 550px; margin: 0 auto; shadow: 0 10px 30px rgba(0,0,0,0.5);">
                        <h2 style="font-family: 'Cairo', sans-serif; font-weight: 900; color: #FF6B00; margin-bottom: 20px; font-size: 22px;">مرحباً بك في عائلة واجدة! 🌴</h2>
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 700; font-size: 15px; line-height: 1.6;">عزيزنا العميل <strong>${clientData.full_name}</strong>،</p>
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 400; font-size: 14px; line-height: 1.6; color: #b3b3b3;">يسعدنا إبلاغك بأن إدارة المنصة قد قامت بـ <strong>مراجعة حسابك وتفعيله بنجاح</strong>.</p>
                        
                        <div style="background-color: #161616; padding: 15px; border-radius: 16px; border: 1px solid #2A2A2A; margin: 25px 0; text-align: center;">
                            <p style="font-family: 'Cairo', sans-serif; font-weight: 700; margin: 0; font-size: 14px; color: #fff;">حالة الحساب الآن: <span style="color: #44FF44; font-weight: bold;">نشط (Active) 🟢</span></p>
                        </div>
                        
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 400; font-size: 13px; line-height: 1.6; color: #b3b3b3;">يمكنك الآن فتح التطبيق فوراً، واستخدام رادار الخرائط الحي، وطلب الرحلات والشحنات بكل حرية وبأعلى سرعة لوجستية.</p>
                        <hr style="border: 0; border-top: 1px solid #222; margin: 25px 0;">
                        <small style="font-family: 'Cairo', sans-serif; font-weight: 400; color: #666; display: block; text-align: center; font-size: 11px;">منظومة واجدة اللوجستية المتكاملة - بسكرة 🌴</small>
                    </div>
                `;
            } else if (action === 'ban') {
                emailSubject = '⚠️ تنبيه أمني: تعليق حسابك | منصة واجدة';
                emailHtmlContent = `
                    <style>
                        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap');
                    </style>
                    <div style="direction: rtl; text-align: right; font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #111; color: #fff; padding: 35px; border-radius: 24px; border: 1px solid #222; max-width: 550px; margin: 0 auto;">
                        <h2 style="font-family: 'Cairo', sans-serif; font-weight: 900; color: #FF3333; margin-bottom: 20px; font-size: 22px;">تنبيه أمني هام 🛑</h2>
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 700; font-size: 15px; line-height: 1.6;">المستخدم <strong>${clientData.full_name}</strong>،</p>
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 400; font-size: 14px; line-height: 1.6; color: #b3b3b3;">نأسف لإبلاغك بأن إدارة الرقابة والأمان في منصة واجدة قد قامت بـ <strong style="color: #FF3333;">حظر وتجميد حسابك</strong> نظراً لمخالفة شروط الاستخدام العام أو سياسات التعامل المالي.</p>
                        
                        <div style="background-color: #161616; padding: 15px; border-radius: 16px; border: 1px solid #2A2A2A; margin: 25px 0; text-align: center;">
                            <p style="font-family: 'Cairo', sans-serif; font-weight: 700; margin: 0; font-size: 14px; color: #fff;">حالة الحساب الحالية: <span style="color: #FF3333; font-weight: bold;">محظور (Banned) 🔴</span></p>
                        </div>
                        
                        <p style="font-family: 'Cairo', sans-serif; font-weight: 400; font-size: 13px; line-height: 1.6; color: #999;">إذا كنت تعتقد أن هذا الحظر تم عن طريق الخطأ، أو ترغب في تسوية مديونية معلقة لإعادة تفعيل الحساب، يرجى التواصل فوراً مع الإدارة العليا عبر قنوات الدعم الرسمية.</p>
                        <hr style="border: 0; border-top: 1px solid #222; margin: 25px 0;">
                        <small style="font-family: 'Cairo', sans-serif; font-weight: 400; color: #666; display: block; text-align: center; font-size: 11px;">مكتب الأمن السيبراني والرقابة - منصة واجدة</small>
                    </div>
                `;
            }

            const mailOptions = {
                from: `"منصة واجدة" <${process.env.SMTP_USER}>`,
                to: clientData.email,
                subject: emailSubject,
                html: emailHtmlContent
            };

            console.log(`✉️ [SMTP Dispatch]: Attempting to broadcast email to [${clientData.email}] using user: [${process.env.SMTP_USER}]...`);
            transporter.sendMail(mailOptions)
                .then(info => console.log(`📬 [SMTP Success Check]: Email dispatched successfully to ${clientData.email}. Response: ${info.response}`))
                .catch(err => console.error('❌ [SMTP Failed Check]: NodeMailer encountered an error:', err));


            // -----------------------------------------------------------
            // د. بناء وإرسال الـ Embed لديسكورد
            // -----------------------------------------------------------
            console.log(`🛰️ [Discord Dispatch]: Assembling embed log packet for Discord Webhook...`);
            const discordEmbed = {
                username: "Wajda Moderation Radar",
                avatar_url: "https://api.getwajda.com/uploads/default-avatar.png",
                embeds: [
                    {
                        title: "⚙️ User Account Status Updated",
                        description: `**${adminName}** (${adminRole}) has programmatically modified a user's account status.`,
                        color: embedColor,
                        fields: [
                            { name: "👤 Client Name", value: `\`${clientData.full_name}\` (ID: ${id})`, inline: true },
                            { name: "📞 Phone Number", value: `${clientData.phone_number || 'Not Specified'}`, inline: true },
                            { name: "📧 Email Address", value: `${clientData.email}`, inline: false },
                            { name: "🌆 Current City", value: `${clientData.current_city || 'Not Specified'}`, inline: true },
                            { name: "💰 Wallet Balance", value: `**${clientData.wallet_balance} DZD**`, inline: true },
                            { name: "🔄 Previous Status", value: `\`${clientData.account_status}\``, inline: true },
                            { name: "📊 New Action Taken", value: `**${statusText}**`, inline: false }
                        ],
                        footer: {
                            text: "Live Moderation Logs - Wajda Platform",
                            icon_url: "https://api.getwajda.com/uploads/default-avatar.png"
                        },
                        timestamp: new Date().toISOString()
                    }
                ]
            };

            axios.post(DISCORD_STATUS_WEBHOOK_URL, discordEmbed)
                .then(() => console.log('🏁 [Discord Success Check]: Webhook log posted to Discord.'))
                .catch(err => console.error('❌ [Discord Failed Check]: Webhook failed to post:', err.message));

            res.json({ success: true, message: `تم تحديث حالة الحساب، وإخطار الزبون بالإيميل، وبث الإشارة للديسكورد` });
        } else {
            console.warn(`⚠️ [DB Update Failed]: Query executed but no rows affected. Check default_role exclusion constraint.`);
            res.status(404).json({ success: false, message: 'لم يتم العثور على المستخدم المطلوب أو لا تملك الصلاحية لتعديله' });
        }

    } catch (error) {
        console.error('❌ [Fatal Controller Error]:', error);
        res.status(500).json({ success: false, message: 'خطأ في قاعدة البيانات أثناء تحديث الحالة' });
    }
};

module.exports = {
    getClientsPage,
    toggleClientStatus
};