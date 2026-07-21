import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "tinyfeed";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// อ้างอิงโมดูล core ของ SillyTavern แบบ lazy (โหลดใน init) เพื่อดึง user_avatar ที่ context ไม่ได้ export
// ใช้ dynamic import + try/catch จะได้ไม่พังทั้งไฟล์ถ้าเวอร์ชันไหน export ไม่ตรง
let stScriptModule = null;

const defaultSettings = {
    enabled: true,
    theme: "dark",
    // Stage 5: override รูปโปรไฟล์ด้วยลิงก์ภายนอก
    wallpaperUrl: "",           // ลิงก์วอลเปเปอร์หน้าโฮม
    userAvatarUrl: "",          // รูปผู้ใช้ (global)
    charAvatarUrls: {},         // { "<ไฟล์ avatar การ์ด>": "url" } override รายตัวละคร
    // Stage 6: ช่วงยอดไลค์เริ่มต้นแบบสุ่มของโพสต์ AI
    likesMin: 0,
    likesMax: 48,
    // Stage 6.6: จำนวนโพสต์ล่าสุดที่แนบเป็น context ให้ AI (0 = ไม่แนบ)
    historyCount: 5,
    // ตั้งค่าล่วงหน้าสำหรับฟีเจอร์อนาคต (ยังไม่ทำงานจนกว่าจะถึง stage นั้น)
    autoGenerate: false,        // Stage 7
    autoGenerateMode: "interval", // "interval" | "ai"
    autoGenerateInterval: 10,
    commentReplyMode: "instant", // "instant" | "manual"
    // Stage 8: คอมเมนต์ NPC ที่ติดมากับโพสต์ AI ใหม่
    initialCommentMode: "none",  // "none" | "ai" (AI เลือกจำนวน) | "fixed" (กำหนดจำนวน)
    initialCommentCount: 2,
    // Stage 9: ข่าวสาร
    newsAutoGenerate: false,
    newsAutoMode: "interval",    // "interval" | "ai"
    newsAutoInterval: 20,
    newsHistoryCount: 5,
    // Stage 10: การแจ้งเตือน
    notificationsEnabled: true,
    // TinyConnect
    connectTokens: 200,
    connectExtraPrompt: "",
    // ตัวละครทักมาเองในแชต เมื่อคุยในแชทหลักครบ N ข้อความ
    connectAutoMessage: false,
    connectAutoInterval: 8,
    // TinyStream
    streamStreamer: "char",       // "char" | "user"
    streamCommentMode: "manual",  // "manual" | "auto" | "onupdate"
    streamAutoInterval: 12,        // วินาที (โหมด auto)
    streamTokens: 300,
    streamExtraPrompt: "",
    // Phase 2: โมเดล/API แยกสำหรับ TinyFeed ("" = ใช้ API หลัก, หรือ id ของ connection profile)
    apiProfile: "",
    apiContextMessages: 10,   // จำนวนข้อความล่าสุดที่แนบเป็น context เมื่อใช้ profile แยก
    worldInfoLimit: 0,        // จำกัดความยาว World Info ที่แนบ (ตัวอักษร, 0 = ไม่จำกัด)
    // System prompt / jailbreak แนบให้ทุกการสร้างของ TinyFeed (ทั้ง API หลักและโมเดลแยก)
    jailbreakPrompt: "",
    // Phase 2: จำนวน token ตอบกลับ (กันข้อความขาด)
    postTokens: 400,
    newsTokens: 500,
    // Phase 2: คำสั่งเสริมที่ผู้ใช้ใส่เอง (ต่อท้าย prompt โดยไม่แตะโครงสร้าง)
    postExtraPrompt: "",
    newsExtraPrompt: "",
    // Phase 2: แทรกฟีดเข้าประวัติแชทหลัก ("off" | "posts" | "both")
    injectMode: "off",
    injectDepth: 4,
    injectCount: 5,
    injectConnect: false,   // แทรกแชต TinyConnect เข้า RP
    injectStream: false,    // แทรกไลฟ์ TinyStream เข้า RP
    // เชื่อมเนื้อหาข้ามแอป (ตอน generate แต่ละแอปจะเห็นเนื้อหาแอปอื่น)
    crossAppEnabled: false,
    crossAppCount: 3,
};

// อ่านค่า setting (fallback เป็นค่า default ถ้ายังไม่มี key นั้น — เผื่อผู้ใช้เก่าที่ settings ถูกสร้างก่อน key ใหม่)
function getSetting(key) {
    const s = extension_settings[extensionName] || {};
    return s[key] !== undefined ? s[key] : defaultSettings[key];
}

// บันทึกค่า setting
function setSetting(key, value) {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    extension_settings[extensionName][key] = value;
    saveSettingsDebounced();
}

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    const enabled = extension_settings[extensionName].enabled;
    $("#tinyfeed-enabled").prop("checked", enabled);
    applyMenuVisibility(enabled);
    applyTheme(extension_settings[extensionName].theme || "dark");
    applyWallpaper();
}

// ใส่วอลเปเปอร์หน้าโฮม (ลิงก์ภายนอก)
function applyWallpaper() {
    const url = String(getSetting("wallpaperUrl") || "").trim();
    const home = $("#tinyfeed-home");
    if (url) {
        home.css("background-image", `url("${url.replace(/["\\]/g, "")}")`)
            .addClass("tinyfeed-has-wallpaper");
    } else {
        home.css("background-image", "").removeClass("tinyfeed-has-wallpaper");
    }
}

// ซ่อน/แสดงปุ่มในเมนูตาม setting
function applyMenuVisibility(enabled) {
    $("#tinyfeed-menu-button").toggle(Boolean(enabled));
}

function onEnabledChange(event) {
    const value = Boolean($(event.target).prop("checked"));
    extension_settings[extensionName].enabled = value;
    saveSettingsDebounced();
    applyMenuVisibility(value);
    console.log(`[${extensionName}] enabled:`, value);
}

// เปิด/ปิด panel โทรศัพท์
function openPhone() {
    $("#tinyfeed-overlay").addClass("tinyfeed-visible");
    clearUnread();   // เปิดดูแล้ว เคลียร์จุดแดง
    goHome();        // เปิดเครื่องมาที่หน้าโฮมเสมอ
    console.log(`[${extensionName}] Phone opened`);
}

// ===== App Shell: หน้าโฮม + สลับแอป =====
let currentApp = "home";

function goHome() {
    currentApp = "home";
    clearStreamTimer();
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyPhone");
    $("#tinyfeed-home-btn, #tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-btn").removeClass("tinyfeed-hidden");   // เฟืองเข้าถึงได้จากโฮม
    try { $("#tinyfeed-home .tinyfeed-home-hello").text(`สวัสดี, ${getUserName()}`); } catch (e) { /* ข้าม */ }
}

function openApp(app) {
    if (app !== "feed" && app !== "connect" && app !== "stream") {
        toastr.info("แอปนี้กำลังจะมา เร็วๆ นี้! 📱", "TinyPhone");
        return;
    }
    clearStreamTimer();   // ออกจากแอปอื่น = หยุด timer stream
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");

    if (app === "feed") {
        currentApp = "feed";
        $("#tinyfeed-app-feed").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyFeed");
        $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
        switchTab(activeTab);
    } else if (app === "connect") {
        currentApp = "connect";
        $("#tinyfeed-app-connect").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyConnect");
        openConnectList();
    } else {
        currentApp = "stream";
        $("#tinyfeed-app-stream").removeClass("tinyfeed-hidden");
        $(".tinyfeed-title").text("TinyStream");
        renderStream();
        maybeStartStreamTimer();
    }
}

// ===== TinyStream: ไลฟ์สตรีม + คอมเมนต์สด =====
let isGeneratingStream = false;
let streamTimer = null;

function getStreamData() {
    const data = getFeedData();
    if (!data.stream || typeof data.stream !== "object") {
        data.stream = { live: false, title: "", viewers: 0, comments: [] };
    }
    if (!Array.isArray(data.stream.comments)) data.stream.comments = [];
    return data.stream;
}

// สตรีมเมอร์ปัจจุบัน { name, avatarItem }
function getStreamer() {
    if (getSetting("streamStreamer") === "user") {
        return { name: getUserName(), avatarItem: { isUser: true, author: getUserName() } };
    }
    const char = getCurrentCharacter();
    const name = (char && char.name) || "ตัวละคร";
    return { name, avatarItem: { isMain: true, author: name } };
}

function clearStreamTimer() {
    if (streamTimer) { clearInterval(streamTimer); streamTimer = null; }
}

function maybeStartStreamTimer() {
    clearStreamTimer();
    if (currentApp === "stream" && getStreamData().live && getSetting("streamCommentMode") === "auto") {
        const sec = Math.max(4, parseInt(getSetting("streamAutoInterval"), 10) || 12);
        streamTimer = setInterval(() => {
            if (!isGeneratingStream) loadLiveComments({ silent: true });
        }, sec * 1000);
    }
}

function renderStream() {
    const s = getStreamData();
    const streamer = getStreamer();
    $("#tinyfeed-app-stream .tinyfeed-stream-avatar").html(makeAvatar(streamer.avatarItem));
    $("#tinyfeed-app-stream .tinyfeed-stream-title").text(s.live ? (s.title || "กำลังไลฟ์สด") : "ยังไม่ได้เริ่มไลฟ์");
    $("#tinyfeed-app-stream .tinyfeed-stream-streamer").text(s.live ? `โดย ${streamer.name}` : "");
    $("#tinyfeed-stream-toggle").text(s.live ? "จบไลฟ์" : "เริ่มไลฟ์");
    $(".tinyfeed-stream-live").toggleClass("tinyfeed-hidden", !s.live);
    $(".tinyfeed-stream-viewers").toggleClass("tinyfeed-hidden", !s.live).text(`👁 ${formatCount(s.viewers)}`);
    $(".tinyfeed-stream-compose").toggleClass("tinyfeed-hidden", !s.live);
    // ปุ่มโหลดคอมเมนต์โชว์เฉพาะโหมด manual + กำลังไลฟ์
    $("#tinyfeed-stream-loadcomments").toggleClass("tinyfeed-hidden",
        !(s.live && getSetting("streamCommentMode") === "manual"));

    const rows = s.comments.map((c) => {
        if (c.isSystem) {
            return `<div class="tinyfeed-stream-divider"><span>${c.text}</span></div>`;
        }
        return `
        <div class="tinyfeed-stream-comment${c.isStreamer ? " tinyfeed-stream-comment-streamer" : ""}">
            ${makeAvatar(c.isUser ? { isUser: true, author: c.author } : { author: c.author, avatar: c.avatar || "" })}
            <div class="tinyfeed-stream-comment-body">
                <span class="tinyfeed-stream-comment-author">${escapeText(c.author)}</span>
                <span class="tinyfeed-stream-comment-text">${renderRich(c.text)}</span>
            </div>
        </div>`;
    }).join("");
    const box = $("#tinyfeed-stream-comments");
    box.html(rows);
    if (box[0]) box.scrollTop(box[0].scrollHeight);
    updateChatInjection();
}

async function toggleStream() {
    const s = getStreamData();
    if (s.live) {
        s.live = false;
        s.comments.push({ isSystem: true, text: "⏹ จบไลฟ์แล้ว", ts: Date.now() });
        clearStreamTimer();
        saveFeedData();
        renderStream();
        return;
    }
    // เริ่มไลฟ์: ให้ AI ตั้งหัวข้อจากเนื้อเรื่อง
    if (isGeneratingStream) return;
    isGeneratingStream = true;
    const btn = $("#tinyfeed-stream-toggle");
    btn.prop("disabled", true).text("กำลังเริ่ม...");
    try {
        const streamer = getStreamer();
        const q = `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ${streamer.name} กำลังจะไลฟ์สดในแอปสตรีมมิ่ง ` +
            `ตั้งหัวข้อไลฟ์สั้นๆ 1 บรรทัดให้เข้ากับสถานการณ์ในเนื้อเรื่องตอนนี้ ใช้ภาษาเดียวกับเนื้อเรื่อง ตอบเฉพาะหัวข้อ ไม่ต้องมีอย่างอื่น`;
        const raw = await tinyGenerate(q, 60);
        const title = stripReasoning(raw).split("\n")[0].replace(/^["'“”]+|["'“”]+$/g, "").trim();
        s.title = title || "ไลฟ์สด";
        s.live = true;
        s.viewers = 20 + Math.floor(Math.random() * 4800);
        s.comments.push({ isSystem: true, text: escapeText(`🔴 เริ่มไลฟ์ — ${s.title}`), ts: Date.now() });
        saveFeedData();
        renderStream();
        maybeStartStreamTimer();
        loadLiveComments({ silent: true });   // เปิดมามีคอมเมนต์ทักทายเลย
    } catch (e) {
        console.error(`[${extensionName}] start stream failed:`, e);
        toastr.error("เริ่มไลฟ์ไม่สำเร็จ ลองใหม่นะ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.prop("disabled", false);
        renderStream();
    }
}

async function loadLiveComments(opts) {
    opts = opts || {};
    const s = getStreamData();
    if (!s.live || isGeneratingStream) return;
    isGeneratingStream = true;
    const btn = $("#tinyfeed-stream-loadcomments");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    try {
        const streamer = getStreamer();
        const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
        const recent = s.comments.slice(-6).map((c) => `${c.author}: ${htmlToPlain(c.text)}`).join("\n");
        const q = `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือไลฟ์สดของ ${streamer.name} หัวข้อ "${s.title}". ` +
            `เขียนคอมเมนต์สดจากผู้ชม 3-5 คน (ชื่อผู้ชมสุ่มหลากหลาย${npcNames.length ? " หรือใช้ NPC เหล่านี้บ้าง: " + npcNames.join(", ") : ""}) ` +
            `รีแอคกับไลฟ์แบบสมจริง สั้นๆ เหมือนแชตสด ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้.` +
            (String(getSetting("streamExtraPrompt") || "").trim() ? ` คำสั่งเพิ่มเติม: ${String(getSetting("streamExtraPrompt")).trim()}.` : "") +
            crossAppContext("stream") +
            (recent ? `\nคอมเมนต์ล่าสุด (อย่าซ้ำ):\n${recent}\n` : "") +
            `\nตอบแต่ละคอมเมนต์บรรทัดละอันในรูปแบบ:\nCOMMENT: <ชื่อผู้ชม> | <ข้อความ>`;
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("streamTokens"), 10) || 300));
        const list = parseCommentLines(raw, streamer.name)
            .map((c) => ({ author: c.author, avatar: getNpcAvatar(c.author), text: c.text, ts: Date.now() }));
        if (list.length) {
            s.comments.push(...list);
            saveFeedData();
            renderStream();
        }
    } catch (e) {
        console.error(`[${extensionName}] live comments failed:`, e);
        if (!opts.silent) toastr.error("โหลดคอมเมนต์ไม่สำเร็จ", "TinyStream");
    } finally {
        isGeneratingStream = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
    }
}

