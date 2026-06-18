const db = require('../config/db');

const checkPromoCode = async (req, res) => {
    const { code, user_id } = req.body;
    
    if (!code || !user_id) {
        return res.status(400).json({ success: false, message: "معطيات الفحص ناقصة." });
    }

    const cleanCode = code.trim().toUpperCase();

    try {
        // 1. التحقق من أن المستخدم لم يستهلك الكود سابقاً
        const userCheck = await db.query('SELECT used_promo_codes FROM users WHERE id = $1', [user_id]);
        if (userCheck.rows.length > 0) {
            const usedCodes = userCheck.rows[0].used_promo_codes || [];
            if (usedCodes.includes(cleanCode)) {
                return res.status(400).json({ success: false, message: "عذراً، لقد قمت باستخدام كود الخصم هذا مسبقاً! 🛑" });
            }
        }

        // 2. فحص صلاحية الكود وجودته داخل جدول الأكواد
        const promoResult = await db.query(
            'SELECT * FROM promo_codes WHERE code = $1 AND is_active = true',
            [cleanCode]
        );

        if (promoResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "كود الخصم غير صحيح أو منتهي الصلاحية ❌" });
        }

        const promo = promoResult.rows[0];

        // 3. فحص تاريخ انتهاء الصلاحية
        if (new Date(promo.expiry_date) < new Date()) {
            return res.status(400).json({ success: false, message: "للأسف، هذا الكود انتهت مدة صلاحيته ⏱️" });
        }

        // 4. فحص مصفوفة الـ IDs المخصصة
        if (promo.allowed_user_ids && promo.allowed_user_ids.length > 0) {
            if (!promo.allowed_user_ids.includes(parseInt(user_id, 10))) {
                return res.status(403).json({ success: false, message: "هذا الكود مخصص لحسابات معينة فقط 🔒" });
            }
        }

        return res.status(200).json({
            success: true,
            message: "تم تطبيق الكود بنجاح! 🎉",
            discount_percentage: promo.discount_percentage
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ success: false, message: "خطأ سيرفر داخلي أثناء معالجة الكود." });
    }
};

module.exports = { checkPromoCode };