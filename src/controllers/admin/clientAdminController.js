const db = require('../../config/db');
const axios = require('axios'); // 🚀 استدعاء مكتبة axios لإرسال طلب الـ Webhook

// رابط الـ Discord Webhook الخاص بك
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1517152619984982016/Ehj5Es0fjc3o4iujUjmclzCX6UberfUW20Z4GfuIXizXMJwDFm6SAwK3xQQLjc8FAsXJ';

const toggleClientStatus = async (req, res) => {
    const { id } = req.params;
    const { action } = req.body; 
    
    let newStatus = 'active';
    let statusText = '🟢 تنشيط / تفعيل الحساب';
    let embedColor = 3066993; // اللون الأخضر برمز الـ Decimal في ديسكورد

    if (action === 'ban') {
        newStatus = 'banned';
        statusText = '🔴 حظر الحساب الأمني';
        embedColor = 15158332; // اللون الأحمر برمز الـ Decimal في ديسكورد
    }

    try {
        // 1. جلب بيانات الزبون الحالية قبل التحديث لإرسالها في الـ Embed
        const clientBeforeQuery = `
            SELECT full_name, email, phone_number, current_city, wallet_balance, account_status 
            FROM users WHERE id = $1;
        `;
        const clientCheck = await db.query(clientBeforeQuery, [id]);
        
        if (clientCheck.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'لم يتم العثور على المستخدم المطلوب' });
        }

        const clientData = clientCheck.rows[0];

        // 2. تحديث حالة الحساب في قاعدة البيانات
        const updateQuery = `
            UPDATE users 
            SET account_status = $1, updated_at = NOW() 
            WHERE id = $2 AND (default_role != 'both' OR default_role IS NULL)
            RETURNING id;
        `;
        const result = await db.query(updateQuery, [newStatus, id]);

        if (result.rowCount > 0) {
            
            // 🎯 3. بناء وإرسال الـ Embed التفصيلي الدقيق إلى ديسكورد
            const adminName = req.session?.adminName || 'مدير النظام';
            const adminRole = req.session?.adminRole || 'مسؤول';

            const discordEmbed = {
                username: "رادار إدارة واجدة",
                avatar_url: "https://api.getwajda.com/uploads/default-avatar.png", // يمكنك وضع لوجو المنصة هنا
                embeds: [
                    {
                        title: "⚙️ تحديث حالة حساب زبون",
                        description: `قام **${adminName}** (${adminRole}) بتغيير حالة الحساب برمجياً.`,
                        color: embedColor,
                        fields: [
                            {
                                name: "👤 اسم الزبون",
                                value: `\`${clientData.full_name}\` (ID: ${id})`,
                                inline: true
                            },
                            {
                                name: "📞 رقم الهاتف",
                                value: `${clientData.phone_number || 'لا يوجد'}`,
                                inline: true
                            },
                            {
                                name: "📧 البريد الإلكتروني",
                                value: `${clientData.email}`,
                                inline: false
                            },
                            {
                                name: "🌆 المدينة الحالية",
                                value: `${clientData.current_city || 'غير محددة'}`,
                                inline: true
                            },
                            {
                                name: "💰 رصيد المحفظة الحالي",
                                value: `**${clientData.wallet_balance} د.ج**`,
                                inline: true
                            },
                            {
                                name: "🔄 الحالة السابقة",
                                value: `\`${clientData.account_status}\``,
                                inline: true
                            },
                            {
                                name: "📊 الحالة الجديدة المتخذة",
                                value: `**${statusText}**`,
                                inline: false
                            }
                        ],
                        footer: {
                            text: "منظومة مراقبة منصة واجدة الحية",
                            icon_url: "https://api.getwajda.com/uploads/default-avatar.png"
                        },
                        timestamp: new Date().toISOString()
                    }
                ]
            };

            // إرسال البيانات خلف الكواليس دون تعطيل رد السيرفر للوكيل
            axios.post(DISCORD_WEBHOOK_URL, discordEmbed)
                .catch(err => console.error('❌ فشل إرسال إشعار الديسكورد:', err.message));

            // الرد على لوحة التحكم بالنجاح
            res.json({ success: true, message: `تم تحديث حالة الحساب بنجاح وإرسال التقرير` });
        } else {
            res.status(404).json({ success: false, message: 'فشل التحديث، قد لا تملك الصلاحية الأمنية لتعديل هذا الحساب' });
        }

    } catch (error) {
        console.error('Error updating client status & sending webhook:', error);
        res.status(500).json({ success: false, message: 'خطأ داخلي أثناء تحديث الحالة وبث الإشارة' });
    }
};