async function sendStreamComment(text) {
    const clean = String(text || "").trim();
    const s = getStreamData();
    if (!clean || !s.live) return;
    s.comments.push({ author: getUserName(), isUser: true, text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-stream-input").val("");
    renderStream();
    // โหมด onupdate: คอมเมนต์เราทำให้ผู้ชมรีแอคต่อ
    if (getSetting("streamCommentMode") === "onupdate") {
        await loadLiveComments({ silent: true });
    }
}

// ===== TinyConnect: แชตสไตล์ไลน์ =====
let activeThread = null;
let activeThreadName = "";
let isConnectReplying = false;

function getConnectData() {
    const data = getFeedData();
    if (!data.connect || typeof data.connect !== "object") data.connect = { threads: {} };
    if (!data.connect.threads) data.connect.threads = {};
    return data.connect;
}

function getThread(key) {
    const c = getConnectData();
    if (!Array.isArray(c.threads[key])) c.threads[key] = [];
    return c.threads[key];
}

// แชตกลุ่ม: [{ id, name, members:[ชื่อ] }]
function getConnectGroups() {
    const c = getConnectData();
    if (!Array.isArray(c.groups)) c.groups = [];
    return c.groups;
}

function findGroup(key) {
    return getConnectGroups().find((g) => "group:" + g.id === key) || null;
}

// เปิด/ปิดฟอร์มสร้างกลุ่ม
function toggleGroupForm(show) {
    const form = $("#tinyfeed-connect-groupform");
    if (!show) { form.addClass("tinyfeed-hidden"); return; }
    const rows = getConnectContacts().map((c) => `
        <label class="tinyfeed-group-member">
            <input type="checkbox" class="tinyfeed-group-check" value="${escapeAttr(c.name)}" />
            <span>${escapeText(c.name)}</span>
        </label>`).join("");
    $("#tinyfeed-group-members").html(rows || `<span class="tinyfeed-field-hint">ยังไม่มีคนให้เลือก</span>`);
    $("#tinyfeed-group-name").val("");
    form.removeClass("tinyfeed-hidden");
}

function createGroup() {
    const name = String($("#tinyfeed-group-name").val() || "").trim();
    const members = $(".tinyfeed-group-check:checked").map(function () { return $(this).val(); }).get();
    if (!name) { toastr.info("ตั้งชื่อกลุ่มก่อนนะ", "TinyConnect"); return; }
    if (members.length < 2) { toastr.info("เลือกสมาชิกอย่างน้อย 2 คน", "TinyConnect"); return; }
    getConnectGroups().push({ id: "g" + Date.now(), name, members });
    saveFeedData();
    toggleGroupForm(false);
    renderConnectList();
}

function deleteGroup(key) {
    const g = findGroup(key);
    if (!g) return;
    if (!confirm(`ลบกลุ่ม "${g.name}" ใช่ไหม?`)) return;
    const c = getConnectData();
    c.groups = getConnectGroups().filter((x) => x.id !== g.id);
    delete c.threads[key];
    saveFeedData();
    renderConnectList();
}

// รายชื่อ contact = ตัวละครหลัก + NPC ประจำ
function getConnectContacts() {
    const contacts = [];
    const char = getCurrentCharacter();
    if (char) contacts.push({ key: "main", name: char.name, isMain: true, avatar: "" });
    for (const npc of getNpcs()) {
        const name = String(npc.name || "").trim();
        if (name) contacts.push({ key: "npc:" + name, name, isMain: false, avatar: npc.avatar || "" });
    }
    return contacts;
}

function contactAvatarItem(c) {
    return c.isMain ? { isMain: true, author: c.name } : { author: c.name, avatar: c.avatar || "" };
}

function isConnectThreadOpen() {
    return !$("#tinyfeed-connect-thread").hasClass("tinyfeed-hidden");
}

function openConnectList() {
    activeThread = null;
    toggleGroupForm(false);
    $("#tinyfeed-connect-tools").removeClass("tinyfeed-hidden");
    $("#tinyfeed-connect-thread").addClass("tinyfeed-hidden");
    $("#tinyfeed-connect-list").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("TinyConnect");
    renderConnectList();
}

function renderConnectList() {
    const contacts = getConnectContacts();
    const groups = getConnectGroups();
    if (!contacts.length && !groups.length) {
        $("#tinyfeed-connect-list").html(emptyStateHtml("fa-comment-dots", "ยังไม่มีคนให้คุย", "เปิดแชทที่มีตัวละคร หรือเพิ่ม NPC ประจำในแอป TinyFeed"));
        return;
    }
    const threads = getConnectData().threads;
    const lastOf = (key, fallback) => {
        const t = threads[key] || [];
        if (!t.length) return fallback;
        const m = t[t.length - 1];
        const who = m.from === "user" ? getUserName() : (m.author || "");
        return `${who ? who + ": " : ""}${htmlToPlain(m.text)}`.slice(0, 42);
    };

    const contactRows = contacts.map((c) => `
        <div class="tinyfeed-connect-contact" data-key="${escapeAttr(c.key)}" data-name="${escapeAttr(c.name)}">
            ${makeAvatar(contactAvatarItem(c))}
            <div class="tinyfeed-connect-contact-body">
                <div class="tinyfeed-connect-contact-name">${escapeText(c.name)}</div>
                <div class="tinyfeed-connect-contact-last">${escapeText(lastOf(c.key, "แตะเพื่อเริ่มแชต"))}</div>
            </div>
        </div>`).join("");

    const groupRows = groups.map((g) => {
        const key = "group:" + g.id;
        return `<div class="tinyfeed-connect-contact tinyfeed-connect-group" data-key="${escapeAttr(key)}" data-name="${escapeAttr(g.name)}" data-group="1">
            ${makeAnonAvatar(g.name)}
            <div class="tinyfeed-connect-contact-body">
                <div class="tinyfeed-connect-contact-name">${escapeText(g.name)} <span class="tinyfeed-group-count">(${g.members.length})</span></div>
                <div class="tinyfeed-connect-contact-last">${escapeText(lastOf(key, g.members.join(", ")))}</div>
            </div>
            <span class="tinyfeed-group-del" data-key="${escapeAttr(key)}" title="ลบกลุ่ม"><i class="fa-solid fa-trash"></i></span>
        </div>`;
    }).join("");

    $("#tinyfeed-connect-list").html(contactRows + groupRows);
}

function openThread(key, name) {
    activeThread = key;
    activeThreadName = name;
    $("#tinyfeed-connect-list, #tinyfeed-connect-tools").addClass("tinyfeed-hidden");
    toggleGroupForm(false);
    $("#tinyfeed-connect-thread").removeClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text(name);
    renderThread();
    $("#tinyfeed-connect-input").trigger("focus");
}

function renderThread() {
    if (!activeThread) return;
    const msgs = getThread(activeThread);
    const contact = getConnectContacts().find((c) => c.key === activeThread)
        || { name: activeThreadName, isMain: false, avatar: "" };
    const group = findGroup(activeThread);
    const rows = msgs.map((m) => {
        if (m.from === "user") {
            return `<div class="tinyfeed-msg tinyfeed-msg-user"><div class="tinyfeed-msg-bubble">${renderRich(m.text)}</div></div>`;
        }
        // แชตกลุ่ม: ใช้ avatar/ชื่อของสมาชิกที่พูด
        const who = group ? (m.author || group.name) : contact.name;
        const avaItem = group
            ? { author: who, avatar: getNpcAvatar(who), isMain: who === ((getCurrentCharacter() || {}).name || "") }
            : contactAvatarItem(contact);
        return `<div class="tinyfeed-msg tinyfeed-msg-contact">
            ${makeAvatar(avaItem)}
            <div class="tinyfeed-msg-col">
                ${group ? `<span class="tinyfeed-msg-author">${escapeText(who)}</span>` : ""}
                <div class="tinyfeed-msg-bubble">${renderRich(m.text)}</div>
            </div>
        </div>`;
    }).join("");
    const typing = isConnectReplying
        ? `<div class="tinyfeed-msg tinyfeed-msg-contact">
               ${makeAvatar(contactAvatarItem(contact))}
               <div class="tinyfeed-msg-bubble tinyfeed-msg-typing">กำลังพิมพ์…</div>
           </div>`
        : "";
    const box = $("#tinyfeed-connect-messages");
    box.html(rows + typing);
    if (box[0]) box.scrollTop(box[0].scrollHeight);   // เลื่อนลงล่างสุด
    updateChatInjection();
}

async function sendConnectMessage(text) {
    const clean = String(text || "").trim();
    if (!clean || !activeThread) return;
    getThread(activeThread).push({ from: "user", text: escapeHtml(clean), ts: Date.now() });
    saveFeedData();
    $("#tinyfeed-connect-input").val("");
    renderThread();
    await generateConnectReply();
}

async function generateConnectReply() {
    if (isConnectReplying || !activeThread) return;
    const name = activeThreadName;
    const you = getUserName();
    const group = findGroup(activeThread);
    const transcript = getThread(activeThread).slice(-12)
        .map((m) => `${m.from === "user" ? you : (group ? (m.author || name) : name)}: ${htmlToPlain(m.text)}`).join("\n");

    // --- แชตกลุ่ม: ให้สมาชิก 1-2 คนตอบ ---
    if (group) {
        const extraG = String(getSetting("connectExtraPrompt") || "").trim();
        const qg =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตกลุ่มชื่อ "${group.name}" ` +
            `สมาชิก: ${group.members.join(", ")} และ ${you}. ` +
            `ให้สมาชิกในกลุ่ม 1-2 คน (เลือกเอง ห้ามใช้ ${you}) ตอบ/คุยต่อจากข้อความล่าสุดอย่างเป็นธรรมชาติ สั้นเหมือนแชตจริง ` +
            `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
            (extraG ? `คำสั่งเพิ่มเติม: ${extraG}.\n` : "") +
            crossAppContext("connect") +
            `บทแชตล่าสุด:\n${transcript}\n` +
            `ตอบบรรทัดละคนในรูปแบบนี้เท่านั้น:\nMSG: <ชื่อสมาชิก> | <ข้อความ>`;
        isConnectReplying = true;
        renderThread();
        try {
            const raw = await tinyGenerate(qg, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
            const list = parseCommentLines(raw, group.members[0] || name, "MSG")
                .filter((c) => c.author.trim().toLowerCase() !== you.trim().toLowerCase());
            if (list.length) {
                for (const c of list.slice(0, 3)) {
                    getThread(activeThread).push({ from: "contact", author: c.author, text: c.text, ts: Date.now() });
                }
                saveFeedData();
            } else {
                toastr.warning("ยังไม่มีใครตอบในกลุ่ม ลองใหม่นะ", "TinyConnect");
            }
        } catch (e) {
            console.error(`[${extensionName}] group reply failed:`, e);
            toastr.error("ตอบแชตกลุ่มไม่สำเร็จ", "TinyConnect");
        } finally {
            isConnectReplying = false;
            renderThread();
        }
        return;
    }

    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] นี่คือแชตส่วนตัวในแอปแชต (คล้ายไลน์) ระหว่าง ${you} กับ ${name}. ` +
        `ตอบข้อความล่าสุดในบทบาทของ ${name} แบบเป็นธรรมชาติ สั้นกระชับเหมือนแชตจริง (1-3 ประโยค) ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
        (String(getSetting("connectExtraPrompt") || "").trim() ? `คำสั่งเพิ่มเติม: ${String(getSetting("connectExtraPrompt")).trim()}.\n` : "") +
        crossAppContext("connect") +
        `บทแชตล่าสุด:\n${transcript}\n` +
        `ตอบเฉพาะข้อความของ ${name} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`;

    isConnectReplying = true;
    renderThread();   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
        let reply = stripReasoning(raw).trim();
        // ถ้าโมเดลห่อด้วย [... Message: ข้อความ] ให้ดึงเฉพาะเนื้อในออกมา
        const wrapped = [...reply.matchAll(/\[[^\]]*?Message:\s*([^\]]+)\]/gi)];
        if (wrapped.length) reply = wrapped.map((m) => m[1].trim()).join("\n");
        // ตัดวงเล็บ/ป้ายกำกับที่หลงเหลือ + "ชื่อ:" นำหน้า
        reply = reply.replace(/^\[|\]$/g, "").trim();
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
        if (reply) {
            getThread(activeThread).push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
            saveFeedData();
        } else {
            toastr.warning("ยังไม่มีคำตอบกลับมา ลองใหม่นะ", "TinyConnect");
        }
    } catch (e) {
        console.error(`[${extensionName}] connect reply failed:`, e);
        toastr.error("ตอบแชตไม่สำเร็จ ลองใหม่นะ", "TinyConnect");
    } finally {
        isConnectReplying = false;
        renderThread();
    }
}

function closePhone() {
    $("#tinyfeed-overlay").removeClass("tinyfeed-visible");
    clearStreamTimer();   // ปิดเครื่อง = หยุด timer สตรีม
    console.log(`[${extensionName}] Phone closed`);
}

// ใช้ธีมกับตัวเครื่อง + ปรับไอคอน
function applyTheme(theme) {
    const phone = $("#tinyfeed-phone");
    phone.removeClass("tinyfeed-theme-dark tinyfeed-theme-light");
    phone.addClass(`tinyfeed-theme-${theme}`);
    // แจ้งเตือนอยู่นอกตัวเครื่อง ต้องใส่ธีมแยก
    $("#tinyfeed-notif")
        .removeClass("tinyfeed-theme-dark tinyfeed-theme-light")
        .addClass(`tinyfeed-theme-${theme}`);
    // ธีมมืดโชว์ไอคอนพระอาทิตย์ (กดเพื่อไปสว่าง), ธีมสว่างโชว์พระจันทร์
    const icon = $("#tinyfeed-theme");
    icon.removeClass("fa-moon fa-sun");
    icon.addClass(theme === "dark" ? "fa-sun" : "fa-moon");
}

