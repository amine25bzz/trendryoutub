# TrendRadar — ترند يوتيوب

لوحة تفاعلية لمتابعة وتحليل أكثر مقاطع يوتيوب رواجاً (Trending) في مختلف الدول، مقسمة حسب النوع (عادي، Shorts، كيدز) مع إمكانية البحث المباشر في مقاطع وقنوات يوتيوب.

---

## 🚀 النشر على Vercel

تم تجهيز المشروع ليعمل مباشرة كـ Serverless على Vercel:

1. توجّه إلى لوحة تحكم [Vercel](https://vercel.com).
2. اختر **Add New...** ثم **Project**.
3. قم باستيراد مستودع GitHub الخاص بك: `trendryoutub`.
4. في قسم **Environment Variables** (متغيرات البيئة)، أضف المتغير التالي:
   - **الاسم (Key):** `YOUTUBE_API_KEY`
   - **القيمة (Value):** مفتاح YouTube Data API v3 الخاص بك.
5. اضغط **Deploy**.

بعد اكتمال النشر، ستحصل على رابط حي لمشروعك، وكل تعديل تدفعه إلى GitHub (`git push`) سيتم نشره تلقائياً.

---

## 💻 التشغيل المحلي (Local)

1. أنشئ ملف `.env` (أو عدّل على `.env.example`):
   ```env
   YOUTUBE_API_KEY=مفتاح_الـ_API_الخاص_بك
   PORT=3000
   ```
2. ثبّت الحزم:
   ```bash
   npm install
   ```
3. شغّل السيرفر:
   ```bash
   npm start
   ```
4. افتح المتصفح على: `http://localhost:3000`

---

## 📂 بنية المشروع

- `index.html`: واجهة المستخدم التفاعلية.
- `server.js`: خادم Node.js المحلي لمعالجة طلبات YouTube API والتخزين المؤقت (Cache).
- `api/trends.js`: دالة سحابية (Serverless Function) لجلب مقاطع الترند على Vercel.
- `api/search.js`: دالة سحابية للبحث في مقاطع وقنوات يوتيوب على Vercel.
- `vercel.json`: إعدادات منصة Vercel.
