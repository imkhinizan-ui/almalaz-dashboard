import React, { useState, useEffect, useMemo, useRef } from "react";
import { projectImage } from "./assets/projectImage.js";
import { supabase, TRANSACTIONS_TABLE, SETTINGS_TABLE, loginAppUser, changeOwnPassword, adminResetPassword } from "./supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell,
} from "recharts";
import {
  Plus, Trash2, TrendingUp, TrendingDown, Wallet,
  HardHat, Landmark, Wind, ClipboardCheck, Layers, X, Loader2,
  Pencil,
} from "lucide-react";

/* ---------------------------------------------------------------
   الثوابت المالية للمشروع (بيانات ثابتة كما زوّدنا بها المستخدم)
---------------------------------------------------------------- */
const LAND_BASE = 4238078;
const TAX_RATE = 0.05;
const COMMISSION_RATE = 0.025;
const TAX_AMOUNT = LAND_BASE * TAX_RATE;
const COMMISSION_AMOUNT = LAND_BASE * COMMISSION_RATE;
const LAND_TOTAL = LAND_BASE + TAX_AMOUNT + COMMISSION_AMOUNT;

const CONSTRUCTION_COST = 4250000;
const MEP_COST = 500000; // مصاعد + مطابخ + تكييف + تركيب
// تكلفة الإشراف لم يُتفق عليها بعد، لذلك أصبحت رقمًا قابلاً للتعديل من الشركاء
// (0 مبدئيًا) بدل ثابت مباشر، وتخزَّن محليًا وتدخل ضمن كل الحسابات المرتبطة بها
const DEFAULT_SUPERVISION_COST = 0;

// دالة تبني قائمة البنود بناءً على تكلفة الإشراف الحالية (تتغيّر كلما عُدّلت)
function buildCategories(supervisionCost) {
  return [
    { id: "land", label: "الأرض (شامل الضريبة والسعي)", planned: LAND_TOTAL, icon: Landmark },
    { id: "construction", label: "تكلفة البناء", planned: CONSTRUCTION_COST, icon: HardHat },
    { id: "mep", label: "مصاعد ومطابخ وتكييف", planned: MEP_COST, icon: Wind },
    { id: "supervision", label: "الإشراف", planned: supervisionCost, icon: ClipboardCheck },
    { id: "other", label: "أخرى", planned: 0, icon: Layers },
  ];
}

// تسميات نوع الحركة كما يظهر للمستخدم
const TYPE_LABELS = {
  expense: "دفعة إشراف للمقاول",
  contribution: "دفعة تمويل مشروع",
  contractor_advance: "دفعة عاجلة من المقاول",
  contractor_settlement: "تسوية / استلام المقاول من الشركاء",
};

// دفعات الأرض (ثابتة، تمت مرة واحدة) تُعرض دائمًا تحت تصنيف "قيمة شراء أرض"
// بدل تسمية النوع العامة، بغض النظر عن نوع الحركة الداخلي المستخدم في الحسابات
const LAND_PURCHASE_LABEL = "قيمة شراء أرض";
const transactionTypeLabel = (t) =>
  t.category === "land" ? LAND_PURCHASE_LABEL : TYPE_LABELS[t.type] || t.type;

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024; // 2 ميجابايت كحد أقصى للمستند المرفق

const PARTNERS = [
  { id: "saeed", name: "سعيد الغامدي", share: 0.5 },
  { id: "ibrahim", name: "إبراهيم الخنيزان", share: 0.5 },
];

const CONTRACTOR = "عبدالله الغامدي";
const CONTRACTOR_ID = "contractor";

// معرّف الطرف (شريك أو المقاول) لأي حركة -> الاسم المعروض
const actorName = (id) =>
  id === CONTRACTOR_ID ? CONTRACTOR : PARTNERS.find((p) => p.id === id)?.name || id;

// نستخدم en-US لضمان عرض الأرقام بالأرقام الإنجليزية دائمًا (٠١٢٣ -> 0123)
// مع فواصل واضحة للآلاف والملايين، بغض النظر عن لغة أو إعدادات جهاز المستخدم
const fmt = (n) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n || 0));

const todayStr = () => new Date().toISOString().slice(0, 10);

// تحويل الأرقام العربية/الفارسية (٠١٢٣...) إلى أرقام لاتينية حتى يعمل الإدخال
// بغض النظر عن لوحة مفاتيح المستخدم
const toWesternDigits = (str) =>
  String(str ?? "")
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d))
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d))
    .replace(/٫/g, ".") // الفاصلة العشرية العربية
    .replace(/[٬,]/g, ""); // فواصل الآلاف العربية/اللاتينية