function toggleTheme() {
    const current = extension_settings[extensionName].theme || "dark";
    const next = current === "dark" ? "light" : "dark";
    extension_settings[extensionName].theme = next;
    saveSettingsDebounced();
    applyTheme(next);
    console.log(`[${extensionName}] theme:`, next);
}

// ===== ข้อมูลผูกกับแชท (chat_metadata) =====
const METADATA_KEY = "tinyfeed";

// ข้อมูลเริ่มต้นสำหรับแชทที่ยังไม่มีฟีด (เริ่มว่าง — โชว์ empty state)
function getSeedData() {
    return {
        feed: [],
        news: [],
        npcs: [],   // รายชื่อ NPC ประจำของแชทนี้ [{ name, avatar }]
    };
}

// ล้างข้อมูล mockup เก่าที่เคยฝังไว้ (ids p1/p2/n1) ออกจากแชทที่มีอยู่แล้ว
function cleanupMockData(data) {
    let changed = false;
    if (Array.isArray(data.feed) && data.feed.some((p) => p.id === "p1" || p.id === "p2")) {
        data.feed = data.feed.filter((p) => p.id !== "p1" && p.id !== "p2");
        changed = true;
    }
    if (Array.isArray(data.news) && data.news.some((n) => n.id === "n1")) {
        data.news = data.news.filter((n) => n.id !== "n1");
        changed = true;
    }
    if (changed) saveFeedData();
}

// ดึงข้อมูล TinyFeed ของแชทปัจจุบัน
function getFeedData() {
    const context = getContext();
    const meta = context.chatMetadata;
    if (!meta[METADATA_KEY]) {
        meta[METADATA_KEY] = getSeedData();
        saveFeedData();
    }
    cleanupMockData(meta[METADATA_KEY]);   // ล้าง mockup เก่า (ครั้งเดียวต่อแชท)
    return meta[METADATA_KEY];
}

// รายชื่อ NPC ประจำของแชทปัจจุบัน (ensure array สำหรับแชทเก่าที่ยังไม่มี field นี้)
function getNpcs() {
    const data = getFeedData();
    if (!Array.isArray(data.npcs)) data.npcs = [];
    return data.npcs;
}

// หา URL รูปของ NPC จากรายชื่อประจำ (ตามชื่อ) ไม่เจอคืน ""
function getNpcAvatar(name) {
    const key = String(name || "").trim().toLowerCase();
    if (!key) return "";
    const npc = getNpcs().find((n) => String(n.name || "").trim().toLowerCase() === key);
    return (npc && npc.avatar) ? npc.avatar : "";
}

// แปลง HTML ของโพสต์กลับเป็น plain text (สำหรับแนบเข้า prompt)
function htmlToPlain(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return (d.textContent || "").trim();
}

// บันทึกข้อมูลผูกกับแชท
function saveFeedData() {
    const context = getContext();
    if (typeof context.saveMetadata === "function") {
        context.saveMetadata();
    }
}

// ตัวละครหลักของแชทปัจจุบัน { file, name } หรือ null
function getCurrentCharacter() {
    try {
        const context = getContext();
        const charId = context.characterId;
        if (charId === undefined || charId === null) return null;
        const char = context.characters[charId];
        if (!char) return null;
        return { file: char.avatar, name: char.name };
    } catch (e) {
        return null;
    }
}

// ดึง URL avatar ของตัวละครหลัก (override ด้วยลิงก์ภายนอกได้)
function getCharacterAvatar() {
    const char = getCurrentCharacter();
    if (!char) return "";
    const override = (getSetting("charAvatarUrls") || {})[char.file];
    if (override) return override;
    if (!char.file || char.file === "none") return "";
    return `/thumbnail?type=avatar&file=${encodeURIComponent(char.file)}`;
}

