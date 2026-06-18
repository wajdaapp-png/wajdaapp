const db = require('../config/db'); // قاعدة البيانات لحفظ الأكواد مؤقتاً
const { sendWajdaOTP } = require('../services/smsService'); // دالة إرسال الـ SMS التي كتبناها سابقاً

// 📞 1. دالة توليد وإرسال كود الـ OTP
const sendOtp = async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ success: false, message: 'رقم الهاتف مطلوب' });
    }

    // توليد كود عشوائي من 6 أرقام
    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
    // تحديد وقت انتهاء الكود (بعد 5 دقائق مثلاً)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    console.log(`🎲 [OTP Generate]: Generated code ${generatedOtp} for phone ${phone}`);

    try {
        // حفظ أو تحديث الكود في قاعدة البيانات (نفترض وجود جدول باسم phone_verifications)
        const upsertQuery = `
            INSERT INTO phone_verifications (phone_number, code, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (phone_number) 
            DO UPDATE SET code = $2, expires_at = $3, updated_at = NOW();
        `;
        await db.query(upsertQuery, [phone, generatedOtp, expiresAt]);

        // بث الرسالة النصية فوراً عبر بوابة EasySendSMS
        const smsResult = await sendWajdaOTP(phone, generatedOtp);

        if (smsResult.success) {
            return res.json({ success: true, message: 'تم إرسال كود التحقق بنجاح' });
        } else {
            return res.status(500).json({ success: false, message: 'فشل إرسال الرسالة النصية من المزود' });
        }

    } catch (error) {
        console.error('❌ [OTP Send Error]:', error.message);
        return res.status(500).json({ success: false, message: 'خطأ داخلي في السيرفر أثناء معالجة الـ OTP' });
    }
};

// 🔑 2. دالة التحقق من الكود المدخل من المستخدم
const verifyOtp = async (req, res) => {
    const { phone, code } = req.body;

    if (!phone || !code) {
        return res.status(400).json({ success: false, message: 'جميع الحقول مطلوبة' });
    }

    try {
        // جلب الكود المخزن للرقم للتأكد من صحته ووقت صلاحيته
        const query = `
            SELECT code, expires_at FROM phone_verifications 
            WHERE phone_number = $1;
        `;
        const result = await db.query(query, [phone]);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, message: 'لم يتم طلب كود تحقق لهذا الرقم' });
        }

        const verification = result.rows[0];

        // 1. فحص تطابق الكود
        if (verification.code !== code) {
            return res.status(400).json({ success: false, message: 'كود التحقق غير صحيح ❌' });
        }

        // 2. فحص وقت انتهاء الصلاحية
        if (new Date() > new Date(verification.expires_at)) {
            return res.status(400).json({ success: false, message: 'انتهت صلاحية الكود، يرجى طلب كود جديد ⏱️' });
        }

        // إذا نجح التحقق، نقوم بمسح الكود من الجدول حتى لا يُستخدم مجدداً
        await db.query('DELETE FROM phone_verifications WHERE phone_number = $1;', [phone]);

        return res.json({ success: true, message: 'تم توثيق رقم الهاتف بنجاح 🎉' });

    } catch (error) {
        console.error('❌ [OTP Verify Error]:', error.message);
        return res.status(500).json({ success: false, message: 'خطأ في الخادم أثناء التحقق من الكود' });
    }
};

module.exports = { sendOtp, verifyOtp };