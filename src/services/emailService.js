// src/services/emailService.js

const nodemailer = require('nodemailer'); // 🎯 صمام الأمان: استدعاء المكتبة المفقودة هنا

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

const sendEmailInvoice = async (toEmail, clientName, invoiceNo, orderId, orderType, tripPrice, fixedFee, totalAmount, promoPercent) => {
    const typeText = orderType === 'shopping' ? '🛒 طلب شراء وتوصيل مقاضي' : '📦 خدمة شحن ونقل طرد أمانة';
    const dateText = new Date().toLocaleDateString('ar-DZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>فاتورة رحلة واجدة</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0a0a; color: #ffffff; margin: 0; padding: 0; text-align: right; }
            .wrapper { max-width: 600px; margin: 20px auto; background-color: #121212; border: 1px solid #1c1c1c; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.5); }
            .header { background: linear-gradient(135deg, #ff6b00, #ff8c32); padding: 30px; text-align: center; }
            .header h1 { margin: 0; font-size: 28px; color: #ffffff; font-weight: 900; letter-spacing: 1px; }
            .header p { margin: 5px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px; }
            .content { padding: 30px; }
            .greeting { font-size: 16px; color: #ffffff; margin-bottom: 20px; font-weight: 600; }
            .details-box { background-color: #1c1c1c; border: 1px solid #2a2a2a; border-radius: 12px; padding: 16px; margin-bottom: 25px; }
            .details-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #2a2a2a; font-size: 13px; }
            .details-row:last-child { border-bottom: none; }
            .details-label { color: #888888; }
            .details-value { color: #ffffff; font-weight: bold; text-align: left; width: 50%; }
            .invoice-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            .invoice-table th { background-color: #1c1c1c; color: #888888; text-align: right; padding: 12px; font-size: 12px; font-weight: 600; border-bottom: 2px solid #2a2a2a; }
            .invoice-table td { padding: 14px 12px; font-size: 14px; border-bottom: 1px solid #1c1c1c; color: #ffffff; }
            .invoice-table th:last-child, .invoice-table td:last-child { text-align: left; }
            .total-section { margin-top: 20px; background-color: #1c1c1c; border-radius: 12px; padding: 16px; border-right: 4px solid #ff6b00; }
            .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
            .total-row.final { font-size: 18px; font-weight: bold; color: #ff6b00; margin-top: 10px; padding-top: 10px; border-top: 1px dashed #2a2a2a; }
            .total-value-left { text-align: left; width: 50%; }
            .promo-badge { background-color: rgba(46, 204, 113, 0.15); color: #2ecc71; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin-right: 6px; display: inline-block; }
            .footer { background-color: #080808; padding: 20px; text-align: center; font-size: 11px; color: #555555; border-top: 1px solid #1c1c1c; }
            .footer a { color: #ff6b00; text-decoration: none; }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <div class="header">
                <h1>وَاجِدَة</h1>
                <p>إيصال الدفع الرقمي والمالي الفوري</p>
            </div>
            <div class="content">
                <div class="greeting">مرحباً بك يا رفيق، \${clientName} 👋</div>
                <p style="font-size: 13px; color: #aaaaaa; line-height: 1.6; margin-bottom: 25px;">
                    نشكرك على استخدام منصة واجدة لتلبية احتياجاتك اللوجستية. لقد اكتملت رحلتك بنجاح بفضل الكابتن، وإليك تفاصيل الفاتورة المالية الرسمية الصادرة من المنظومة:
                </p>
                
                <div class="details-box">
                    <div class="details-row">
                        <span class="details-label">رقم الفاتورة:</span>
                        <span class="details-value" style="color: #ff6b00; letter-spacing: 0.5px;">\${invoiceNo}</span>
                    </div>
                    <div class="details-row">
                        <span class="details-label">معرف الطلب بالرادار:</span>
                        <span class="details-value">#\${orderId}</span>
                    </div>
                    <div class="details-row">
                        <span class="details-label">تاريخ الإصدار:</span>
                        <span class="details-value">\${dateText}</span>
                    </div>
                    <div class="details-row">
                        <span class="details-label">نوع الخدمة المفعّلة:</span>
                        <span class="details-value">\${typeText}</span>
                    </div>
                </div>

                <table class="invoice-table">
                    <thead>
                        <tr>
                            <th>البند والبيان الخدمي</th>
                            <th>التكلفة والرسوم</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>\${orderType === 'shopping' ? 'الميزانية المالية للمنتجات المتفق عليها الأجر' : 'أجر خدمة الكابتن لتوصيل الأمانة'}</td>
                            <td>\${tripPrice.toFixed(0)} د.ج</td>
                        </tr>
                        <tr>
                            <td>رسوم حماية وتأمين الخدمة الحية للمنصة</td>
                            <td>\${(fixedFee / (1 - (promoPercent / 100)) || 50).toFixed(0)} د.ج</td>
                        </tr>
                    </tbody>
                </table>

                <div class="total-section">
                    \${promoPercent > 0 ? 
                        \`<div class="total-row" style="color: #2ecc71;">
                            <span>كابون خصم واجدة المطبّق:</span>
                            <span class="total-value-left"><span class="promo-badge">%\${promoPercent} خصم</span></span>
                        </div>\` 
                    : ''}
                    <div class="total-row">
                        <span class="details-label">صافي رسوم الخدمة بعد التخفيض:</span>
                        <span class="total-value-left" style="color: #ffffff; font-weight: bold;">\${fixedFee.toFixed(0)} د.ج</span>
                    </div>
                    <div class="total-row final">
                        <span>المبلغ الإجمالي المدفوع كاش:</span>
                        <span class="total-value-left">\${totalAmount.toFixed(0)} د.ج</span>
                    </div>
                </div>
            </div>
            <div class="footer">
                <p>هذه فاتورة آلية صادرة من خادم نظام تطبيق واجدة ولا تحتاج إلى توقيع يدوّي.</p>
                <p>إذا كان لديك أي استفسار، يرجى التواصل مع الدعم الفني عبر التطبيق أو زيارة موقعنا <a href="https://wajda.app">wajda.app</a></p>
                <p style="margin-top: 15px; color: #333;">© 2026 تطبيق واجدة اللوجستي. جميع الحقوق محفوظة.</p>
            </div>
        </div>
    </body>
    </html>
    `;

    const mailOptions = {
        from: `"منصة واجدة اللوجستية" <${process.env.SMTP_USER}>`,
        to: toEmail,
        subject: `🧾 فاتورة رحلة رقم #${orderId} - تطبيق واجدة`,
        html: htmlContent
    };

    return transporter.sendMail(mailOptions);
};

module.exports = { sendEmailInvoice };