// เวลาสัมพัทธ์แบบไทย จาก timestamp (ms)
function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "เมื่อสักครู่";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} วันที่แล้ว`;
    if (d < 30) return `${Math.floor(d / 7)} สัปดาห์ที่แล้ว`;
    if (d < 365) return `${Math.floor(d / 30)} เดือนที่แล้ว`;
    return `${Math.floor(d / 365)} ปีที่แล้ว`;
}

// หา timestamp ของ item (จาก field ts หรือกู้จากตัวเลขใน id) ไม่มีคืน null
function itemTimestamp(item) {
    if (item.ts) return item.ts;
    const m = String(item.id || "").match(/(\d{10,})/);
    return m ? Number(m[1]) : null;
}

// ข้อความเวลาที่จะแสดง (ใช้เวลาสัมพัทธ์ถ้ามี ts/id, ไม่มีก็ใช้ field time เดิม เช่นข้อมูล seed)
function displayTime(item) {
    const ts = itemTimestamp(item);
    return ts ? timeAgo(ts) : (item.time || "");
}

// ย่อเลขก้อนใหญ่ให้สั้น (1500 → 1.5K, 1200000 → 1.2M) ใช้โชว์ในฟีด
function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return +(n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return +(n / 1e3).toFixed(1) + "K";
    return String(n);
}

// สุ่มจำนวนไลค์เริ่มต้นตามช่วงที่ตั้งไว้ใน config (กันค่าเพี้ยน)
function randomInitialLikes() {
    let min = parseInt(getSetting("likesMin"), 10);
    let max = parseInt(getSetting("likesMax"), 10);
    if (!Number.isFinite(min) || min < 0) min = 0;
    if (!Number.isFinite(max) || max < 0) max = 0;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
}

// escape อักขระพิเศษ (คง \n ไว้) สำหรับข่าวที่ต้องแบ่งย่อหน้าเอง
function escapeText(str) {
    const div = document.createElement("div");
    div.textContent = String(str == null ? "" : str);
    return div.innerHTML;
}

// escape ข้อความของผู้ใช้ก่อนยัดลง HTML (กัน HTML พัง/inject) + แปลงขึ้นบรรทัดใหม่เป็น <br>
function escapeHtml(str) {
    return escapeText(str).replace(/\n/g, "<br>");
}

// แต่งข้อความที่ escape แล้ว: markdown เบาๆ + #แฮชแท็ก / @เมนชัน เป็นสีฟ้า
// (ปลอดภัยเพราะรับ input ที่ผ่าน escape มาแล้ว แท็กเดียวที่มีคือ <br>)
function renderRich(html) {
    let s = String(html == null ? "" : html);
    s = s.replace(/`([^`<]+)`/g, '<code class="tinyfeed-code">$1</code>');
    s = s.replace(/\*\*([^*<]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*<\n]+)\*/g, "<em>$1</em>");
    s = s.replace(/~~([^~<]+)~~/g, "<del>$1</del>");
    s = s.replace(/(^|[\s(])#([^\s#@<&]+)/g, '$1<span class="tinyfeed-tag">#$2</span>');
    s = s.replace(/(^|[\s(])@([^\s#@<&]+)/g, '$1<span class="tinyfeed-mention">@$2</span>');
    return s;
}

// escape สำหรับใส่ในค่า attribute (value="...")
function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// วาดรายการ NPC ประจำในหน้า settings
function renderNpcList() {
    const rows = getNpcs().map((npc, i) => `
        <div class="tinyfeed-npc-row" data-index="${i}">
            <input class="tinyfeed-npc-name" type="text" placeholder="ชื่อ NPC" value="${escapeAttr(npc.name)}" />
            <input class="tinyfeed-npc-avatar" type="text" placeholder="ลิงก์รูป (optional)" value="${escapeAttr(npc.avatar)}" />
            <span class="tinyfeed-npc-del" title="ลบ NPC"><i class="fa-solid fa-trash"></i></span>
        </div>
    `).join("");
    $("#tinyfeed-npc-list").html(rows);
}

// ชื่อ persona ของผู้ใช้ปัจจุบัน
function getUserName() {
    try {
        return getContext().name1 || "คุณ";
    } catch (e) {
        return "คุณ";
    }
}

// URL avatar ของ persona ผู้ใช้ ถ้าไม่ได้คืน "" แล้วให้ fallback เป็น anon
function getUserAvatar() {
    const override = getSetting("userAvatarUrl");
    if (override) return override;   // ลิงก์ภายนอกจาก config
    try {
        const ctx = getContext();
        // ชื่อไฟล์ persona: context ไม่มีให้ ดึงจากโมดูล core (live binding)
        const file = ctx.user_avatar || (stScriptModule && stScriptModule.user_avatar);
        if (file && file !== "none") {
            if (typeof ctx.getThumbnailUrl === "function") {
                return ctx.getThumbnailUrl("persona", file);   // /thumbnail?type=persona&file=...
            }
            return `/thumbnail?type=persona&file=${encodeURIComponent(file)}`;
        }
    } catch (e) {
        /* เงียบไว้ แล้ว fallback */
    }
    // fallback: ดึง src รูป persona จากข้อความผู้ใช้ในแชท (ถ้ามี)
    const domSrc = $('.mes[is_user="true"] .avatar img').last().attr("src");
    return domSrc || "";
}

// จัดการเมื่อรูป avatar โหลดไม่สำเร็จ (เรียกจาก onerror)
// ต้องเป็น global เพราะ inline onerror ทำงานใน global scope
window.tinyfeedAvatarError = function (img) {
    const author = img.getAttribute("data-author") || "?";
    const temp = document.createElement("div");
    temp.innerHTML = makeAnonAvatar(author);
    const anon = temp.firstElementChild;
    if (anon) img.replaceWith(anon);
};

// สร้าง avatar anonymous จากตัวอักษรแรก + สีตายตัวตามชื่อ
function makeAnonAvatar(name) {
    const safe = name || "?";
    const letter = safe.trim().charAt(0).toUpperCase();
    let hash = 0;
    for (let i = 0; i < safe.length; i++) {
        hash = safe.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const bg = `hsl(${hue}, 55%, 45%)`;
    return `<div class="tinyfeed-avatar tinyfeed-avatar-anon" style="background:${bg}">${letter}</div>`;
}

function makeAvatar(item) {
    let src = item.avatar;
    // resolve รูปแบบ live เพื่อให้ override จาก config มีผลทันที
    if (!src && item.isMain) {
        src = getCharacterAvatar();
    } else if (!src && item.isUser) {
        src = getUserAvatar();
    } else if (!src) {
        src = getNpcAvatar(item.author);   // NPC ที่อยู่ในรายชื่อประจำ + มีลิงก์รูป
    }
    if (src) {
        const safeAuthor = String(item.author || "?").replace(/"/g, "");
        return `<img class="tinyfeed-avatar" src="${src}" data-author="${safeAuthor}"
        onerror="window.tinyfeedAvatarError && window.tinyfeedAvatarError(this)" />`;
    }
    return makeAnonAvatar(item.author);
}

// คอมเมนต์: limit = จำนวนที่โชว์ (undefined = โชว์หมด)
function renderComments(comments, limit) {
    if (!comments || comments.length === 0) return "";
    const list = limit ? comments.slice(0, limit) : comments;
    const rows = list.map((c) => `
        <div class="tinyfeed-comment">
            ${makeAvatar(c)}
            <div class="tinyfeed-comment-body">
                <span class="tinyfeed-comment-author">${c.author}</span>
                <span class="tinyfeed-comment-text">${renderRich(c.text)}</span>
            </div>
        </div>
    `).join("");
    const more = (limit && comments.length > limit)
        ? `<div class="tinyfeed-more">ดูคอมเมนต์ทั้งหมด ${comments.length} รายการ</div>`
        : "";
    return `<div class="tinyfeed-comments">${rows}${more}</div>`;
}

// สรุปเนื้อหาของแต่ละแอปเป็นบล็อกข้อความ (ใช้ร่วมกันทั้ง inject เข้า RP และ context ข้ามแอป)
function buildAppBlocks(want) {
    const data = getFeedData();
    const count = Math.max(1, parseInt(want.count, 10) || 5);
    const blocks = [];
    if (want.feed) {
        const posts = (data.feed || []).slice(0, count)
            .map((p) => `- ${p.author}: ${htmlToPlain(p.text)}`);
        if (posts.length) blocks.push(`โพสต์ล่าสุดบนฟีด TinyFeed:\n${posts.join("\n")}`);
    }
    if (want.news) {
        const news = (data.news || []).slice(0, count)
            .map((n) => `- [${htmlToPlain(n.source)}] ${htmlToPlain(n.title)}: ${htmlToPlain(n.summary)}`);
        if (news.length) blocks.push(`ข่าวล่าสุดในโลก:\n${news.join("\n")}`);
    }
    if (want.connect) {
        const threads = (data.connect && data.connect.threads) || {};
        const lines = [];
        for (const c of getConnectContacts()) {
            const t = threads[c.key];
            if (!Array.isArray(t) || !t.length) continue;
            const msgs = t.slice(-count)
                .map((m) => `  ${m.from === "user" ? getUserName() : c.name}: ${htmlToPlain(m.text)}`);
            lines.push(`แชตกับ ${c.name}:\n${msgs.join("\n")}`);
        }
        if (lines.length) blocks.push(`แชตส่วนตัวในแอป TinyConnect:\n${lines.join("\n")}`);
    }
    if (want.stream) {
        const s = data.stream;
        if (s) {
            const parts = [];
            if (s.live) parts.push(`กำลังไลฟ์อยู่: "${htmlToPlain(s.title)}" (ผู้ชม ${formatCount(s.viewers)})`);
            const cs = (s.comments || []).filter((c) => !c.isSystem).slice(-count)
                .map((c) => `  ${c.author}: ${htmlToPlain(c.text)}`);
            if (cs.length) parts.push(`คอมเมนต์สดล่าสุด:\n${cs.join("\n")}`);
            if (parts.length) blocks.push(`ไลฟ์สตรีมในแอป TinyStream:\n${parts.join("\n")}`);
        }
    }
    return blocks;
}

// context จาก "แอปอื่น" สำหรับแนบเข้า prompt ตอน generate (เชื่อมเนื้อหาข้ามแอป)
function crossAppContext(exclude) {
    if (!getSetting("crossAppEnabled")) return "";
    const count = Math.max(1, parseInt(getSetting("crossAppCount"), 10) || 3);
    const want = { feed: true, news: true, connect: true, stream: true, count };
    if (exclude && Object.prototype.hasOwnProperty.call(want, exclude)) want[exclude] = false;
    const blocks = buildAppBlocks(want);
    if (!blocks.length) return "";
    return `\n[เนื้อหาจากแอปอื่นในโทรศัพท์ อ้างอิงถึงได้ถ้าเข้ากับสถานการณ์]\n${blocks.join("\n\n")}\n`;
}

// Phase 2: แทรกฟีด/ข่าว/แชต/ไลฟ์ เข้าประวัติแชทหลัก ให้โมเดล RP รับรู้ (เรียลไทม์)
function updateChatInjection() {
    const ctx = getContext();
    if (typeof ctx.setExtensionPrompt !== "function") return;
    const mode = getSetting("injectMode") || "off";
    const wantConnect = Boolean(getSetting("injectConnect"));
    const wantStream = Boolean(getSetting("injectStream"));
    const depth = Math.max(0, parseInt(getSetting("injectDepth"), 10) || 4);
    const count = Math.max(1, parseInt(getSetting("injectCount"), 10) || 5);

    if (mode === "off" && !wantConnect && !wantStream) {
        ctx.setExtensionPrompt("tinyfeed_inject", "", 1, 0);   // เคลียร์
        return;
    }
    const blocks = buildAppBlocks({
        feed: mode !== "off",
        news: mode === "both",
        connect: wantConnect,
        stream: wantStream,
        count,
    });

    const text = blocks.length
        ? `[ข้อมูลจากโทรศัพท์ TinyPhone ที่ตัวละครรับรู้ได้ ใช้อ้างอิงในบทบาทได้ตามเหมาะสม]\n${blocks.join("\n\n")}`
        : "";
    // position 1 = IN_CHAT, role 0 = SYSTEM
    ctx.setExtensionPrompt("tinyfeed_inject", text, 1, depth, false, 0);
}

// Stage 11: empty state + skeleton
function emptyStateHtml(icon, title, sub) {
    return `<div class="tinyfeed-empty">
        <i class="fa-solid ${icon}"></i>
        <div class="tinyfeed-empty-title">${title}</div>
        <div class="tinyfeed-empty-sub">${sub}</div>
    </div>`;
}

function skeletonCardHtml() {
    return `<div class="tinyfeed-skel">
        <div class="tinyfeed-skel-head">
            <div class="tinyfeed-skel-avatar tinyfeed-shimmer"></div>
            <div class="tinyfeed-skel-lines">
                <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:40%"></div>
                <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:25%"></div>
            </div>
        </div>
        <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:95%"></div>
        <div class="tinyfeed-shimmer tinyfeed-skel-line" style="width:80%"></div>
    </div>`;
}

function renderFeed() {
    const data = getFeedData();
    if (!data.feed.length) {
        $("#tinyfeed-feed-list").html(emptyStateHtml("fa-feather-pointed", "ยังไม่มีโพสต์", "เขียนโพสต์แรก หรือกด “ให้ตัวละครโพสต์” ได้เลย"));
        renderComposeAvatar();
        updateChatInjection();
        return;
    }
    const html = data.feed.map((post) => `
        <div class="tinyfeed-post" data-post="${post.id}">
            <div class="tinyfeed-post-head">
                ${makeAvatar(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
                ${(post.isUser || post.isAI) ? `<span class="tinyfeed-delete" data-post="${post.id}" title="ลบโพสต์"><i class="fa-solid fa-trash"></i></span>` : ""}
            </div>
            <div class="tinyfeed-post-body">${renderRich(post.text)}</div>
            <div class="tinyfeed-post-actions">
                <span class="tinyfeed-like ${post.liked ? "tinyfeed-liked" : ""}" data-post="${post.id}">
                    <i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}
                </span>
                <span class="tinyfeed-comment-btn" data-post="${post.id}">
                    <i class="fa-solid fa-comment"></i> ${formatCount(post.comments.length)}
                </span>
                <span class="tinyfeed-share ${post.shared ? "tinyfeed-shared" : ""}" data-post="${post.id}">
                    <i class="fa-solid fa-share"></i>
                </span>
            </div>
            ${renderComments(post.comments, 2)}
        </div>
    `).join("");
    $("#tinyfeed-feed-list").html(html);
    renderComposeAvatar();
    updateChatInjection();
}

// อัปเดตรูป avatar ในช่องเขียนโพสต์ให้ตรงกับ persona ปัจจุบัน
function renderComposeAvatar() {
    $("#tinyfeed-compose .tinyfeed-compose-avatar").html(
        makeAvatar({ author: getUserName(), avatar: getUserAvatar() })
    );
}

function renderNews() {
    const data = getFeedData();
    if (!data.news.length) {
        $("#tinyfeed-news-list").html(emptyStateHtml("fa-newspaper", "ยังไม่มีข่าว", "กด “สร้างข่าวใหม่” เพื่อให้ AI แต่งข่าวเสริมโลกของเรื่อง"));
        updateChatInjection();
        return;
    }
    const html = data.news.map((news) => `
        <div class="tinyfeed-news" data-news="${news.id}">
            <div class="tinyfeed-news-head">
                <span class="tinyfeed-news-source">${news.source}</span>
                <span class="tinyfeed-news-head-right">
                    <span class="tinyfeed-news-time">${displayTime(news)}</span>
                    ${news.isAI ? `<span class="tinyfeed-news-delete" data-news="${news.id}" title="ลบข่าว"><i class="fa-solid fa-trash"></i></span>` : ""}
                </span>
            </div>
            <div class="tinyfeed-news-title">${news.title}</div>
            <div class="tinyfeed-news-summary">${renderRich(news.summary)}</div>
        </div>
    `).join("");
    $("#tinyfeed-news-list").html(html);
    updateChatInjection();
}

let activeTab = "feed";

function switchTab(tab) {
    activeTab = tab;
    $(".tinyfeed-tab").removeClass("tinyfeed-tab-active");
    $(`.tinyfeed-tab[data-tab="${tab}"]`).addClass("tinyfeed-tab-active");
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $(`#tinyfeed-panel-${tab}`).removeClass("tinyfeed-hidden");
}

// เปิดหน้ารายละเอียดโพสต์
function openPostDetail(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const html = `
        <div class="tinyfeed-post tinyfeed-post-detail">
            <div class="tinyfeed-post-head">
                ${makeAvatar(post)}
                <div class="tinyfeed-post-meta">
                    <span class="tinyfeed-post-author">${post.author}</span>
                    <span class="tinyfeed-post-time">${displayTime(post)}</span>
                </div>
            </div>
            <div class="tinyfeed-post-body">${renderRich(post.text)}</div>
            <div class="tinyfeed-post-actions">
                <span><span class="fa-regular fa-heart"></span> ${Number(post.likes || 0).toLocaleString()}</span>
                <span><span class="fa-regular fa-comment"></span> ${post.comments.length.toLocaleString()}</span>
                <span><span class="fa-solid fa-share"></span></span>
            </div>
        </div>
        ${renderComments(post.comments)}
        ${isReplying === post.id ? `
            <div class="tinyfeed-comment tinyfeed-comment-typing">
                <div class="tinyfeed-avatar tinyfeed-avatar-anon">…</div>
                <div class="tinyfeed-comment-body"><span class="tinyfeed-comment-text">กำลังพิมพ์…</span></div>
            </div>` : ""}
        ${getSetting("commentReplyMode") === "manual" && post.comments.length ? `
            <button class="tinyfeed-ai-reply tinyfeed-btn-generate" data-post="${post.id}">
                <i class="fa-solid fa-wand-magic-sparkles"></i> <span>ให้ AI ตอบ</span>
            </button>` : ""}
        <div class="tinyfeed-comment-compose">
            ${makeAvatar({ isUser: true, author: getUserName() })}
            <input class="tinyfeed-comment-input" type="text" placeholder="เขียนคอมเมนต์..." data-post="${post.id}" />
            <span class="tinyfeed-comment-send" data-post="${post.id}"><i class="fa-solid fa-paper-plane"></i></span>
        </div>
    `;
    showDetail(html);
}

function toggleLike(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    saveFeedData();
    // อัปเดตเฉพาะปุ่ม (ไม่ re-render ทั้งฟีด กัน flicker) + หัวใจเด้ง
    const el = $(`.tinyfeed-like[data-post="${postId}"]`);
    el.toggleClass("tinyfeed-liked", post.liked)
      .html(`<i class="fa-solid fa-heart"></i> ${formatCount(post.likes)}`);
    if (post.liked) {
        el.addClass("tinyfeed-pop");
        setTimeout(() => el.removeClass("tinyfeed-pop"), 320);
    }
    console.log(`[${extensionName}] like:`, postId, post.liked);
}

function toggleShare(postId) {
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.shared = !post.shared;
    saveFeedData();
    $(`.tinyfeed-share[data-post="${postId}"]`).toggleClass("tinyfeed-shared", post.shared);
    console.log(`[${extensionName}] share:`, postId, post.shared);
}

// ผู้ใช้โพสต์เอง — แทรกบนสุดของฟีด เก็บผูกกับแชท
async function addUserPost(text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const post = {
        id: "u" + Date.now(),
        author: getUserName(),
        isUser: true,
        avatar: "",              // ปล่อยว่างให้ makeAvatar resolve live (รับ override จาก config)
        ts: Date.now(),
        text: escapeHtml(clean),
        likes: randomInitialLikes(),   // สุ่มไลค์เริ่มต้นเหมือนโพสต์ AI
        comments: [],
    };
    getFeedData().feed.unshift(post);
    saveFeedData();
    renderFeed();
    console.log(`[${extensionName}] user post added:`, post.id);
    await generateInitialComments(post);   // ให้ NPC คอมเมนต์โพสต์ของผู้ใช้ (ตาม config)
}

// ลบโพสต์ที่ลบได้ (โพสต์ผู้ใช้เอง หรือโพสต์ที่ AI สร้าง)
function deleteUserPost(postId) {
    const data = getFeedData();
    const post = data.feed.find((p) => p.id === postId);
    if (!post || !(post.isUser || post.isAI)) return;
    if (!confirm("ต้องการลบโพสต์นี้ใช่ไหม?")) return;
    data.feed = data.feed.filter((p) => p.id !== postId);
    saveFeedData();
    renderFeed();
    console.log(`[${extensionName}] post deleted:`, postId);
}

// ===== Stage 6: ให้ AI สร้างโพสต์ฟีด =====

// ตัดส่วน reasoning/thinking ออกจากผลลัพธ์ AI (กันโมเดลที่คิดก่อนตอบ)
function stripReasoning(raw) {
    let s = String(raw || "");
    // 1) ใช้ reasoning tag ที่ตั้งไว้ใน SillyTavern (ถ้ามี)
    try {
        const r = getContext().powerUserSettings && getContext().powerUserSettings.reasoning;
        if (r && r.prefix && r.suffix) {
            const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            s = s.replace(new RegExp(`${esc(r.prefix)}[\\s\\S]*?${esc(r.suffix)}`, "g"), "");
            // reasoning ถูกตัดกลางคัน (มี prefix แต่ไม่มี suffix) → ตัดตั้งแต่ prefix ทิ้ง
            const pi = s.indexOf(r.prefix);
            if (pi !== -1 && s.indexOf(r.suffix, pi) === -1) s = s.slice(0, pi);
        }
    } catch (e) { /* ไม่มี config ก็ข้ามไป fallback */ }
    // 2) fallback: tag ยอดนิยม (ทั้งแบบปิดครบ และแบบเปิดค้างเพราะถูกตัด)
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*?<\/\1>/gi, "");
    s = s.replace(/<(think|thinking|reason|reasoning)>[\s\S]*$/i, "");
    return s.trim();
}

// ===== Phase 2: ชั้น generation รองรับ API แยก =====

// สร้าง context เนื้อเรื่อง (ใช้เฉพาะตอนยิงไป profile แยก เพราะไม่มี context RP ติดไปให้)
// ดึงคำอธิบาย persona ปัจจุบัน (มีหลายที่เก็บ ลองตามลำดับ)
function getPersonaDescription() {
    try {
        const pu = getContext().powerUserSettings || {};
        if (pu.persona_description) return String(pu.persona_description);
        const file = getContext().user_avatar || (stScriptModule && stScriptModule.user_avatar);
        const byAvatar = pu.persona_descriptions && file ? pu.persona_descriptions[file] : null;
        return (byAvatar && byAvatar.description) ? String(byAvatar.description) : "";
    } catch (e) {
        return "";
    }
}

async function buildContextPreamble() {
    try {
        const ctx = getContext();
        const sections = [];
        const push = (title, body) => {
            const b = String(body == null ? "" : body).trim();
            if (b) sections.push(`【${title}】\n${b}`);
        };

        // --- ตัวละครหลัก ---
        const char = getCurrentCharacter();
        const chId = ctx.characterId;
        const card = (chId != null && ctx.characters) ? ctx.characters[chId] : null;
        const charLines = [];
        if (char) charLines.push(`ชื่อ: ${char.name}`);
        if (card) {
            if (card.description) charLines.push(`คำอธิบาย:\n${htmlToPlain(card.description)}`);
            if (card.personality) charLines.push(`บุคลิก:\n${htmlToPlain(card.personality)}`);
            if (card.scenario) charLines.push(`ฉาก:\n${htmlToPlain(card.scenario)}`);
        }
        push("ตัวละครหลัก", charLines.join("\n"));

        // --- ผู้ใช้ / Persona ---
        const personaDesc = getPersonaDescription();
        push("ผู้ใช้ (Persona)",
            `ชื่อ: ${getUserName()}` + (personaDesc ? `\nคำอธิบาย:\n${htmlToPlain(personaDesc)}` : ""));

        // --- World Info (ทุกตำแหน่งที่ ST inject) ---
        try {
            if (typeof ctx.getWorldInfoPrompt === "function" && Array.isArray(ctx.chat) && ctx.chat.length) {
                // ⚠️ ST ส่ง chat เป็น array ของ string "ชื่อ: ข้อความ" และ reverse (ใหม่→เก่า)
                const chatForWI = ctx.chat.map((m) => `${m.name}: ${m.mes}`).reverse();
                const scanData = {
                    personaDescription: personaDesc || "",
                    characterDescription: (card && card.description) || "",
                    characterPersonality: (card && card.personality) || "",
                    characterDepthPrompt: "",
                    scenario: (card && card.scenario) || "",
                    creatorNotes: (card && card.creator_notes) || "",
                    trigger: "normal",
                };
                const wi = await ctx.getWorldInfoPrompt(chatForWI, ctx.maxContext || 4096, true, scanData) || {};
                const wiParts = [];
                const add = (label, val) => {
                    const t = String(val || "").trim();
                    if (t) wiParts.push(`— ${label} —\n${htmlToPlain(t)}`);
                };
                add("ก่อนคำอธิบายตัวละคร", wi.worldInfoBefore);
                add("หลังคำอธิบายตัวละคร", wi.worldInfoAfter);
                if (Array.isArray(wi.anBefore) && wi.anBefore.length) add("ก่อน Author's Note", wi.anBefore.join("\n"));
                if (Array.isArray(wi.anAfter) && wi.anAfter.length) add("หลัง Author's Note", wi.anAfter.join("\n"));
                if (Array.isArray(wi.worldInfoDepth) && wi.worldInfoDepth.length) {
                    const d = wi.worldInfoDepth
                        .map((x) => `(depth ${x.depth}) ${(x.entries || []).join(" | ")}`).join("\n");
                    add("แทรกในบทสนทนา", d);
                }
                if (Array.isArray(wi.worldInfoExamples) && wi.worldInfoExamples.length) {
                    add("ตัวอย่างบทสนทนา", wi.worldInfoExamples
                        .map((e) => (typeof e === "string" ? e : (e && e.content) || "")).join("\n"));
                }
                if (wi.outletEntries && typeof wi.outletEntries === "object") {
                    for (const [k, v] of Object.entries(wi.outletEntries)) {
                        if (Array.isArray(v) && v.length) add(`Outlet: ${k}`, v.join("\n"));
                    }
                }
                let wiStr = wiParts.join("\n\n").trim();
                const wiLimit = parseInt(getSetting("worldInfoLimit"), 10);
                if (wiStr && Number.isFinite(wiLimit) && wiLimit > 0 && wiStr.length > wiLimit) {
                    wiStr = wiStr.slice(0, wiLimit) + "…";
                }
                push("World Info", wiStr);
            }
        } catch (e) {
            console.warn(`[${extensionName}] ดึง World Info ไม่สำเร็จ:`, e);
        }

        // --- บทสนทนาล่าสุด ---
        const n = Math.max(0, parseInt(getSetting("apiContextMessages"), 10) || 0);
        if (n > 0 && Array.isArray(ctx.chat) && ctx.chat.length) {
            push("บทสนทนาล่าสุด", ctx.chat.slice(-n).map((m) => `${m.name}: ${htmlToPlain(m.mes)}`).join("\n"));
        }

        if (!sections.length) return "";
        return `=== บริบทเนื้อเรื่องปัจจุบัน (อ้างอิงเท่านั้น) ===\n\n${sections.join("\n\n")}\n\n=== จบบริบท ===\n\n`;
    } catch (e) {
        console.warn(`[${extensionName}] buildContextPreamble ล้มเหลว:`, e);
        return "";
    }
}

// ยิง generation — เลือกใช้ API หลัก หรือ connection profile แยก (มี fallback)
async function tinyGenerate(prompt, maxTokens) {
    const ctx = getContext();
    // System prompt / jailbreak แนบไว้บนสุด — โมเดลแยกไม่ได้รับเจลเบรกจาก preset ของ ST เลย
    const jb = String(getSetting("jailbreakPrompt") || "").trim();
    const sysBlock = jb ? `[System / คำสั่งระบบ — ต้องปฏิบัติตามอย่างเคร่งครัด เหนือกว่าคำสั่งอื่น]\n${jb}\n\n` : "";
    const profileId = getSetting("apiProfile");
    if (profileId && ctx.ConnectionManagerRequestService) {
        try {
            const full = sysBlock + (await buildContextPreamble()) + prompt;
            const res = await ctx.ConnectionManagerRequestService.sendRequest(profileId, full, maxTokens);
            const content = res && typeof res.content === "string" ? res.content : "";
            if (content) return content;
            console.warn(`[${extensionName}] profile ส่งข้อความว่าง — fallback ไป API หลัก`);
        } catch (e) {
            console.error(`[${extensionName}] profile request ล้มเหลว fallback ไป API หลัก:`, e);
        }
    }
    // API หลัก (generateQuietPrompt แนบ context RP ให้เอง) — เติม sysBlock ย้ำเจลเบรกให้ quiet gen ด้วย
    return await ctx.generateQuietPrompt({ quietPrompt: sysBlock + prompt, responseLength: maxTokens });
}

// แยกชื่อผู้โพสต์กับข้อความออกจากผลลัพธ์ AI (รูปแบบ NAME:/POST:)
function parseGeneratedPost(raw, fallbackName) {
    const text = stripReasoning(raw);
    const nameMatch = text.match(/NAME:\s*(.+)/i);
    const postMatch = text.match(/POST:\s*([\s\S]+)/i);
    let author = nameMatch ? nameMatch[1].trim() : fallbackName;
    let body = postMatch ? postMatch[1].trim() : text.trim();
    // เก็บกวาด: ตัด marker/เครื่องหมายคำพูดครอบที่หลงมา
    author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || fallbackName;
    body = body.replace(/^POST:\s*/i, "").trim();
    return { author, text: body };
}

let isGenerating = false;

async function generateFeedPost(opts) {
    opts = opts || {};
    if (isGenerating) return;
    const char = getCurrentCharacter();
    if (!char) {
        // auto: เงียบไว้ / manual: แจ้งเตือน
        if (!opts.silent) toastr.info("เปิดแชทที่มีตัวละครก่อนนะ แล้วค่อยให้ AI โพสต์", "TinyFeed");
        return;
    }
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyFeed");
        return;
    }

    isGenerating = true;
    const btn = $("#tinyfeed-generate");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    btn.find(".tinyfeed-generate-label").text("กำลังสร้าง...");
    $("#tinyfeed-feed-list").prepend(`<div id="tinyfeed-feed-skel">${skeletonCardHtml()}</div>`);

    const charName = char.name || "ตัวละคร";

    // 6.5: รายชื่อ NPC ประจำ → คุมให้ AI เลือกผู้โพสต์จากลิสต์
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    const rosterLine = npcNames.length
        ? `ผู้โพสต์ต้องเป็น ${charName} หรือหนึ่งใน NPC ต่อไปนี้เท่านั้น (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
        : `ผู้โพสต์จะเป็น ${charName} หรือ NPC ตัวใดตัวหนึ่งในโลกของเรื่องก็ได้. `;

    // 6.6: แนบโพสต์ล่าสุดเป็น context กันโพสต์ซ้ำ
    let historyLine = "";
    const n = parseInt(getSetting("historyCount"), 10);
    if (Number.isFinite(n) && n > 0) {
        const recent = getFeedData().feed
            .slice(0, n)
            .map((p) => `- ${p.author}: ${htmlToPlain(p.text)}`)
            .filter(Boolean);
        if (recent.length) {
            historyLine =
                `\nโพสต์ล่าสุดที่มีอยู่แล้วในฟีด (ห้ามเขียนซ้ำหรือใกล้เคียง แต่อ้างอิง/สานต่อได้):\n` +
                recent.join("\n") + `\n`;
        }
    }

    const extra = String(getSetting("postExtraPrompt") || "").trim();
    const extraLine = extra ? `คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}. ` : "";

    const quietPrompt =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ` +
        `เขียนโพสต์โซเชียลมีเดียสั้นๆ 1 โพสต์ (1-3 ประโยค) ที่จะปรากฏบนฟีด ` +
        `สะท้อนอารมณ์หรือสถานการณ์ในเนื้อเรื่องตอนนี้. ` +
        rosterLine +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนหรือกระทำแทนผู้ใช้. ` +
        extraLine +
        historyLine +
        crossAppContext("feed") +
        `ตอบกลับตามรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\n` +
        `NAME: <ชื่อผู้โพสต์>\nPOST: <ข้อความโพสต์>`;

    try {
        const raw = await tinyGenerate(quietPrompt, Math.max(1, parseInt(getSetting("postTokens"), 10) || 400));
        const { author, text } = parseGeneratedPost(raw, charName);
        if (!text) {
            toastr.warning("AI ไม่ได้ส่งข้อความโพสต์กลับมา ลองใหม่อีกครั้งนะ", "TinyFeed");
            return;
        }
        const isMain = author.trim().toLowerCase() === charName.trim().toLowerCase();
        const post = {
            id: "ai" + Date.now(),
            author: isMain ? charName : author,
            isMain: isMain,          // ตรงตัวละครหลัก = รูปการ์ด, ไม่ตรง = NPC (anon avatar)
            isAI: true,              // โพสต์จาก AI — เปิดปุ่มลบ (เผื่อ format เพี้ยน)
            avatar: "",
            ts: Date.now(),
            text: escapeHtml(text),
            likes: randomInitialLikes(),   // สุ่มไลค์เริ่มต้นตามช่วงใน config
            comments: [],
        };
        getFeedData().feed.unshift(post);
        saveFeedData();
        renderFeed();
        if (opts.notify) showPushNotification(post);   // แจ้งเตือนสไตล์โทรศัพท์ (auto-post)
        console.log(`[${extensionName}] AI post added:`, post.id, "by", post.author);
        await generateInitialComments(post);           // Stage 8: คอมเมนต์ NPC ติดมา (ตาม config)
    } catch (e) {
        console.error(`[${extensionName}] generate failed:`, e);
        if (!opts.silent) toastr.error("สร้างโพสต์ไม่สำเร็จ ลองใหม่อีกครั้งนะ", "TinyFeed");
    } finally {
        $("#tinyfeed-feed-skel").remove();
        isGenerating = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
        btn.find(".tinyfeed-generate-label").text("ให้ตัวละครโพสต์");
    }
}

// ===== Stage 8: คอมเมนต์ + AI ตอบ =====
let isReplying = null;   // postId ที่ AI กำลังตอบคอมเมนต์อยู่ (โชว์ "กำลังพิมพ์…")

// สร้าง object คอมเมนต์ (ตั้ง isMain ถ้าเป็นตัวละครหลัก จะได้ใช้รูปการ์ด)
function makeCommentObj(author, text, charName) {
    const isMain = String(author).trim().toLowerCase() === String(charName).trim().toLowerCase();
    return { author: isMain ? charName : author, isMain, avatar: "", text: escapeHtml(text) };
}

// parse คอมเมนต์หลายอันจากผลลัพธ์ AI (รูปแบบบรรทัดละ: COMMENT: ชื่อ | ข้อความ)
function parseCommentLines(raw, charName, marker) {
    const s = stripReasoning(raw);
    const out = [];
    const re = new RegExp(`${marker || "COMMENT"}:\\s*(.+)`, "gi");
    let m;
    while ((m = re.exec(s)) !== null) {
        const line = m[1].trim();
        const parts = line.split("|");
        let author, text;
        if (parts.length >= 2) {
            author = parts[0].trim();
            text = parts.slice(1).join("|").trim();
        } else {
            author = charName;
            text = line;
        }
        author = author.replace(/^["'“”\[\(]+|["'“”\]\)]+$/g, "").trim() || charName;
        if (text) out.push(makeCommentObj(author, text, charName));
    }
    return out;
}

// ผู้ใช้คอมเมนต์เอง
async function addComment(postId, text) {
    const clean = String(text || "").trim();
    if (!clean) return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    post.comments.push({ author: getUserName(), isUser: true, avatar: "", text: escapeHtml(clean) });
    saveFeedData();
    openPostDetail(postId);   // refresh หน้ารายละเอียด
    if (getSetting("commentReplyMode") === "instant") {
        await generateCommentReply(postId);
    }
}

// รวมรายชื่อ NPC เป็นประโยคสำหรับ prompt
function npcRosterLine(charName) {
    const npcNames = getNpcs().map((n) => String(n.name || "").trim()).filter(Boolean);
    return npcNames.length
        ? `ผู้คอมเมนต์เป็นตัวละครหลัก (${charName}) หรือ NPC เหล่านี้ (สะกดชื่อให้ตรงเป๊ะ): ${npcNames.join(", ")}. `
        : `ผู้คอมเมนต์เป็นตัวละครหลัก (${charName}) หรือ NPC ตัวใดในโลกของเรื่องก็ได้. `;
}

// AI ตอบคอมเมนต์ 1 อัน (เลือกผู้ตอบเอง: เจ้าของโพสต์หรือ NPC)
async function generateCommentReply(postId) {
    if (isReplying) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") return;
    const post = getFeedData().feed.find((p) => p.id === postId);
    if (!post) return;
    const char = getCurrentCharacter();
    const charName = (char && char.name) || "ตัวละคร";

    const thread = post.comments.slice(-6)
        .map((c) => `- ${c.author}: ${htmlToPlain(c.text)}`).join("\n");
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาทตอบยาว] ` +
        `มีโพสต์บนฟีดว่า: "${htmlToPlain(post.text)}" (โดย ${post.author}). ` +
        `คอมเมนต์ในโพสต์ล่าสุด:\n${thread}\n` +
        `เขียนคอมเมนต์ตอบกลับสั้นๆ 1 อัน จะเป็น ${post.author} หรือ NPC ที่เกี่ยวข้องก็ได้ (เลือกเอง). ` +
        npcRosterLine(charName) +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้. ` +
        `ตอบรูปแบบนี้เท่านั้น:\nCOMMENT: <ชื่อ> | <ข้อความ>`;

    isReplying = postId;
    openPostDetail(postId);   // โชว์ "กำลังพิมพ์…"
    try {
        const raw = await tinyGenerate(q, 150);
        const list = parseCommentLines(raw, charName);
        if (list.length) {
            post.comments.push(list[0]);
            saveFeedData();
        }
    } catch (e) {
        console.error(`[${extensionName}] comment reply failed:`, e);
        toastr.error("AI ตอบคอมเมนต์ไม่สำเร็จ ลองใหม่นะ", "TinyFeed");
    } finally {
        isReplying = null;
        openPostDetail(postId);
    }
}

// สร้างคอมเมนต์ NPC ติดมากับโพสต์ AI ใหม่ (ตาม config)
async function generateInitialComments(post) {
    const mode = getSetting("initialCommentMode");
    if (mode === "none") return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") return;
    const char = getCurrentCharacter();
    const charName = (char && char.name) || "ตัวละคร";

    let countLine;
    if (mode === "fixed") {
        const nc = Math.max(1, parseInt(getSetting("initialCommentCount"), 10) || 1);
        countLine = `เขียนคอมเมนต์ ${nc} อัน. `;
    } else {
        countLine = `เขียนคอมเมนต์ 0 ถึง 3 อันตามที่เหมาะสม (ถ้าไม่มีใครน่าคอมเมนต์ก็ไม่ต้องเขียน). `;
    }
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] มีโพสต์บนฟีดว่า: "${htmlToPlain(post.text)}" (โดย ${post.author}). ` +
        `เขียนคอมเมนต์ใต้โพสต์นี้ให้สมจริง. ` + npcRosterLine(charName) + countLine +
        `ห้ามให้ ${post.author} คอมเมนต์โพสต์ตัวเอง ห้ามพูดแทนผู้ใช้. ` +
        `ตอบแต่ละคอมเมนต์บรรทัดละอันในรูปแบบ:\nCOMMENT: <ชื่อ> | <ข้อความ>`;
    try {
        const raw = await tinyGenerate(q, 300);
        const comments = parseCommentLines(raw, charName)
            .filter((c) => c.author.trim().toLowerCase() !== String(post.author).trim().toLowerCase());
        if (comments.length) {
            post.comments.push(...comments);
            saveFeedData();
            renderFeed();
        }
    } catch (e) {
        console.error(`[${extensionName}] initial comments failed:`, e);
    }
}

// ===== Stage 9: แท็บข่าวสาร (AI generate) =====
let isGeneratingNews = false;

// parse ข่าวจากผลลัพธ์ AI (SOURCE/TITLE/SUMMARY/BODY)
function parseGeneratedNews(raw) {
    const s = stripReasoning(raw);
    const grab = (re) => { const m = s.match(re); return m ? m[1].trim() : ""; };
    let source = grab(/SOURCE:\s*(.+)/i);
    let title = grab(/TITLE:\s*(.+)/i);
    let summary = grab(/SUMMARY:\s*(.+)/i);
    let bodyM = s.match(/BODY:\s*([\s\S]+)/i);
    let body = bodyM ? bodyM[1].trim() : "";
    // fallback ถ้า format เพี้ยน
    if (!title && !body) { title = s.trim().split("\n")[0] || "ข่าวไม่มีหัวข้อ"; body = s.trim(); }
    if (!body) body = summary || title;
    if (!summary) summary = body.split("\n")[0];
    if (!source) source = "สำนักข่าว";
    return { source, title, summary, body };
}

async function generateNews(opts) {
    opts = opts || {};
    if (isGeneratingNews) return;
    const ctx = getContext();
    if (typeof ctx.generateQuietPrompt !== "function") {
        if (!opts.silent) toastr.error("เวอร์ชัน SillyTavern นี้ไม่มี generateQuietPrompt", "TinyFeed");
        return;
    }

    isGeneratingNews = true;
    const btn = $("#tinyfeed-generate-news");
    btn.addClass("tinyfeed-generating").prop("disabled", true);
    btn.find(".tinyfeed-generate-news-label").text("กำลังสร้าง...");
    $("#tinyfeed-news-list").prepend(`<div id="tinyfeed-news-skel">${skeletonCardHtml()}</div>`);

    // ประวัติข่าวล่าสุดกันซ้ำ
    let historyLine = "";
    const hn = parseInt(getSetting("newsHistoryCount"), 10);
    if (Number.isFinite(hn) && hn > 0) {
        const recent = getFeedData().news.slice(0, hn)
            .map((n) => `- ${n.title}`).filter(Boolean);
        if (recent.length) historyLine = `\nหัวข้อข่าวที่มีอยู่แล้ว (ห้ามซ้ำ):\n${recent.join("\n")}\n`;
    }

    const extra = String(getSetting("newsExtraPrompt") || "").trim();
    const extraLine = extra ? ` คำสั่งเพิ่มเติมจากผู้ใช้: ${extra}.` : "";

    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนข่าว/บทความสั้น 1 ชิ้นที่จะปรากฏบนหน้าข่าวสาร ` +
        `สะท้อนสถานการณ์บ้านเมืองหรือเหตุการณ์รอบข้างในโลกของเนื้อเรื่อง เสริมบรรยากาศ worldbuilding ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้.` + extraLine + historyLine + crossAppContext("news") +
        `\nตอบตามรูปแบบนี้เท่านั้น:\n` +
        `SOURCE: <ชื่อสำนักข่าว>\nTITLE: <หัวข้อข่าว>\nSUMMARY: <สรุปสั้น 1-2 ประโยค>\nBODY: <เนื้อหาเต็ม หลายย่อหน้าได้>`;

    try {
        const raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("newsTokens"), 10) || 500));
        const parsed = parseGeneratedNews(raw);
        if (!parsed.title && !parsed.body) {
            if (!opts.silent) toastr.warning("AI ไม่ได้ส่งข่าวกลับมา ลองใหม่นะ", "TinyFeed");
            return;
        }
        const news = {
            id: "news" + Date.now(),
            source: escapeText(parsed.source),
            ts: Date.now(),
            title: escapeText(parsed.title),
            summary: escapeText(parsed.summary),
            body: escapeText(parsed.body),
            isAI: true,
        };
        getFeedData().news.unshift(news);
        saveFeedData();
        renderNews();
        if (opts.notify) showNotif(makeAnonAvatar(news.source), news.source, news.title, "news");
        console.log(`[${extensionName}] news added:`, news.id);
    } catch (e) {
        console.error(`[${extensionName}] generate news failed:`, e);
        if (!opts.silent) toastr.error("สร้างข่าวไม่สำเร็จ ลองใหม่นะ", "TinyFeed");
    } finally {
        $("#tinyfeed-news-skel").remove();
        isGeneratingNews = false;
        btn.removeClass("tinyfeed-generating").prop("disabled", false);
        btn.find(".tinyfeed-generate-news-label").text("สร้างข่าวใหม่");
    }
}

// ลบข่าวที่ AI สร้าง
function deleteNews(newsId) {
    const data = getFeedData();
    const news = data.news.find((n) => n.id === newsId);
    if (!news || !news.isAI) return;
    if (!confirm("ต้องการลบข่าวนี้ใช่ไหม?")) return;
    data.news = data.news.filter((n) => n.id !== newsId);
    saveFeedData();
    renderNews();
    console.log(`[${extensionName}] news deleted:`, newsId);
}

// ===== Stage 7: auto-generate เมื่อมีเหตุการณ์ในแชท =====
// ให้ตัวละครหลักส่งข้อความหาผู้ใช้เองในแอปแชต (thread "main") โดยอ้างอิงเนื้อเรื่องล่าสุด
async function generateAutoConnectMessage() {
    const char = getCurrentCharacter();
    if (!char) return;
    const name = char.name;
    const you = getUserName();
    const recent = getThread("main").slice(-8)
        .map((m) => `${m.from === "user" ? you : name}: ${htmlToPlain(m.text)}`).join("\n");
    const extra = String(getSetting("connectExtraPrompt") || "").trim();
    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ${name} หยิบโทรศัพท์ขึ้นมาส่งข้อความหา ${you} เองในแอปแชตส่วนตัว (คล้ายไลน์) ` +
        `เพื่อทักหรือพูดถึงสิ่งที่เพิ่งเกิดขึ้นระหว่าง ${name} กับ ${you} ในเนื้อเรื่องตอนนี้. ` +
        `เขียนในบทบาทของ ${name} แบบเป็นธรรมชาติ สั้นกระชับเหมือนแชตจริง (1-3 ประโยค) ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดหรือกระทำแทน ${you}.\n` +
        (extra ? `คำสั่งเพิ่มเติม: ${extra}.\n` : "") +
        crossAppContext("connect") +
        (recent ? `บทแชตล่าสุดในแอปแชต:\n${recent}\n` : "") +
        `ตอบเฉพาะข้อความของ ${name} เท่านั้น ไม่ต้องใส่ชื่อนำหน้า`;
    let raw;
    try {
        raw = await tinyGenerate(q, Math.max(1, parseInt(getSetting("connectTokens"), 10) || 200));
    } catch (e) {
        console.error(`[${extensionName}] auto connect message failed:`, e);
        return;
    }
    let reply = stripReasoning(raw).trim();
    // ดึงเฉพาะเนื้อในถ้าโมเดลห่อด้วย [... Message: ข้อความ] (เหมือน generateConnectReply)
    const wrapped = [...reply.matchAll(/\[[^\]]*?Message:\s*([^\]]+)\]/gi)];
    if (wrapped.length) reply = wrapped.map((m) => m[1].trim()).join("\n");
    reply = reply.replace(/^\[|\]$/g, "").trim();
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    reply = reply.replace(new RegExp(`^${esc}\\s*[:：]\\s*`, "i"), "").trim();
    if (!reply) return;   // ได้ค่าว่าง = ข้ามเงียบๆ (อัตโนมัติ ไม่รบกวนด้วย toast)
    getThread("main").push({ from: "contact", text: escapeHtml(reply), ts: Date.now() });
    saveFeedData();
    // แจ้งเตือนสไตล์โทรศัพท์ → กดแล้วเปิดแชตกับตัวละคร
    showConnectNotif(makeAvatar({ isMain: true, author: name }), name, htmlToPlain(reply), "main", name);
    // อัปเดต UI ถ้าเปิดแอปแชตอยู่
    if (currentApp === "connect") {
        if (activeThread === "main") renderThread();
        else if (!activeThread) renderConnectList();
    }
    updateChatInjection();
    console.log(`[${extensionName}] auto connect message from`, name);
}

let autoMsgCount = 0;    // ตัวนับข้อความสำหรับโพสต์ (รีเซ็ตเมื่อสลับแชท)
let autoNewsCount = 0;   // ตัวนับข้อความสำหรับข่าว
let autoConnectCount = 0; // ตัวนับข้อความสำหรับให้ตัวละครทักมาเองในแชต
let isAutoBusy = false;  // กันลำดับ auto ซ้อนกัน

// ถาม AI แบบเงียบว่าควรมีโพสต์ใหม่ตอนนี้ไหม (โหมด ai)
async function aiDecidesToPost() {
    try {
        const ctx = getContext();
        const q =
            `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง ไม่ต้องสวมบทบาท] ` +
            `พิจารณาสถานการณ์ล่าสุดในเนื้อเรื่อง: ถ้ามีเหตุการณ์ อารมณ์ ความรู้สึก หรือประเด็นที่ตัวละครหรือ NPC ` +
            `น่าจะอยากแชร์ลงโซเชียลมีเดีย ให้ตอบว่า YES ` +
            `ถ้าตอนนี้ยังเงียบหรือไม่มีอะไรน่าโพสต์ ให้ตอบว่า NO ` +
            `ตอบเป็นคำเดียวเท่านั้น: YES หรือ NO`;
        const res = await tinyGenerate(q, 120);
        const s = stripReasoning(res).toLowerCase();
        // เช็ค "ไม่" ก่อน (กันคำว่า no/ไม่ควร/ไม่โพสต์) แล้วค่อยเช็คฝั่งบวก
        if (/\bno\b/.test(s) || s.includes("ไม่")) return false;
        if (/\byes\b/.test(s) || s.includes("ควร") || s.includes("ใช่")) return true;
        return false;
    } catch (e) {
        console.error(`[${extensionName}] aiDecidesToPost failed:`, e);
        return false;
    }
}

// เรียกทุกครั้งที่มีข้อความใหม่ในแชท (ผู้ใช้ส่ง/AI ตอบ)
async function onChatMessage() {
    if (isAutoBusy || isGenerating || isGeneratingNews) return;
    if (!getCurrentCharacter()) return;

    const feedOn = getSetting("autoGenerate");
    const newsOn = getSetting("newsAutoGenerate");
    const connectOn = getSetting("connectAutoMessage");
    if (feedOn) autoMsgCount++;
    if (newsOn) autoNewsCount++;
    if (connectOn) autoConnectCount++;

    // โพสต์ฟีดก่อน (ถ้าถึงรอบ) — ข่าว/แชตรอรอบถัดไป กัน generate ซ้อนในทีเดียว
    const feedInterval = Math.max(1, parseInt(getSetting("autoGenerateInterval"), 10) || 10);
    if (feedOn && autoMsgCount >= feedInterval) {
        autoMsgCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("autoGenerateMode") || "interval") === "ai") {
                if (!(await aiDecidesToPost())) return;
            }
            await generateFeedPost({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
        return;
    }

    // ตัวละครทักมาเองในแชต (ถ้าถึงรอบ)
    const connectInterval = Math.max(1, parseInt(getSetting("connectAutoInterval"), 10) || 8);
    if (connectOn && autoConnectCount >= connectInterval) {
        autoConnectCount = 0;
        isAutoBusy = true;
        try {
            await generateAutoConnectMessage();
        } finally { isAutoBusy = false; }
        return;
    }

    // ข่าว
    const newsInterval = Math.max(1, parseInt(getSetting("newsAutoInterval"), 10) || 20);
    if (newsOn && autoNewsCount >= newsInterval) {
        autoNewsCount = 0;
        isAutoBusy = true;
        try {
            if ((getSetting("newsAutoMode") || "interval") === "ai") {
                if (!(await aiDecidesToPost())) return;
            }
            await generateNews({ notify: true, silent: true });
        } finally { isAutoBusy = false; }
    }
}

// ===== แจ้งเตือนสไตล์โทรศัพท์ (push banner) =====
let notifTimer = null;
let notifTab = "feed";   // กดแจ้งเตือนแล้วไปแท็บไหน (ในแอป feed)
let notifApp = "feed";   // กดแจ้งเตือนแล้วเปิดแอปไหน ("feed" | "connect")
let notifThreadKey = null; // ถ้าเป็น connect เปิด thread ไหน
let notifThreadName = "";  // ชื่อ contact ของ thread นั้น

// จำนวนแจ้งเตือนที่ยังไม่ได้ดู
let unreadCount = 0;

// เพิ่มจุดแดง + สั่นปุ่มเมนู เมื่อมีของใหม่
function markUnread() {
    unreadCount++;
    const badge = $("#tinyfeed-menu-badge");
    badge.text(unreadCount > 99 ? "99+" : unreadCount).removeClass("tinyfeed-hidden");
    const btn = $("#tinyfeed-menu-button");
    btn.removeClass("tinyfeed-shake");
    // reflow เพื่อรีสตาร์ท animation
    void btn[0]?.offsetWidth;
    btn.addClass("tinyfeed-shake");
    setTimeout(() => btn.removeClass("tinyfeed-shake"), 700);
}

// เคลียร์จุดแดงเมื่อเปิดดูแล้ว
function clearUnread() {
    unreadCount = 0;
    $("#tinyfeed-menu-badge").text("").addClass("tinyfeed-hidden");
}

// แสดงแบนเนอร์แจ้งเตือน (แกนกลาง — ใช้ร่วมทุกแอป)
function displayNotifBanner(avatarHtml, author, text) {
    if (!getSetting("notificationsEnabled")) return;   // ปิดแจ้งเตือน = ไม่ทำอะไร
    markUnread();
    const notif = $("#tinyfeed-notif");
    notif.find(".tinyfeed-notif-avatar").html(avatarHtml);
    notif.find(".tinyfeed-notif-author").text(author || "");
    notif.find(".tinyfeed-notif-text").text(String(text || "").slice(0, 90));
    notif.addClass("tinyfeed-notif-show");
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* ไม่รองรับก็ข้าม */ }
    clearTimeout(notifTimer);
    notifTimer = setTimeout(dismissNotif, 8000);
}

// แจ้งเตือนจากแอป Feed (โพสต์/ข่าว) — กดแล้วเปิดแอป Feed ไปที่แท็บที่เกี่ยว
function showNotif(avatarHtml, author, text, tab) {
    notifApp = "feed";
    notifTab = tab || "feed";
    notifThreadKey = null;
    displayNotifBanner(avatarHtml, author, text);
}

// แจ้งเตือนจากแอปแชต (TinyConnect) — กดแล้วเปิดแชต thread นั้น
function showConnectNotif(avatarHtml, author, text, threadKey, threadName) {
    notifApp = "connect";
    notifThreadKey = threadKey || "main";
    notifThreadName = threadName || author || "";
    displayNotifBanner(avatarHtml, author, text);
}

function showPushNotification(post) {
    showNotif(makeAvatar(post), post.author, htmlToPlain(post.text), "feed");
}

function dismissNotif() {
    $("#tinyfeed-notif").removeClass("tinyfeed-notif-show");
}

// กดแจ้งเตือน → เปิดแอปที่เกี่ยวข้อง (Feed แท็บที่ตรง หรือ TinyConnect thread ที่ตรง)
function openFeedFromNotif() {
    dismissNotif();
    openPhone();          // เปิดเครื่อง (ไปหน้าโฮมก่อน)
    if (notifApp === "connect") {
        openApp("connect");
        openThread(notifThreadKey || "main", notifThreadName || "");
    } else {
        openApp("feed");      // เข้าแอป Feed
        switchTab(notifTab);
    }
}

// ขยายช่องเขียนโพสต์ (ช่องเดิมโตขึ้น + โชว์ปุ่ม)
function openCompose() {
    $("#tinyfeed-compose").addClass("tinyfeed-compose-open");
    $("#tinyfeed-compose .tinyfeed-compose-actions").removeClass("tinyfeed-hidden");
}

// ยุบช่องกลับเป็นแถบเดียว
function closeCompose() {
    const input = $("#tinyfeed-compose-input");
    input.val("").css("height", "");   // เคลียร์ค่าและความสูง inline (กลับไปใช้ความสูงจาก CSS)
    $("#tinyfeed-compose-post").prop("disabled", true);
    $("#tinyfeed-compose .tinyfeed-compose-actions").addClass("tinyfeed-hidden");
    $("#tinyfeed-compose").removeClass("tinyfeed-compose-open");
    input.trigger("blur");
}

// ปรับความสูง textarea ตามเนื้อหา
function autoGrowCompose(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

// เปิดหน้าบทความข่าวเต็ม
function openNewsDetail(newsId) {
    const news = getFeedData().news.find((n) => n.id === newsId);
    if (!news) return;
    const bodyHtml = news.body.split("\n\n").map((p) => `<p>${renderRich(p)}</p>`).join("");
    const html = `
        <div class="tinyfeed-article">
            <div class="tinyfeed-news-head">
                <span class="tinyfeed-news-source">${news.source}</span>
                <span class="tinyfeed-news-time">${displayTime(news)}</span>
            </div>
            <h2 class="tinyfeed-article-title">${news.title}</h2>
            <div class="tinyfeed-article-body">${bodyHtml}</div>
        </div>
    `;
    showDetail(html);
}

function showDetail(html) {
    $("#tinyfeed-detail").html(html);
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $("#tinyfeed-detail").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
}

function closeDetail() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(activeTab);
}

// ===== จัดกลุ่มหน้า settings: ตั้งค่าเครื่อง vs ตั้งค่าแอป =====
const SETTINGS_LAYOUT = [
    {
        head: "⚙️ ตั้งค่าเครื่อง",
        titles: ["การแจ้งเตือน", "โมเดล / API", "คำสั่งระบบ / Jailbreak", "วอลเปเปอร์", "รูปโปรไฟล์", "NPC ประจำ (แชทนี้)", "แทรกฟีดเข้าประวัติแชท"],
    },
    {
        head: "📱 TinyFeed",
        titles: ["โพสต์จากตัวละคร (AI)", "สร้างโพสต์อัตโนมัติ", "คอมเมนต์", "ข่าวสาร"],
    },
    { head: "💬 TinyConnect", titles: ["TinyConnect (แชต)"] },
    { head: "🎥 TinyStream", titles: ["TinyStream (ไลฟ์สตรีม)"] },
];

// เรียงกลุ่ม settings ใหม่ + ใส่หัวข้อใหญ่คั่น (ทำครั้งเดียว)
function organizeSettings() {
    const screen = $("#tinyfeed-settings-screen");
    if (!screen.length || screen.attr("data-organized")) return;
    const groups = {};
    screen.find(".tinyfeed-settings-group").each(function () {
        const t = $(this).find(".tinyfeed-settings-title").first().text().trim();
        if (t) groups[t] = this;
    });
    const frag = document.createDocumentFragment();
    for (const sec of SETTINGS_LAYOUT) {
        const picked = sec.titles.map((t) => groups[t]).filter(Boolean);
        if (!picked.length) continue;
        const h = document.createElement("div");
        h.className = "tinyfeed-settings-cat";
        h.textContent = sec.head;
        frag.appendChild(h);
        picked.forEach((el) => frag.appendChild(el));
        sec.titles.forEach((t) => delete groups[t]);
    }
    // กลุ่มที่ไม่ได้ระบุใน layout ต่อท้ายไว้ (กันตกหล่น)
    Object.values(groups).forEach((el) => frag.appendChild(el));
    screen.empty().append(frag);
    screen.attr("data-organized", "1");
}

// ===== Stage 5: หน้า settings ในโทรศัพท์ =====
function isSettingsOpen() {
    return !$("#tinyfeed-settings-screen").hasClass("tinyfeed-hidden");
}

// เติมค่าปัจจุบันลงในฟอร์ม settings
function populateSettings() {
    $("#tinyfeed-cfg-wallpaper").val(getSetting("wallpaperUrl") || "");
    $("#tinyfeed-cfg-user-avatar").val(getSetting("userAvatarUrl") || "");

    const char = getCurrentCharacter();
    const charInput = $("#tinyfeed-cfg-char-avatar");
    if (char) {
        const map = getSetting("charAvatarUrls") || {};
        $("#tinyfeed-cfg-char-name").text(char.name || "ตัวละคร");
        charInput.prop("disabled", false).val(map[char.file] || "");
    } else {
        $("#tinyfeed-cfg-char-name").text("(ไม่มีตัวละครในแชทนี้)");
        charInput.prop("disabled", true).val("");
    }

    $("#tinyfeed-cfg-likes-min").val(getSetting("likesMin"));
    $("#tinyfeed-cfg-likes-max").val(getSetting("likesMax"));
    $("#tinyfeed-cfg-history").val(getSetting("historyCount"));
    renderNpcList();

    $("#tinyfeed-cfg-auto").prop("checked", Boolean(getSetting("autoGenerate")));
    $("#tinyfeed-cfg-auto-mode").val(getSetting("autoGenerateMode") || "interval");
    $("#tinyfeed-cfg-interval").val(getSetting("autoGenerateInterval") || 10);
    $("#tinyfeed-cfg-comment-mode").val(getSetting("commentReplyMode") || "instant");
    $("#tinyfeed-cfg-initcomment-mode").val(getSetting("initialCommentMode") || "none");
    $("#tinyfeed-cfg-initcomment-count").val(getSetting("initialCommentCount") || 2);

    $("#tinyfeed-cfg-news-auto").prop("checked", Boolean(getSetting("newsAutoGenerate")));
    $("#tinyfeed-cfg-news-mode").val(getSetting("newsAutoMode") || "interval");
    $("#tinyfeed-cfg-news-interval").val(getSetting("newsAutoInterval") || 20);
    $("#tinyfeed-cfg-news-history").val(getSetting("newsHistoryCount"));
    $("#tinyfeed-cfg-notif").prop("checked", Boolean(getSetting("notificationsEnabled")));

    $("#tinyfeed-cfg-stream-streamer").val(getSetting("streamStreamer") || "char");
    $("#tinyfeed-cfg-stream-mode").val(getSetting("streamCommentMode") || "manual");
    $("#tinyfeed-cfg-stream-interval").val(getSetting("streamAutoInterval"));
    $("#tinyfeed-cfg-stream-tokens").val(getSetting("streamTokens"));
    $("#tinyfeed-cfg-stream-extra").val(getSetting("streamExtraPrompt"));
    $("#tinyfeed-cfg-connect-tokens").val(getSetting("connectTokens"));
    $("#tinyfeed-cfg-connect-extra").val(getSetting("connectExtraPrompt"));
    $("#tinyfeed-cfg-connect-auto").prop("checked", Boolean(getSetting("connectAutoMessage")));
    $("#tinyfeed-cfg-connect-interval").val(getSetting("connectAutoInterval") || 8);

    populateApiProfiles();
    $("#tinyfeed-cfg-api-context").val(getSetting("apiContextMessages"));
    $("#tinyfeed-cfg-wi-limit").val(getSetting("worldInfoLimit"));
    $("#tinyfeed-cfg-jailbreak").val(getSetting("jailbreakPrompt"));

    $("#tinyfeed-cfg-post-tokens").val(getSetting("postTokens"));
    $("#tinyfeed-cfg-post-extra").val(getSetting("postExtraPrompt"));
    $("#tinyfeed-cfg-news-tokens").val(getSetting("newsTokens"));
    $("#tinyfeed-cfg-news-extra").val(getSetting("newsExtraPrompt"));
    $("#tinyfeed-cfg-inject-mode").val(getSetting("injectMode") || "off");
    $("#tinyfeed-cfg-inject-count").val(getSetting("injectCount"));
    $("#tinyfeed-cfg-inject-depth").val(getSetting("injectDepth"));
    $("#tinyfeed-cfg-inject-connect").prop("checked", Boolean(getSetting("injectConnect")));
    $("#tinyfeed-cfg-inject-stream").prop("checked", Boolean(getSetting("injectStream")));
    $("#tinyfeed-cfg-crossapp").prop("checked", Boolean(getSetting("crossAppEnabled")));
    $("#tinyfeed-cfg-crossapp-count").val(getSetting("crossAppCount"));
}

// เติมรายชื่อ connection profile ลง dropdown (จาก Connection Manager ของ ST)
function populateApiProfiles() {
    const sel = $("#tinyfeed-cfg-api-profile");
    let profiles = [];
    try {
        profiles = (getContext().extensionSettings.connectionManager.profiles) || [];
    } catch (e) { /* Connection Manager ไม่พร้อม */ }
    let html = `<option value="">ใช้ API หลักของ SillyTavern</option>`;
    for (const p of profiles) {
        if (!p || !p.id) continue;
        html += `<option value="${escapeAttr(p.id)}">${escapeText(p.name || p.id)}</option>`;
    }
    sel.html(html).val(getSetting("apiProfile") || "");
}

let settingsReturn = "feed";   // แอปที่จะกลับไปหลังปิด settings

function openSettings() {
    populateSettings();
    settingsReturn = currentApp === "settings" ? settingsReturn : currentApp;   // จำแอปเดิม
    // settings-screen อยู่ใน app-feed → ต้องโชว์ app-feed เป็น host แต่ซ่อนเนื้อฟีด
    $("#tinyfeed-home").addClass("tinyfeed-hidden");
    $(".tinyfeed-app").addClass("tinyfeed-hidden");
    $("#tinyfeed-app-feed").removeClass("tinyfeed-hidden");
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-home-btn, #tinyfeed-settings-btn").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
    $(".tinyfeed-title").text("ตั้งค่า");
    currentApp = "settings";
}

function closeSettings() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    if (settingsReturn === "home" || !settingsReturn) goHome();
    else openApp(settingsReturn);   // feed / connect / stream
}

