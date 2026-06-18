// src/controllers/adminController.js
const db = require('../../config/db');
const nodemailer = require('nodemailer');
const axios = require('axios'); 

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
const handleTicketResponse = async (req, res) => {
    const { id } = req.params;
    const { status, reply_message } = req.body;

    try {
        // 1. جلب بيانات التذكرة الحالية لمعرفة إيميل المرسل ورقم التذكرة
        const ticketQuery = await db.query('SELECT ticket_no, email, subject FROM tickets WHERE id = $1 LIMIT 1', [id]);
        const ticket = ticketQuery.rows[0];

        if (!ticket) {
            return res.status(404).send('التذكرة غير موجودة.');
        }

        // 2. تحديث حالة التذكرة في قاعدة البيانات
        await db.query(
            `UPDATE tickets SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, id]
        );

        // 3. إذا كتبت الإدارة رداً نصياً، نقوم بشحنه فوراً عبر البريد الإلكتروني الرسمي
        if (reply_message && reply_message.trim() !== '' && ticket.email) {
            
            const mailOptions = {
                from: `"دعم منصة واجدة 🎫" <${process.env.SMTP_USER}>`,
                to: ticket.email.trim(),
                subject: `رد رسمي بشأن تذكرتكم رقم: ${ticket.ticket_no} - ${ticket.subject}`,
                text: reply_message, // النسخة النصية العادية
                html: `
                    <div dir="rtl" style="font-family: 'Cairo', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f9f9f9; color: #333; line-height: 1.6;">
                        <div style="max-w: 600px; margin: 0 auto; bg-color: #fff; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                            <div style="background-color: #FF6B00; padding: 20px; text-align: center;">
                                <h2 style="color: #ffffff; margin: 0; font-size: 20px;">منصة واجدة اللوجستية | Wajda</h2>
                            </div>
                            <div style="padding: 30px;">
                                <p style="font-size: 14px; color: #666;">مرحباً بك،</p>
                                <p style="font-size: 14px; font-weight: bold; color: #111;">بخصوص تذكرة الدعم الفني الخاصة بكم ذات الرقم المرجعي: <span style="color: #FF6B00;">${ticket.ticket_no}</span></p>
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                                <div style="background-color: #f3f4f6; p: 15px; padding: 15px; border-radius: 8px; font-size: 13px; color: #222; white-space: pre-wrap;">
                                    ${reply_message.replace(/\n/g, '<br>')}
                                </div>
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                                <p style="font-size: 11px; color: #999; text-align: center;">هذا البريد تم إرساله آلياً من غرفة قيادة عمليات واجدة. يرجى عدم الرد المباشر عليه.</p>
                            </div>
                        </div>
                    </div>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`✉️ [SMTP Success]: تم بث الرد اللوجستي بنجاح لإيميل الكابتن/الزبون: ${ticket.email}`);
        }

        // إعادة التوجيه لمركز التذاكر مع إشعار النجاح
        return res.redirect('/admin/tickets');

    } catch (error) {
        console.error('❌ Error inside handleTicketResponse:', error);
        return res.status(500).send('حدث خطأ أثناء معالجة الرد وبث الإيميل.');
    }
};
module.exports = {
  renderTicketsDashboard,
  viewTicketDetails,
  handleTicketResponse
};