// الأرض (شاملة الضريبة والسعي) تم سدادها بالكامل بواقع 50% من كل شريك
// هذه الحركات ثابتة: لا تُعدَّل ولا تُحذف (locked: true)
const SEED_TRANSACTIONS = [
  {
    id: "seed_land_saeed",
    type: "expense",
    partner: "saeed",
    category: "land",
    amount: LAND_TOTAL * 0.5,
    date: todayStr(),
    reference: "",
    note: "سداد حصة 50% من قيمة الأرض شاملة الضريبة والسعي",
    locked: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "seed_land_ibrahim",
    type: "expense",
    partner: "ibrahim",
    category: "land",
    amount: LAND_TOTAL * 0.5,
    date: todayStr(),
    reference: "",
    note: "سداد حصة 50% من قيمة الأرض شاملة الضريبة والسعي",
    locked: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

/* -------------------- طبقة التخزين (سحابية عبر Supabase، مشتركة بين الجميع) -------------------- */
const LOCKED_IDS = new Set(["seed_land_saeed", "seed_land_ibrahim"]);

// يضمن اكتمال كل حقول الحركة (القفل / المرفق) بغض النظر عن مصدرها
function normalizeTransaction(t) {
  return {
    ...t,
    locked: LOCKED_IDS.has(t.id) ? true : !!t.locked,
    reference: t.reference || "",
    note: t.note || "",
    attachment: t.attachment || null,
  };
}

// تحويل صف قاعدة البيانات (snake_case) إلى كائن الحركة المستخدم في الواجهة (camelCase)
function rowToTransaction(row) {
  return normalizeTransaction({
    id: row.id,
    type: row.type,
    partner: row.partner,
    category: row.category,
    amount: Number(row.amount),
    date: row.date,
    reference: row.reference,
    note: row.note,
    attachment: row.attachment,
    locked: row.locked,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// تحويل كائن الحركة إلى صف جاهز للإرسال إلى Supabase
function transactionToRow(t) {
  return {
    id: t.id,
    type: t.type,
    partner: t.partner,
    category: t.category,
    amount: t.amount,
    date: t.date,
    reference: t.reference || "",
    note: t.note || "",
    attachment: t.attachment || null,
    locked: !!t.locked,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

async function fetchTransactions() {
  const { data, error } = await supabase
    .from(TRANSACTIONS_TABLE)
    .select("*")
    .order("date", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToTransaction);
}

async function insertTransactionRow(t) {
  const { error } = await supabase.from(TRANSACTIONS_TABLE).insert(transactionToRow(t));
  if (error) throw error;
}

async function updateTransactionRow(t) {
  const { error } = await supabase.from(TRANSACTIONS_TABLE).update(transactionToRow(t)).eq("id", t.id);
  if (error) throw error;
}

async function deleteTransactionRow(id) {
  const { error } = await supabase.from(TRANSACTIONS_TABLE).delete().eq("id", id);
  if (error) throw error;
}

// عند أول استخدام للجدول (فارغ)، نثبّت أن الأرض مسدّدة بالكامل بواقع 50% من كل شريك
async function seedIfEmpty() {
  const { count, error } = await supabase
    .from(TRANSACTIONS_TABLE)
    .select("id", { count: "exact", head: true });
  if (error) throw error;
  if (!count) {
    const { error: insertError } = await supabase
      .from(TRANSACTIONS_TABLE)
      .insert(SEED_TRANSACTIONS.map(transactionToRow));
    if (insertError) throw insertError;
  }
}

// إعدادات المشروع المشتركة (تكلفة الإشراف) — صف واحد ثابت id = 1
async function fetchSupervisionCost() {
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("supervision_cost")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.supervision_cost) : 0;
}

async function updateSupervisionCostRow(value) {
  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .update({ supervision_cost: value, updated_at: new Date().toISOString() })
    .eq("id", 1);
  if (error) throw error;
}

/* ---------------------------------------------------------------
   مكوّن بطاقة إحصائية
---------------------------------------------------------------- */
function StatCard({ label, value, sub, tone = "default", icon: Icon }) {
  const toneMap = {
    default: "text-primary",
    good: "text-success",
    bad: "text-danger",
  };
  return (
    <div className="bg-white rounded-xl border border-line p-5 flex flex-col gap-2 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted tracking-wide">{label}</span>
        {Icon && <Icon size={18} className="text-accent" />}
      </div>
      <div className={`text-2xl font-bold ${toneMap[tone]}`} style={{ fontFamily: "Almarai, sans-serif" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

const SESSION_STORAGE_KEY = "almalaz:session:v1";

/* ---------------------------------------------------------------
   شاشة تسجيل الدخول
---------------------------------------------------------------- */
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError("أدخل اسم المستخدم وكلمة المرور.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const result = await loginAppUser(username.trim(), password);
      if (!result) {
        setError("اسم المستخدم أو كلمة المرور غير صحيحة.");
        return;
      }
      onLogin({
        username: username.trim(),
        displayName: result.display_name,
        partnerId: result.partner_id,
        isAdmin: !!result.is_admin,
      });
    } catch (e) {
      console.error(e);
      setError("تعذر الاتصال بقاعدة البيانات. تحقق من الاتصال وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div dir="rtl" className="min-h-screen bg-page flex items-center justify-center px-4" style={{ fontFamily: "Tajawal, sans-serif" }}>
      <style>{`
        .bg-primary { background-color: #211D18; }
        .bg-accent { background-color: #A9713D; }
        .bg-page { background-color: #F6F1E7; }
        .border-line { border-color: #E2D9C7; }
        .text-primary { color: #211D18; }
        .text-muted { color: #7A6F5F; }
        .text-danger { color: #9C4A30; }
        .bg-danger-soft { background-color: #F7E8E1; }
        .border-danger-soft { border-color: #E8CBBB; }
      `}</style>
      <form onSubmit={submit} className="bg-white border border-line rounded-xl shadow-sm p-8 w-full max-w-sm space-y-4">
        <div className="text-center mb-2">
          <h1 className="text-lg font-extrabold text-primary" style={{ fontFamily: "Almarai, sans-serif" }}>
            مشروع الوحدات العقارية — حي الملز
          </h1>
          <p className="text-xs text-muted mt-1">سجّل الدخول لمتابعة الإنفاق على المشروع</p>
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">اسم المستخدم</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full text-sm border border-line rounded-md px-3 py-2"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-muted block mb-1">كلمة المرور</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full text-sm border border-line rounded-md px-3 py-2"
          />
        </div>
        {error && (
          <div className="text-xs text-danger bg-danger-soft border border-danger-soft rounded-md px-3 py-2">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent text-white text-sm font-bold py-2.5 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {busy ? "جارٍ الدخول..." : "دخول"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filterPartner, setFilterPartner] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [supervisionCost, setSupervisionCost] = useState(DEFAULT_SUPERVISION_COST);
  const [supervisionInput, setSupervisionInput] = useState(String(DEFAULT_SUPERVISION_COST));
  const formSectionRef = useRef(null);
  const supervisionLoadedRef = useRef(false);
  const supervisionDebounceRef = useRef(null);

  // استرجاع جلسة الدخول المحفوظة محليًا (إن وُجدت) عند فتح الصفحة
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) setSession(JSON.parse(raw));
    } catch (e) {
      console.error("تعذر قراءة جلسة الدخول", e);
    } finally {
      setSessionChecked(true);
    }
  }, []);

  const handleLogin = (s) => {
    setSession(s);
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      console.error("تعذر حفظ جلسة الدخول", e);
    }
  };

  const handleLogout = () => {
    setSession(null);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.error("تعذر حذف جلسة الدخول", e);
    }
  };

  // -------------------- تغيير كلمة المرور الخاصة --------------------
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [pwOld, setPwOld] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwSuccess, setPwSuccess] = useState("");

  const submitPasswordChange = async () => {
    setPwError("");
    setPwSuccess("");
    if (!pwOld || !pwNew || !pwConfirm) {
      setPwError("عبّي كل الحقول.");
      return;
    }
    if (pwNew.length < 4) {
      setPwError("كلمة المرور الجديدة قصيرة جدًا (4 أحرف على الأقل).");
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError("كلمة المرور الجديدة والتأكيد غير متطابقين.");
      return;
    }
    setPwBusy(true);
    try {
      const ok = await changeOwnPassword(session.username, pwOld, pwNew);
      if (!ok) {
        setPwError("كلمة المرور الحالية غير صحيحة.");
      } else {
        setPwSuccess("تم تغيير كلمة المرور بنجاح.");
        setPwOld("");
        setPwNew("");
        setPwConfirm("");
      }
    } catch (e) {
      console.error(e);
      setPwError("تعذر الاتصال بقاعدة البيانات.");
    } finally {
      setPwBusy(false);
    }
  };

  // -------------------- لوحة الإدارة (إعادة تعيين كلمات مرور الآخرين) --------------------
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminOwnPassword, setAdminOwnPassword] = useState("");
  const [resetTarget, setResetTarget] = useState(null); // username الذي يُعاد تعيين كلمته
  const [resetNewPw, setResetNewPw] = useState("");
  const [resetConfirmPw, setResetConfirmPw] = useState("");
  const [resetError, setResetError] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSuccess, setResetSuccess] = useState("");

  const ADMIN_MANAGED_USERS = [
    { username: "saeed", name: "سعيد الغامدي" },
    { username: "ibrahim", name: "إبراهيم الخنيزان" },
    { username: "abdullah", name: "عبدالله الغامدي" },
  ];

  const submitAdminReset = async () => {
    setResetError("");
    setResetSuccess("");
    if (!adminOwnPassword || !resetNewPw || !resetConfirmPw) {
      setResetError("عبّي كل الحقول.");
      return;
    }
    if (resetNewPw.length < 4) {
      setResetError("كلمة المرور الجديدة قصيرة جدًا (4 أحرف على الأقل).");
      return;
    }
    if (resetNewPw !== resetConfirmPw) {
      setResetError("كلمة المرور الجديدة والتأكيد غير متطابقين.");
      return;
    }
    setResetBusy(true);
    try {
      const ok = await adminResetPassword(session.username, adminOwnPassword, resetTarget, resetNewPw);
      if (!ok) {
        setResetError("كلمة مرورك (كمسؤول) غير صحيحة.");
      } else {
        setResetSuccess(`تم تغيير كلمة مرور ${ADMIN_MANAGED_USERS.find((u) => u.username === resetTarget)?.name} بنجاح.`);
        setResetNewPw("");
        setResetConfirmPw("");
        setResetTarget(null);
      }
    } catch (e) {
      console.error(e);
      setResetError("تعذر الاتصال بقاعدة البيانات.");
    } finally {
      setResetBusy(false);
    }
  };

  // تحميل تكلفة الإشراف من Supabase عند فتح الصفحة
  useEffect(() => {
    (async () => {
      try {
        const val = await fetchSupervisionCost();
        setSupervisionCost(val);
        setSupervisionInput(String(val));
      } catch (e) {
        console.error("تعذر تحميل تكلفة الإشراف", e);
      } finally {
        supervisionLoadedRef.current = true;
      }
    })();
  }, []);

  // اشتراك تحديث لحظي لتكلفة الإشراف، حتى يرى الجميع نفس القيمة فور تعديلها من أي طرف
  useEffect(() => {
    const channel = supabase
      .channel("settings-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: SETTINGS_TABLE },
        (payload) => {
          const val = Number(payload.new?.supervision_cost ?? 0);
          setSupervisionCost(val);
          setSupervisionInput(String(val));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const updateSupervisionCost = (rawValue) => {
    let v = toWesternDigits(rawValue).replace(/[^0-9.]/g, "");
    const firstDot = v.indexOf(".");
    if (firstDot !== -1) {
      v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
    }
    setSupervisionInput(v);
    const num = parseFloat(v);
    const finalVal = !v || isNaN(num) || num < 0 ? 0 : num;
    setSupervisionCost(finalVal);

    // تأخير بسيط قبل الحفظ الفعلي في قاعدة البيانات حتى لا نرسل طلبًا مع كل حرف
    if (supervisionDebounceRef.current) clearTimeout(supervisionDebounceRef.current);
    supervisionDebounceRef.current = setTimeout(async () => {
      try {
        await updateSupervisionCostRow(finalVal);
      } catch (e) {
        console.error("تعذر حفظ تكلفة الإشراف", e);
        showToast("تعذر حفظ تكلفة الإشراف — تحقق من الاتصال");
      }
    }, 600);
  };

  // البنود والإجماليات المشتقة من تكلفة الإشراف الحالية (تتحدّث فورًا عند تعديلها)
  const CATEGORIES = useMemo(() => buildCategories(supervisionCost), [supervisionCost]);
  const ADDABLE_CATEGORIES = useMemo(() => CATEGORIES.filter((c) => c.id !== "land"), [CATEGORIES]);
  // إجمالي تكلفة البناء = تكلفة البناء + التجهيزات (مصاعد/مطابخ/تكييف) + الإشراف
  const CONSTRUCTION_TOTAL = CONSTRUCTION_COST + MEP_COST + supervisionCost;
  // الميزانية الأساسية = الأرض + تكلفة البناء الكاملة (تتغيّر مع تعديل الإشراف)
  const BASE_BUDGET = LAND_TOTAL + CONSTRUCTION_TOTAL;

  // الأنواع المسموحة حسب هوية المستخدم المسجّل دخوله فقط
  const isContractorUser = session?.partnerId === CONTRACTOR_ID;
  const allowedTypes = isContractorUser
    ? ["contractor_advance", "contractor_settlement"]
    : ["expense", "contribution"];

  const emptyForm = {
    type: allowedTypes[0],
    partner: session?.partnerId || "saeed",
    category: "construction",
    amount: "",
    date: todayStr(),
    reference: "",
    note: "",
    attachment: null, // { name, type, dataUrl }
  };

  const openAddForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
    setShowForm(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const openEditForm = (t) => {
    if (t.locked) return;
    if (t.partner !== session?.partnerId) return; // كل طرف يعدّل فقط ما يخصه
    setEditingId(t.id);
    setForm({
      type: t.type,
      partner: t.partner,
      category: t.category || "construction",
      amount: String(t.amount),
      date: t.date,
      reference: t.reference || "",
      note: t.note || "",
      attachment: t.attachment || null,
    });
    setFormError("");
    setShowForm(true);
    setTimeout(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setFormError("");
  };

  const [form, setForm] = useState(emptyForm);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  /* -------------------- تحميل البيانات من Supabase عند فتح الصفحة -------------------- */
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await seedIfEmpty();
        const list = await fetchTransactions();
        if (active) setTransactions(list);
      } catch (e) {
        console.error(e);
        showToast("تعذر الاتصال بقاعدة البيانات — تأكد من ضبط بيانات Supabase");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /* -------------------- اشتراك التحديث اللحظي: أي حركة يضيفها الطرف الآخر تظهر تلقائيًا -------------------- */
  useEffect(() => {
    const channel = supabase
      .channel("transactions-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TRANSACTIONS_TABLE },
        () => {
          fetchTransactions()
            .then(setTransactions)
            .catch((e) => console.error(e));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const saveTransaction = async () => {
    const cleanAmount = toWesternDigits(form.amount).trim();
    const amt = parseFloat(cleanAmount);
    if (!cleanAmount || isNaN(amt) || amt <= 0) {
      setFormError("أدخل مبلغًا صحيحًا أكبر من صفر (أرقام فقط).");
      return;
    }
    if (!allowedTypes.includes(form.type)) {
      setFormError("نوع الحركة غير مسموح به لحسابك.");
      return;
    }
    setFormError("");
    const now = new Date().toISOString();
    // الطرف يُفرض دائمًا من جلسة الدخول الحالية، وليس من اختيار حر في النموذج
    const resolvedPartner = session.partnerId;
    const resolvedCategory =
      form.type === "expense" || form.type === "contractor_advance" ? form.category : null;

    setSaving(true);
    try {
      if (editingId) {
        // تعديل حركة موجودة (غير مسموح للحركات الثابتة أو حركات طرف آخر)
        const existing = transactions.find((t) => t.id === editingId);
        if (existing && !existing.locked && existing.partner === session.partnerId) {
          const updated = {
            ...existing,
            type: form.type,
            partner: resolvedPartner,
            category: resolvedCategory,
            amount: amt,
            date: form.date,
            reference: form.reference.trim(),
            note: form.note.trim(),
            attachment: form.attachment,
            updatedAt: now,
          };
          setTransactions((prev) => prev.map((t) => (t.id === editingId ? updated : t)));
          await updateTransactionRow(updated);
        }
      } else {
        // إضافة حركة جديدة
        const t = {
          id: `t_${Date.now()}`,
          type: form.type,
          partner: resolvedPartner,
          category: resolvedCategory,
          amount: amt,
          date: form.date,
          reference: form.reference.trim(),
          note: form.note.trim(),
          attachment: form.attachment,
          locked: false,
          createdAt: now,
          updatedAt: now,
        };
        setTransactions((prev) => [t, ...prev]);
        await insertTransactionRow(t);
      }
      setForm(emptyForm);
      setEditingId(null);
      setShowForm(false);
    } catch (e) {
      console.error(e);
      setFormError("تعذر حفظ الحركة في قاعدة البيانات. تحقق من الاتصال وحاول مجددًا.");
    } finally {
      setSaving(false);
    }
  };

  const deleteTransaction = async (id) => {
    const target = transactions.find((t) => t.id === id);
    if (target?.locked) return; // الحركات الثابتة لا تُحذف
    if (target?.partner !== session?.partnerId) return; // كل طرف يحذف فقط ما يخصه
    const prevList = transactions;
    setTransactions((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTransactionRow(id);
    } catch (e) {
      console.error(e);
      setTransactions(prevList); // تراجع عن الحذف المحلي إذا فشل الحذف الفعلي
      showToast("تعذر حذف الحركة — حاول مجددًا");
    }
  };

  const handleAttachmentChange = (file) => {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setFormError("حجم الملف كبير جدًا — الحد الأقصى 2 ميجابايت.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setFormError("");
      setForm((f) => ({
        ...f,
        attachment: { name: file.name, type: file.type, dataUrl: e.target.result },
      }));
    };
    reader.readAsDataURL(file);
  };


  /* -------------------- حسابات مشتقة -------------------- */
  // تعديل الميزانية: دفعات المقاول العاجلة تزيد الميزانية المخططة، والتسويات (الاستلام من الشركاء) تنقصها
  const budgetAdjustment = useMemo(() => {
    const advances = transactions
      .filter((t) => t.type === "contractor_advance")
      .reduce((s, t) => s + t.amount, 0);
    const settlements = transactions
      .filter((t) => t.type === "contractor_settlement")
      .reduce((s, t) => s + t.amount, 0);
    return advances - settlements;
  }, [transactions]);

  // الميزانية الفعّالة = الرقم الثابت + أي تعديل ناتج عن دفعات/تسويات المقاول
  const effectiveBudget = BASE_BUDGET + budgetAdjustment;

  // المصروف الفعلي يمثل فقط ما صرفه الشركاء أنفسهم (بما فيها الأرض ودفعات الإشراف
  // المموَّلة من ميزانيتهم). دفعات المقاول العاجلة لا تُحتسب هنا؛ أثرها فقط على
  // الميزانية المخططة (budgetAdjustment أعلاه) وعلى بطاقة "حساب المقاول" كمستحق له
  // إلى أن تتم تسويتها
  const totalExpenses = useMemo(
    () => transactions.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
    [transactions]
  );
  // المتبقي من الميزانية المخططة = الميزانية الفعّالة - إجمالي المصروف الفعلي (الشركاء فقط)
  const remaining = effectiveBudget - totalExpenses;
  const spentPct = effectiveBudget > 0 ? Math.min(100, (totalExpenses / effectiveBudget) * 100) : 0;

  const partnerStats = useMemo(() => {
    return PARTNERS.map((p) => {
      const required = effectiveBudget * p.share;
      const paid = transactions
        .filter((t) => t.type === "contribution" && t.partner === p.id)
        .reduce((s, t) => s + t.amount, 0);
      // حصته من قيمة الأرض (دفعة ثابتة مسدّدة مسبقًا، منفصلة عن أي مصاريف جديدة)
      const landPaidBy = transactions
        .filter((t) => t.type === "expense" && t.partner === p.id && t.category === "land")
        .reduce((s, t) => s + t.amount, 0);
      // مصاريف بناء/تجهيزات/إشراف سدّدها الشريك مباشرة (دفعات المقاول وغيرها) — منفصلة عن الأرض
      const buildExpensesPaidBy = transactions
        .filter((t) => t.type === "expense" && t.partner === p.id && t.category !== "land")
        .reduce((s, t) => s + t.amount, 0);
      const totalContributed = paid + landPaidBy + buildExpensesPaidBy;
      return {
        ...p,
        required,
        paid,
        landPaidBy,
        buildExpensesPaidBy,
        totalContributed,
        balance: totalContributed - required,
      };
    });
  }, [transactions, effectiveBudget]);

  // حساب المقاول: صافي ما دفعه من جيبه عاجلًا مقابل ما استلمه كتسوية من الشركاء
  const contractorStats = useMemo(() => {
    const totalAdvances = transactions
      .filter((t) => t.type === "contractor_advance")
      .reduce((s, t) => s + t.amount, 0);
    const totalSettlements = transactions
      .filter((t) => t.type === "contractor_settlement")
      .reduce((s, t) => s + t.amount, 0);
    // موجب = المشروع لا يزال مدينًا للمقاول بهذا المبلغ | صفر/سالب = تمت التسوية بالكامل
    const netOwed = totalAdvances - totalSettlements;
    return { totalAdvances, totalSettlements, netOwed };
  }, [transactions]);

  const categoryChartData = useMemo(() => {
    return CATEGORIES.filter((c) => c.id !== "other" || totalByCategory(transactions, "other") > 0).map((c) => ({
      name: c.label.split(" (")[0],
      المخطط: c.planned,
      الفعلي: totalByCategory(transactions, c.id),
    }));
  }, [transactions]);

  function totalByCategory(list, catId) {
    return list
      .filter((t) => t.type === "expense" && t.category === catId)
      .reduce((s, t) => s + t.amount, 0);
  }

  const filteredTransactions = useMemo(() => {
    return transactions
      .filter((t) => (filterPartner === "all" ? true : t.partner === filterPartner))
      .filter((t) => (filterType === "all" ? true : t.type === filterType))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [transactions, filterPartner, filterType]);

  const partnerName = actorName;
  const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id;

  if (!sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page" dir="rtl">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page" dir="rtl">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-page text-ink" style={{ fontFamily: "Tajawal, sans-serif" }}>
      <style>{`
        .bg-primary { background-color: #211D18; }
        .bg-danger { background-color: #9C4A30; }
        .bg-accent { background-color: #A9713D; }
        .bg-line { background-color: #E2D9C7; }
        .bg-success-soft { background-color: #EAEDDF; }
        .bg-soft { background-color: #EFE7D8; }
        .bg-amber-soft { background-color: #F5E8D3; }
        .bg-page { background-color: #F6F1E7; }
        .bg-page-blur { background-color: rgba(246,241,231,0.95); }
        .bg-danger-soft { background-color: #F7E8E1; }

        .border-line { border-color: #E2D9C7; }
        .border-danger-soft { border-color: #E8CBBB; }
        .border-soft { border-color: #EFE7D8; }

        .text-primary { color: #211D18; }
        .text-ink { color: #241F19; }
        .text-success { color: #5C7048; }
        .text-muted { color: #7A6F5F; }
        .text-amber { color: #8A5A28; }
        .text-danger { color: #9C4A30; }
        .text-accent { color: #A9713D; }
        .text-teal-soft { color: #D8CDB8; }

        .text-10 { font-size: 10px; }
        .text-11 { font-size: 11px; }

        .btn-header:hover { background-color: #322C24; }
        .row-hover:hover { background-color: #F6F1E7; }

        /* نقش خطوط رأسية دقيقة مستوحى من ألواح الخشب البرونزية على واجهة المبنى */
        .header-slats {
          background-image: repeating-linear-gradient(
            90deg,
            rgba(169,113,61,0.16) 0px,
            rgba(169,113,61,0.16) 3px,
            transparent 3px,
            transparent 30px
          );
        }
      `}</style>

      {/* ------------------------------- الترويسة ------------------------------- */}
      <header
        className="relative text-white"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(33,29,24,0.55) 0%, rgba(33,29,24,0.88) 100%), url(${projectImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="header-slats absolute inset-0"></div>
        <div className="relative max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ fontFamily: "Almarai, sans-serif" }}>
              مشروع الوحدات العقارية — حي الملز
            </h1>
            <p className="text-xs text-teal-soft mt-1">
              المقاول المشرف المنفذ: {CONTRACTOR}
            </p>
          </div>
          <div className="flex gap-6 text-sm">
            {PARTNERS.map((p) => (
              <div key={p.id} className="text-left">
                <div className="text-teal-soft text-xs">{p.name}</div>
                <div className="font-bold text-accent">{Math.round(p.share * 100)}% شريك ممول</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="bg-success-soft border-b border-line text-success text-xs text-center py-2 px-4 leading-relaxed">
        هذا السجل مشترك ومتزامن تلقائيًا عبر الإنترنت: أي حركة يضيفها سعيد أو إبراهيم أو المقاول
        (أو تعديل تكلفة الإشراف) تظهر فورًا للطرفين الآخرين، بدون أي ملفات أو خطوات يدوية.
      </div>

      {/* شريط لاصق يبقى ظاهرًا أثناء التمرير لإضافة دفعة */}
      <div className="sticky top-0 z-40 bg-page-blur border-b border-line px-6 py-3" style={{ backdropFilter: "blur(6px)" }}>
        <div className="max-w-6xl mx-auto flex justify-between items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted flex-wrap">
            <span>مسجّل الدخول باسم <span className="font-bold text-primary">{session.displayName}</span></span>
            <button
              onClick={() => {
                setShowPasswordForm((s) => !s);
                setPwError("");
                setPwSuccess("");
              }}
              className="text-primary font-bold hover:opacity-70"
            >
              تغيير كلمة المرور
            </button>
            {session.isAdmin && (
              <button
                onClick={() => {
                  setShowAdminPanel((s) => !s);
                  setResetError("");
                  setResetSuccess("");
                }}
                className="text-accent font-bold hover:opacity-70"
              >
                لوحة الإدارة
              </button>
            )}
            <button onClick={handleLogout} className="text-danger font-bold hover:opacity-70">تسجيل الخروج</button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {toast && <span className="text-xs text-danger">{toast}</span>}
            <button
              onClick={openAddForm}
              className="flex items-center gap-2 bg-accent text-white text-sm font-bold px-4 py-2.5 rounded-lg shadow-sm hover:opacity-90 transition-opacity"
              style={{ fontFamily: "Almarai, sans-serif" }}
            >
              <Plus size={16} />
              إضافة دفعة / مصروف
            </button>
          </div>
        </div>

        {showPasswordForm && (
          <div className="max-w-6xl mx-auto mt-3 bg-white border border-line rounded-lg p-4 space-y-3">
            <h3 className="font-bold text-sm" style={{ fontFamily: "Almarai, sans-serif" }}>تغيير كلمة المرور</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-muted block mb-1">كلمة المرور الحالية</label>
                <input
                  type="password"
                  value={pwOld}
                  onChange={(e) => setPwOld(e.target.value)}
                  className="w-full text-sm border border-line rounded-md px-2 py-1.5"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">كلمة المرور الجديدة</label>
                <input
                  type="password"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  className="w-full text-sm border border-line rounded-md px-2 py-1.5"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">تأكيد كلمة المرور الجديدة</label>
                <input
                  type="password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className="w-full text-sm border border-line rounded-md px-2 py-1.5"
                />
              </div>
            </div>
            {pwError && <div className="text-xs text-danger bg-danger-soft border border-danger-soft rounded-md px-2 py-1.5">{pwError}</div>}
            {pwSuccess && <div className="text-xs text-success bg-success-soft border border-line rounded-md px-2 py-1.5">{pwSuccess}</div>}
            <button
              onClick={submitPasswordChange}
              disabled={pwBusy}
              className="bg-accent text-white text-sm font-bold px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
            >
              {pwBusy ? "جارٍ الحفظ..." : "حفظ كلمة المرور الجديدة"}
            </button>
          </div>
        )}

        {showAdminPanel && session.isAdmin && (
          <div className="max-w-6xl mx-auto mt-3 bg-white border border-line rounded-lg p-4 space-y-3">
            <h3 className="font-bold text-sm" style={{ fontFamily: "Almarai, sans-serif" }}>لوحة الإدارة — إعادة تعيين كلمات المرور</h3>
            <div>
              <label className="text-xs text-muted block mb-1">كلمة مرورك الحالية (للتحقق من صلاحيتك)</label>
              <input
                type="password"
                value={adminOwnPassword}
                onChange={(e) => setAdminOwnPassword(e.target.value)}
                className="w-full sm:w-64 text-sm border border-line rounded-md px-2 py-1.5"
                placeholder="كلمة مرورك"
              />
            </div>
            <div className="space-y-2">
              {ADMIN_MANAGED_USERS.map((u) => (
                <div key={u.username} className="border border-line rounded-lg p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-semibold">{u.name} <span className="text-11 text-muted">({u.username})</span></span>
                    <button
                      onClick={() => {
                        setResetTarget(resetTarget === u.username ? null : u.username);
                        setResetError("");
                        setResetSuccess("");
                        setResetNewPw("");
                        setResetConfirmPw("");
                      }}
                      className="text-xs font-bold text-primary hover:opacity-70"
                    >
                      {resetTarget === u.username ? "إلغاء" : "إعادة تعيين كلمة المرور"}
                    </button>
                  </div>
                  {resetTarget === u.username && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted block mb-1">كلمة المرور الجديدة لـ {u.name}</label>
                        <input
                          type="password"
                          value={resetNewPw}
                          onChange={(e) => setResetNewPw(e.target.value)}
                          className="w-full text-sm border border-line rounded-md px-2 py-1.5"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted block mb-1">تأكيد كلمة المرور الجديدة</label>
                        <input
                          type="password"
                          value={resetConfirmPw}
                          onChange={(e) => setResetConfirmPw(e.target.value)}
                          className="w-full text-sm border border-line rounded-md px-2 py-1.5"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <button
                          onClick={submitAdminReset}
                          disabled={resetBusy}
                          className="bg-accent text-white text-sm font-bold px-4 py-2 rounded-md hover:opacity-90 disabled:opacity-50"
                        >
                          {resetBusy ? "جارٍ الحفظ..." : `حفظ كلمة المرور الجديدة لـ ${u.name}`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {resetError && <div className="text-xs text-danger bg-danger-soft border border-danger-soft rounded-md px-2 py-1.5">{resetError}</div>}
            {resetSuccess && <div className="text-xs text-success bg-success-soft border border-line rounded-md px-2 py-1.5">{resetSuccess}</div>}
          </div>
        )}
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* --------------------------- بطاقات الملخص --------------------------- */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="إجمالي الميزانية الفعلية والمخططة"
            value={`${fmt(effectiveBudget)} ر.س`}
            sub={budgetAdjustment !== 0 ? `الأساس ${fmt(BASE_BUDGET)} ${budgetAdjustment > 0 ? "+" : "-"} ${fmt(Math.abs(budgetAdjustment))} (تعديل المقاول)` : undefined}
            icon={Wallet}
          />
          <StatCard label="إجمالي المصروف الفعلي" value={`${fmt(totalExpenses)} ر.س`} icon={TrendingDown} tone="bad" />
          <StatCard
            label="المتبقي من الميزانية المخططة"
            value={`${fmt(remaining)} ر.س`}
            icon={TrendingUp}
            tone={remaining >= 0 ? "good" : "bad"}
          />
        </section>

        {/* --------------------------- شريط التقدم --------------------------- */}
        <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-sm" style={{ fontFamily: "Almarai, sans-serif" }}>نسبة الإنفاق من الميزانية المخططة</h2>
            <span className="text-sm font-bold text-primary">{spentPct.toFixed(1)}%</span>
          </div>
          <div className="w-full h-6 bg-soft rounded-md overflow-hidden flex gap-0.5 p-0.5">
            {Array.from({ length: 20 }).map((_, i) => {
              const filled = i < Math.round((spentPct / 100) * 20);
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-sm ${filled ? (spentPct > 100 ? "bg-danger" : "bg-accent") : "bg-line"}`}
                />
              );
            })}
          </div>
          <p className="text-xs text-muted mt-2">
            كل خانة تمثل شريحة من ميزانية المشروع — أسلوب عرض مستوحى من الطوابق الإنشائية للمبنى.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
          {/* --------------------------- العمود الأيمن: الشركاء + التفاصيل --------------------------- */}
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <h2 className="font-bold text-sm mb-4" style={{ fontFamily: "Almarai, sans-serif" }}>حسابات الشركاء الممولين</h2>
              <div className="space-y-4">
                {partnerStats.map((p) => (
                  <div key={p.id} className="border border-line rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-sm">{p.name}</span>
                      <span className="text-xs bg-soft text-primary px-2 py-0.5 rounded-full">{Math.round(p.share * 100)}%</span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-1 text-xs text-muted">
                      <span>الحصة المطلوبة (50% من الميزانية)</span>
                      <span className="text-left font-semibold text-ink">{fmt(p.required)} ر.س</span>
                      <span>حصته من قيمة الأرض 🔒 (ثابتة)</span>
                      <span className="text-left font-semibold text-ink">{fmt(p.landPaidBy)} ر.س</span>
                      <span>مصاريف بناء/تجهيزات/إشراف سدّدها مباشرة</span>
                      <span className="text-left font-semibold text-ink">{fmt(p.buildExpensesPaidBy)} ر.س</span>
                      <span>دفعات تمويل مباشرة للمشروع</span>
                      <span className="text-left font-semibold text-ink">{fmt(p.paid)} ر.س</span>
                      <span className="font-semibold">إجمالي ما ساهم به فعليًا</span>
                      <span className="text-left font-bold text-success">{fmt(p.totalContributed)} ر.س</span>
                      <span className="pt-1 border-t border-line mt-1">الرصيد مقابل حصته</span>
                      <span className={`text-left font-bold pt-1 border-t border-line mt-1 ${p.balance >= 0 ? "text-success" : "text-danger"}`}>
                        {p.balance >= 0 ? "زيادة " : "متبقٍّ عليه "}{fmt(Math.abs(p.balance))} ر.س
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-sm" style={{ fontFamily: "Almarai, sans-serif" }}>حساب المقاول (دفعات عاجلة وتسويات)</h2>
                <span className="text-xs bg-soft text-primary px-2 py-0.5 rounded-full">{CONTRACTOR}</span>
              </div>
              <div className="grid grid-cols-2 gap-y-1 text-xs text-muted">
                <span>إجمالي الدفعات العاجلة التي دفعها من جيبه</span>
                <span className="text-left font-semibold text-ink">{fmt(contractorStats.totalAdvances)} ر.س</span>
                <span>إجمالي ما استلمه كتسوية من الشركاء</span>
                <span className="text-left font-semibold text-ink">{fmt(contractorStats.totalSettlements)} ر.س</span>
                <span className="pt-1 border-t border-line mt-1 font-semibold">صافي المستحق له من المشروع</span>
                <span className={`text-left font-bold pt-1 border-t border-line mt-1 ${contractorStats.netOwed > 0 ? "text-danger" : "text-success"}`}>
                  {contractorStats.netOwed > 0 ? `${fmt(contractorStats.netOwed)} ر.س` : contractorStats.totalAdvances > 0 ? "تمت التسوية بالكامل ✓" : "لا توجد دفعات بعد"}
                </span>
              </div>
              {contractorStats.netOwed > 0 && (
                <p className="text-11 text-danger bg-danger-soft border border-danger-soft rounded-md p-2 mt-3">
                  هذا المبلغ مُضاف حاليًا للميزانية المخططة كتعديل مؤقت. سجّل حركة "تسوية / استلام المقاول من الشركاء" عند تحويل المبلغ له لإنهاء التعديل.
                </p>
              )}
            </section>

            <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <h2 className="font-bold text-sm mb-2" style={{ fontFamily: "Almarai, sans-serif" }}>تفاصيل تكلفة الأرض</h2>
              <div className="text-xs space-y-1.5 text-muted">
                <div className="flex justify-between"><span>قيمة الأرض الأساسية</span><span className="font-semibold text-ink">{fmt(LAND_BASE)} ر.س</span></div>
                <div className="flex justify-between"><span>الضريبة (5%)</span><span className="font-semibold text-ink">{fmt(TAX_AMOUNT)} ر.س</span></div>
                <div className="flex justify-between"><span>السعي (2.5%)</span><span className="font-semibold text-ink">{fmt(COMMISSION_AMOUNT)} ر.س</span></div>
                <div className="flex justify-between pt-1.5 border-t border-line font-bold text-primary"><span>الإجمالي</span><span>{fmt(LAND_TOTAL)} ر.س</span></div>
              </div>
              <p className="text-11 text-muted mt-3 bg-page rounded-md p-2">
                تم سداد هذا المبلغ بالكامل، بواقع 50% من كل شريك (مسجّلة في سجل الحركات أدناه).
              </p>
            </section>

            <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <h2 className="font-bold text-sm mb-2" style={{ fontFamily: "Almarai, sans-serif" }}>تفاصيل تكلفة البناء والتجهيزات والإشراف</h2>
              <div className="text-xs space-y-1.5 text-muted">
                <div className="flex justify-between items-center"><span>تكلفة البناء</span><span className="font-semibold text-ink">{fmt(CONSTRUCTION_COST)} ر.س</span></div>
                <div className="flex justify-between items-center"><span>مصاعد ومطابخ وتكييف مع التركيب</span><span className="font-semibold text-ink">{fmt(MEP_COST)} ر.س</span></div>
                <div className="flex justify-between items-center gap-3">
                  <span className="shrink-0">الإشراف (لم يُتفق عليها بعد)</span>
                  <div className="flex items-center gap-1.5">
                    {isContractorUser ? (
                      <span className="font-semibold text-ink">{fmt(supervisionCost)} ر.س</span>
                    ) : (
                      <>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={supervisionInput}
                          onChange={(e) => updateSupervisionCost(e.target.value)}
                          className="w-28 text-left text-xs font-semibold text-ink border border-line rounded-md px-2 py-1 bg-page"
                          placeholder="0"
                        />
                        <span className="text-11">ر.س</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-line font-bold text-primary"><span>الإجمالي</span><span>{fmt(CONSTRUCTION_TOTAL)} ر.س</span></div>
              </div>
              <p className="text-11 text-muted mt-3 bg-page rounded-md p-2">
                {isContractorUser
                  ? "تكلفة الإشراف يحدّدها الشركاء ولم تُحسم بعد."
                  : "تكلفة الإشراف قابلة للتعديل لأن الشركاء لم يتفقوا عليها بعد — أي تغيير هنا ينعكس فورًا على إجمالي الميزانية وحصة كل شريك."}
              </p>
            </section>
          </div>

          {/* --------------------------- العمود الأيسر: الرسم + السجل --------------------------- */}
          <div className="lg:col-span-3 space-y-6">
            <section className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <h2 className="font-bold text-sm mb-4" style={{ fontFamily: "Almarai, sans-serif" }}>المخطط مقابل الفعلي حسب البند</h2>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={categoryChartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E4DFD4" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: "Tajawal" }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <Tooltip formatter={(v) => `${fmt(v)} ر.س`} contentStyle={{ fontFamily: "Tajawal", direction: "rtl" }} />
                  <Bar dataKey="المخطط" fill="#E4DFD4" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="الفعلي" radius={[4, 4, 0, 0]}>
                    {categoryChartData.map((entry, i) => (
                      <Cell key={i} fill={entry.الفعلي > entry.المخطط && entry.المخطط > 0 ? "#A63D33" : "#B8894A"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>

            <section ref={formSectionRef} className="bg-white rounded-xl border border-line p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h2 className="font-bold text-sm" style={{ fontFamily: "Almarai, sans-serif" }}>سجل الدفعات والمصاريف</h2>
                <button
                  onClick={() => (showForm ? cancelForm() : openAddForm())}
                  className="flex items-center gap-1.5 bg-primary text-white text-xs font-bold px-3 py-2 rounded-lg btn-header transition-colors"
                >
                  {showForm ? <X size={14} /> : <Plus size={14} />}
                  {showForm ? "إغلاق" : "إضافة دفعة أو مصروف"}
                </button>
              </div>

              {showForm && (
                <div className="mb-5 p-4 bg-page rounded-lg border border-line space-y-3">
                  {editingId && (
                    <div className="text-xs text-primary bg-soft border border-line rounded-md px-2 py-1.5">
                      تعديل حركة موجودة
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">نوع الحركة</label>
                      <select
                        value={form.type}
                        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                        className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                      >
                        {allowedTypes.map((tKey) => (
                          <option key={tKey} value={tKey}>{TYPE_LABELS[tKey]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">الطرف</label>
                      <div className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-soft text-primary font-semibold">
                        {session.displayName}
                      </div>
                    </div>
                  </div>

                  {form.type === "contractor_advance" && (
                    <div className="text-11 text-danger bg-danger-soft border border-danger-soft rounded-md px-2 py-1.5">
                      هذا المبلغ سيُضاف تلقائيًا إلى الميزانية المخططة، لأنه مصروف عاجل تم خارج التمويل المعتاد للشركاء.
                      {form.amount && !isNaN(parseFloat(toWesternDigits(form.amount))) && (
                        <div className="font-bold mt-1">
                          نصيب كل شريك من هذا المبلغ إذا لم تتم تسويته: {fmt(parseFloat(toWesternDigits(form.amount)) / 2)} ر.س
                        </div>
                      )}
                    </div>
                  )}
                  {form.type === "contractor_settlement" && (
                    <div className="text-11 text-success bg-success-soft border border-line rounded-md px-2 py-1.5">
                      هذا المبلغ سيُخصم تلقائيًا من الميزانية المخططة، كتسوية لدفعة عاجلة سابقة بعد استلام المقاول مبالغ من الشركاء.
                    </div>
                  )}

                  {(form.type === "expense" || form.type === "contractor_advance") && (
                    <div>
                      <label className="text-xs text-muted block mb-1">البند</label>
                      <select
                        value={form.category}
                        onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                        className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                      >
                        {ADDABLE_CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted block mb-1">المبلغ (ر.س)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={form.amount}
                        onChange={(e) => {
                          let v = toWesternDigits(e.target.value);
                          v = v.replace(/[^0-9.]/g, "");
                          const firstDot = v.indexOf(".");
                          if (firstDot !== -1) {
                            v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, "");
                          }
                          setFormError("");
                          setForm((f) => ({ ...f, amount: v }));
                        }}
                        className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                        placeholder="0"
                      />
                      {form.amount && !isNaN(parseFloat(form.amount)) && (
                        <p className="text-11 text-muted mt-1">{fmt(parseFloat(form.amount))} ر.س</p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs text-muted block mb-1">التاريخ</label>
                      <input
                        type="date"
                        value={form.date}
                        onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                        className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-muted block mb-1">مرجع الدفعة (رقم الحوالة / الإيصال)</label>
                    <input
                      type="text"
                      value={form.reference}
                      onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                      className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                      placeholder="مثال: حوالة بنكية رقم 128734"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-muted block mb-1">ملاحظة (اختياري)</label>
                    <input
                      type="text"
                      value={form.note}
                      onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                      className="w-full text-sm border border-line rounded-md px-2 py-1.5 bg-white"
                      placeholder="مثال: دفعة أولى للمقاول"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-muted block mb-1">إرفاق مستند (اختياري — صورة أو PDF، حتى 2 ميجابايت)</label>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => handleAttachmentChange(e.target.files?.[0])}
                      className="w-full text-xs border border-line rounded-md px-2 py-1.5 bg-white"
                    />
                    {form.attachment && (
                      <div className="flex items-center justify-between mt-1.5 bg-success-soft border border-line rounded-md px-2 py-1.5">
                        <span className="text-11 text-success truncate">{form.attachment.name}</span>
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, attachment: null }))}
                          className="text-danger text-11 font-bold shrink-0"
                        >
                          إزالة
                        </button>
                      </div>
                    )}
                  </div>

                  {formError && (
                    <div className="text-xs text-danger bg-danger-soft border border-danger-soft rounded-md px-2 py-1.5">
                      {formError}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={saveTransaction}
                      disabled={saving}
                      className="flex-1 bg-accent text-white text-sm font-bold py-2 rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {saving ? "جارٍ الحفظ..." : editingId ? "حفظ التعديل" : "حفظ الحركة"}
                    </button>
                    {editingId && (
                      <button
                        onClick={cancelForm}
                        className="px-4 bg-white border border-line text-primary text-sm font-bold py-2 rounded-md hover:opacity-80 transition-opacity"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2 mb-3 flex-wrap">
                <select
                  value={filterPartner}
                  onChange={(e) => setFilterPartner(e.target.value)}
                  className="text-xs border border-line rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">كل الأطراف</option>
                  {PARTNERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value={CONTRACTOR_ID}>{CONTRACTOR} (المقاول)</option>
                </select>
                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="text-xs border border-line rounded-md px-2 py-1.5 bg-white"
                >
                  <option value="all">كل الأنواع</option>
                  <option value="expense">{TYPE_LABELS.expense}</option>
                  <option value="contribution">{TYPE_LABELS.contribution}</option>
                  <option value="contractor_advance">{TYPE_LABELS.contractor_advance}</option>
                  <option value="contractor_settlement">{TYPE_LABELS.contractor_settlement}</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted border-b border-line">
                      <th className="text-right py-2 font-semibold">التاريخ</th>
                      <th className="text-right py-2 font-semibold">النوع</th>
                      <th className="text-right py-2 font-semibold">الشريك</th>
                      <th className="text-right py-2 font-semibold">البند</th>
                      <th className="text-right py-2 font-semibold">المرجع</th>
                      <th className="text-right py-2 font-semibold">ملاحظة</th>
                      <th className="text-right py-2 font-semibold">مرفق</th>
                      <th className="text-right py-2 font-semibold">آخر تحديث</th>
                      <th className="text-left py-2 font-semibold">المبلغ</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTransactions.length === 0 && (
                      <tr>
                        <td colSpan={10} className="text-center py-8 text-muted">
                          لا توجد حركات مسجّلة بعد — أضف أول دفعة أو مصروف.
                        </td>
                      </tr>
                    )}
                    {filteredTransactions.map((t) => (
                      <tr key={t.id} className="border-b border-soft row-hover">
                        <td className="py-2">{t.date}</td>
                        <td className="py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-10 font-bold ${
                              t.category === "land"
                                ? "bg-soft text-primary"
                                : t.type === "contractor_advance"
                                ? "bg-danger-soft text-danger"
                                : t.type === "contractor_settlement"
                                ? "bg-success-soft text-success"
                                : t.type === "contribution"
                                ? "bg-success-soft text-success"
                                : "bg-amber-soft text-amber"
                            }`}
                          >
                            {transactionTypeLabel(t)}
                          </span>
                          {t.locked && (
                            <span className="mr-1 text-10 text-muted">🔒 ثابتة</span>
                          )}
                        </td>
                        <td className="py-2">{partnerName(t.partner)}</td>
                        <td className="py-2 text-muted">{t.category ? categoryLabel(t.category).split(" (")[0] : "—"}</td>
                        <td className="py-2 text-muted font-mono text-11">{t.reference || "—"}</td>
                        <td className="py-2 text-muted">{t.note || "—"}</td>
                        <td className="py-2 text-muted">
                          {t.attachment ? (
                            <a
                              href={t.attachment.dataUrl}
                              download={t.attachment.name}
                              className="text-primary underline text-11"
                              title={t.attachment.name}
                            >
                              📎 عرض
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="py-2 text-muted text-11">
                          {t.updatedAt ? new Date(t.updatedAt).toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                        </td>
                        <td className="py-2 text-left font-semibold">{fmt(t.amount)} ر.س</td>
                        <td className="py-2 text-left">
                          {t.locked ? (
                            <span className="text-muted text-11" title="دفعة الأرض ثابتة ولا يمكن تعديلها">🔒</span>
                          ) : t.partner === session.partnerId ? (
                            <div className="flex items-center gap-2">
                              <button onClick={() => openEditForm(t)} className="text-primary hover:opacity-70" title="تعديل">
                                <Pencil size={14} />
                              </button>
                              <button onClick={() => deleteTransaction(t.id)} className="text-danger hover:opacity-70" title="حذف">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-muted text-11" title="لا تملك صلاحية تعديل حركات الأطراف الأخرى">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-muted py-6">
        داش بورد متابعة الإنفاق — مشروع الملز · تُحفظ البيانات محليًا في هذا المتصفح
      </footer>
    </div>
  );
}