// ปุ่มย้อนกลับใช้ร่วมกัน (settings หรือ detail)
function handleBack() {
    if (currentApp === "connect" && isConnectThreadOpen()) {
        openConnectList();   // จากห้องแชต → กลับรายชื่อ
    } else if (isSettingsOpen()) {
        closeSettings();
    } else {
        closeDetail();
    }
}

jQuery(async () => {
    console.log(`[${extensionName}] Loading...`);

    try {
        // โหลดโมดูล core เผื่อดึง user_avatar (ห่อ try/catch กันพังถ้า path/เวอร์ชันไม่ตรง)
        try {
            stScriptModule = await import("../../../../script.js");
        } catch (e) {
            console.warn(`[${extensionName}] import script.js failed (ใช้ fallback แทน):`, e);
        }

        // โหลด panel โทรศัพท์ แปะไว้ที่ body
        const phoneHtml = await $.get(`${extensionFolderPath}/phone.html`);
        $("body").append(phoneHtml);
        organizeSettings();   // จัดกลุ่มหน้า settings ให้เป็นสัดส่วน

        // โหลด drawer ตั้งค่าไปที่แผง extensions ด้านขวา
        const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
        $("#extensions_settings2").append(settingsHtml);

        // สร้างปุ่มในเมนู extensions
        const menuButton = $(`
            <div id="tinyfeed-menu-button" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-solid fa-mobile-screen-button extensionsMenuExtensionButton"></div>
                <span>TinyFeed</span>
                <span id="tinyfeed-menu-badge" class="tinyfeed-menu-badge tinyfeed-hidden"></span>
            </div>
        `);
        $("#extensionsMenu").append(menuButton);

        // โหลดฟีดใหม่เมื่อสลับแชท
        const context = getContext();
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, () => {
            autoMsgCount = 0;   // เริ่มนับใหม่ตามแชทที่เปิด
            autoNewsCount = 0;
            autoConnectCount = 0;
            renderFeed();
            renderNews();
            if (isSettingsOpen()) populateSettings();   // อัปเดตชื่อ/ลิงก์รูปตัวละครตามแชทใหม่
            if (currentApp === "connect") openConnectList();   // contact/แชตเปลี่ยนตามแชท
            if (currentApp === "stream") { clearStreamTimer(); renderStream(); maybeStartStreamTimer(); }
            console.log(`[${extensionName}] Chat changed, feed reloaded`);
        });

        // Stage 7: นับข้อความในแชทเพื่อ auto-generate
        context.eventSource.on(context.eventTypes.MESSAGE_SENT, onChatMessage);
        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, onChatMessage);

        // ผูก event
        menuButton.on("click", openPhone);
        $("#tinyfeed-enabled").on("input", onEnabledChange);
        $(document).on("click", "#tinyfeed-close", closePhone);
        $(document).on("click", "#tinyfeed-theme", toggleTheme);
        $(document).on("click", "#tinyfeed-overlay", function (e) {
            if (e.target.id === "tinyfeed-overlay") closePhone();
        });

        // App Shell: ปุ่ม home + ไอคอนแอปบนหน้าโฮม
        $(document).on("click", "#tinyfeed-home-btn", goHome);
        $(document).on("click", ".tinyfeed-app-icon", function () {
            openApp($(this).data("app"));
        });

        // TinyConnect: เข้าห้องแชต + ส่งข้อความ
        $(document).on("click", ".tinyfeed-connect-contact", function () {
            openThread($(this).data("key"), $(this).data("name"));
        });
        // แชตกลุ่ม
        $(document).on("click", "#tinyfeed-connect-newgroup", function () {
            toggleGroupForm($("#tinyfeed-connect-groupform").hasClass("tinyfeed-hidden"));
        });
        $(document).on("click", "#tinyfeed-group-cancel", function () { toggleGroupForm(false); });
        $(document).on("click", "#tinyfeed-group-create", createGroup);
        $(document).on("click", ".tinyfeed-group-del", function (e) {
            e.stopPropagation();
            deleteGroup($(this).data("key"));
        });
        $(document).on("click", "#tinyfeed-connect-send", function () {
            sendConnectMessage($("#tinyfeed-connect-input").val());
        });
        $(document).on("keydown", "#tinyfeed-connect-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendConnectMessage($(this).val());
            }
        });

        // TinyStream: เริ่ม/จบไลฟ์ + โหลดคอมเมนต์ + ส่งคอมเมนต์
        $(document).on("click", "#tinyfeed-stream-toggle", toggleStream);
        $(document).on("click", "#tinyfeed-stream-loadcomments", function () {
            loadLiveComments();
        });
        $(document).on("click", "#tinyfeed-stream-send", function () {
            sendStreamComment($("#tinyfeed-stream-input").val());
        });
        $(document).on("keydown", "#tinyfeed-stream-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                sendStreamComment($(this).val());
            }
        });

        // Stage 2: render mock + ผูกแท็บ
        renderFeed();
        renderNews();
        $(document).on("click", ".tinyfeed-tab", function () {
            switchTab($(this).data("tab"));
        });

        // Stage 2.5: กดโพสต์/ข่าวเข้าหน้ารายละเอียด
        $(document).on("click", ".tinyfeed-post:not(.tinyfeed-post-detail)", function () {
            openPostDetail($(this).data("post"));
        });
        $(document).on("click", ".tinyfeed-news", function () {
            openNewsDetail($(this).data("news"));
        });
        // Stage 9: สร้าง/ลบข่าว
        $(document).on("click", "#tinyfeed-generate-news", function () {
            generateNews();
        });
        $(document).on("click", ".tinyfeed-news-delete", function (e) {
            e.stopPropagation();
            deleteNews($(this).data("news"));
        });
        $(document).on("click", "#tinyfeed-back", handleBack);

        // Stage 4: ปุ่มไลค์/แชร์
        $(document).on("click", ".tinyfeed-like", function (e) {
            e.stopPropagation();
            toggleLike($(this).data("post"));
        });
        $(document).on("click", ".tinyfeed-share", function (e) {
            e.stopPropagation();
            toggleShare($(this).data("post"));
        });
        // กันปุ่มคอมเมนต์เด้งเข้า detail ไปก่อน (ค่อยทำจริงตอนคอมเมนต์)
        $(document).on("click", ".tinyfeed-comment-btn", function (e) {
            e.stopPropagation();
            openPostDetail($(this).data("post"));
        });

        // Stage 4b: ผู้ใช้โพสต์เอง + ลบโพสต์
        $(document).on("focus", "#tinyfeed-compose-input", openCompose);
        $(document).on("click", "#tinyfeed-compose-cancel", closeCompose);
        $(document).on("input", "#tinyfeed-compose-input", function () {
            autoGrowCompose(this);
            const empty = $(this).val().trim().length === 0;
            $("#tinyfeed-compose-post").prop("disabled", empty);
        });
        $(document).on("click", "#tinyfeed-compose-post", function () {
            addUserPost($("#tinyfeed-compose-input").val());
            closeCompose();
        });
        $(document).on("click", ".tinyfeed-delete", function (e) {
            e.stopPropagation();
            deleteUserPost($(this).data("post"));
        });

        // Stage 6: ปุ่มให้ AI สร้างโพสต์
        $(document).on("click", "#tinyfeed-generate", function () {
            generateFeedPost();   // ปุ่ม manual: ไม่แจ้งเตือน (ผู้ใช้ดูอยู่แล้ว)
        });
        // กดแจ้งเตือน → เปิดฟีด
        $(document).on("click", "#tinyfeed-notif", openFeedFromNotif);

        // Stage 8: คอมเมนต์
        $(document).on("click", ".tinyfeed-comment-send", function () {
            const input = $(this).closest(".tinyfeed-comment-compose").find(".tinyfeed-comment-input");
            addComment($(this).data("post"), input.val());
        });
        $(document).on("keydown", ".tinyfeed-comment-input", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                addComment($(this).data("post"), $(this).val());
            }
        });
        $(document).on("click", ".tinyfeed-ai-reply", function () {
            generateCommentReply($(this).data("post"));
        });

        // Stage 5: หน้า settings ในโทรศัพท์
        $(document).on("click", "#tinyfeed-settings-btn", openSettings);
        // วอลเปเปอร์หน้าโฮม
        $(document).on("input", "#tinyfeed-cfg-wallpaper", function () {
            setSetting("wallpaperUrl", $(this).val().trim());
            applyWallpaper();
        });
        // ลิงก์รูปผู้ใช้ (override) — พิมพ์แล้วอัปเดตฟีดทันที
        $(document).on("input", "#tinyfeed-cfg-user-avatar", function () {
            setSetting("userAvatarUrl", $(this).val().trim());
            renderFeed();
        });
        // ลิงก์รูปตัวละคร (override รายตัว keyed by ไฟล์ avatar)
        $(document).on("input", "#tinyfeed-cfg-char-avatar", function () {
            const char = getCurrentCharacter();
            if (!char) return;
            const map = Object.assign({}, getSetting("charAvatarUrls"));
            const val = $(this).val().trim();
            if (val) map[char.file] = val; else delete map[char.file];
            setSetting("charAvatarUrls", map);
            renderFeed();
        });
        // ช่วงไลค์เริ่มต้นของโพสต์ AI (clamp ให้ >=0 และ max>=min)
        $(document).on("input", "#tinyfeed-cfg-likes-min", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("likesMin", v);
            if (getSetting("likesMax") < v) setSetting("likesMax", v);
        });
        $(document).on("input", "#tinyfeed-cfg-likes-max", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("likesMax", v);
        });
        // 6.6: จำนวนโพสต์ล่าสุดที่ให้ AI จำ
        $(document).on("input", "#tinyfeed-cfg-history", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("historyCount", v);
        });

        // 6.5: รายชื่อ NPC ประจำ (ผูกกับแชท)
        $(document).on("click", "#tinyfeed-npc-add", function () {
            getNpcs().push({ name: "", avatar: "" });
            saveFeedData();
            renderNpcList();
        });
        $(document).on("input", ".tinyfeed-npc-name", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].name = $(this).val(); saveFeedData(); renderFeed(); }
        });
        $(document).on("input", ".tinyfeed-npc-avatar", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs[i].avatar = $(this).val().trim(); saveFeedData(); renderFeed(); }
        });
        $(document).on("click", ".tinyfeed-npc-del", function () {
            const i = $(this).closest(".tinyfeed-npc-row").data("index");
            const npcs = getNpcs();
            if (npcs[i]) { npcs.splice(i, 1); saveFeedData(); renderNpcList(); renderFeed(); }
        });

        // ตั้งค่าล่วงหน้าฟีเจอร์อนาคต (เก็บค่าไว้ก่อน)
        $(document).on("change", "#tinyfeed-cfg-auto", function () {
            setSetting("autoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-auto-mode", function () {
            setSetting("autoGenerateMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-interval", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("autoGenerateInterval", Number.isFinite(n) && n > 0 ? n : 10);
        });
        $(document).on("change", "#tinyfeed-cfg-comment-mode", function () {
            setSetting("commentReplyMode", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-initcomment-mode", function () {
            setSetting("initialCommentMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-initcomment-count", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            setSetting("initialCommentCount", v);
        });
        // Stage 9: config ข่าว
        $(document).on("change", "#tinyfeed-cfg-news-auto", function () {
            setSetting("newsAutoGenerate", $(this).prop("checked"));
        });
        $(document).on("change", "#tinyfeed-cfg-news-mode", function () {
            setSetting("newsAutoMode", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-news-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("newsAutoInterval", Number.isFinite(v) && v > 0 ? v : 20);
        });
        $(document).on("input", "#tinyfeed-cfg-news-history", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("newsHistoryCount", v);
        });
        // Stage 10: toggle แจ้งเตือน
        $(document).on("change", "#tinyfeed-cfg-notif", function () {
            const on = $(this).prop("checked");
            setSetting("notificationsEnabled", on);
            if (!on) clearUnread();   // ปิดแล้วเก็บจุดแดงที่ค้างด้วย
        });
        // Phase 2: เลือกโมเดล/API
        $(document).on("change", "#tinyfeed-cfg-api-profile", function () {
            setSetting("apiProfile", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-api-context", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("apiContextMessages", v);
        });
        $(document).on("input", "#tinyfeed-cfg-wi-limit", function () {
            let v = parseInt($(this).val(), 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            setSetting("worldInfoLimit", v);
        });
        $(document).on("input", "#tinyfeed-cfg-jailbreak", function () {
            setSetting("jailbreakPrompt", $(this).val());
        });
        // TinyStream config
        $(document).on("change", "#tinyfeed-cfg-stream-streamer", function () {
            setSetting("streamStreamer", $(this).val());
            if (currentApp === "stream") renderStream();
        });
        $(document).on("change", "#tinyfeed-cfg-stream-mode", function () {
            setSetting("streamCommentMode", $(this).val());
            if (currentApp === "stream") { renderStream(); maybeStartStreamTimer(); }
        });
        $(document).on("input", "#tinyfeed-cfg-stream-interval", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("streamAutoInterval", Number.isFinite(v) && v >= 4 ? v : 12);
            if (currentApp === "stream") maybeStartStreamTimer();
        });
        $(document).on("input", "#tinyfeed-cfg-stream-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("streamTokens", Number.isFinite(v) && v > 0 ? v : 300);
        });
        $(document).on("input", "#tinyfeed-cfg-stream-extra", function () {
            setSetting("streamExtraPrompt", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-connect-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("connectTokens", Number.isFinite(v) && v > 0 ? v : 200);
        });
        $(document).on("input", "#tinyfeed-cfg-connect-extra", function () {
            setSetting("connectExtraPrompt", $(this).val());
        });
        $(document).on("change", "#tinyfeed-cfg-connect-auto", function () {
            setSetting("connectAutoMessage", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-connect-interval", function () {
            const n = parseInt($(this).val(), 10);
            setSetting("connectAutoInterval", Number.isFinite(n) && n > 0 ? n : 8);
        });

        // Phase 2: token + คำสั่งเสริม
        $(document).on("input", "#tinyfeed-cfg-post-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("postTokens", Number.isFinite(v) && v > 0 ? v : 400);
        });
        $(document).on("input", "#tinyfeed-cfg-post-extra", function () {
            setSetting("postExtraPrompt", $(this).val());
        });
        $(document).on("input", "#tinyfeed-cfg-news-tokens", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("newsTokens", Number.isFinite(v) && v > 0 ? v : 500);
        });
        $(document).on("input", "#tinyfeed-cfg-news-extra", function () {
            setSetting("newsExtraPrompt", $(this).val());
        });
        // Phase 2: แทรกฟีดเข้าประวัติแชท
        $(document).on("change", "#tinyfeed-cfg-inject-mode", function () {
            setSetting("injectMode", $(this).val());
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-connect", function () {
            setSetting("injectConnect", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-inject-stream", function () {
            setSetting("injectStream", $(this).prop("checked"));
            updateChatInjection();
        });
        $(document).on("change", "#tinyfeed-cfg-crossapp", function () {
            setSetting("crossAppEnabled", $(this).prop("checked"));
        });
        $(document).on("input", "#tinyfeed-cfg-crossapp-count", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("crossAppCount", Number.isFinite(v) && v > 0 ? v : 3);
        });
        $(document).on("input", "#tinyfeed-cfg-inject-count", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("injectCount", Number.isFinite(v) && v > 0 ? v : 5);
            updateChatInjection();
        });
        $(document).on("input", "#tinyfeed-cfg-inject-depth", function () {
            let v = parseInt($(this).val(), 10);
            setSetting("injectDepth", Number.isFinite(v) && v >= 0 ? v : 4);
            updateChatInjection();
        });

        // โหลดค่าที่บันทึกไว้
        loadSettings();

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
