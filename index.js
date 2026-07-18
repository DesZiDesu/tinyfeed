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
    console.log(`[${extensionName}] Phone opened`);
}

function closePhone() {
    $("#tinyfeed-overlay").removeClass("tinyfeed-visible");
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
                <span class="tinyfeed-comment-text">${c.text}</span>
            </div>
        </div>
    `).join("");
    const more = (limit && comments.length > limit)
        ? `<div class="tinyfeed-more">ดูคอมเมนต์ทั้งหมด ${comments.length} รายการ</div>`
        : "";
    return `<div class="tinyfeed-comments">${rows}${more}</div>`;
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
            <div class="tinyfeed-post-body">${post.text}</div>
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
            <div class="tinyfeed-news-summary">${news.summary}</div>
        </div>
    `).join("");
    $("#tinyfeed-news-list").html(html);
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
            <div class="tinyfeed-post-body">${post.text}</div>
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

    const quietPrompt =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] ` +
        `เขียนโพสต์โซเชียลมีเดียสั้นๆ 1 โพสต์ (1-3 ประโยค) ที่จะปรากฏบนฟีด ` +
        `สะท้อนอารมณ์หรือสถานการณ์ในเนื้อเรื่องตอนนี้. ` +
        rosterLine +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนหรือกระทำแทนผู้ใช้. ` +
        historyLine +
        `ตอบกลับตามรูปแบบนี้เท่านั้น ห้ามมีข้อความอื่น:\n` +
        `NAME: <ชื่อผู้โพสต์>\nPOST: <ข้อความโพสต์>`;

    try {
        const raw = await ctx.generateQuietPrompt({ quietPrompt, responseLength: 400 });
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
function parseCommentLines(raw, charName) {
    const s = stripReasoning(raw);
    const out = [];
    const re = /COMMENT:\s*(.+)/gi;
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
        const raw = await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: 150 });
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
        const raw = await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: 300 });
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

    const q =
        `[คำสั่งระบบ — ไม่ใช่ส่วนของเนื้อเรื่อง] เขียนข่าว/บทความสั้น 1 ชิ้นที่จะปรากฏบนหน้าข่าวสาร ` +
        `สะท้อนสถานการณ์บ้านเมืองหรือเหตุการณ์รอบข้างในโลกของเนื้อเรื่อง เสริมบรรยากาศ worldbuilding ` +
        `ใช้ภาษาเดียวกับเนื้อเรื่อง ห้ามพูดแทนผู้ใช้.` + historyLine +
        `\nตอบตามรูปแบบนี้เท่านั้น:\n` +
        `SOURCE: <ชื่อสำนักข่าว>\nTITLE: <หัวข้อข่าว>\nSUMMARY: <สรุปสั้น 1-2 ประโยค>\nBODY: <เนื้อหาเต็ม หลายย่อหน้าได้>`;

    try {
        const raw = await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: 500 });
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
let autoMsgCount = 0;    // ตัวนับข้อความสำหรับโพสต์ (รีเซ็ตเมื่อสลับแชท)
let autoNewsCount = 0;   // ตัวนับข้อความสำหรับข่าว
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
        const res = await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: 120 });
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
    if (feedOn) autoMsgCount++;
    if (newsOn) autoNewsCount++;

    // โพสต์ฟีดก่อน (ถ้าถึงรอบ) — ข่าวรอรอบถัดไป กัน generate ซ้อนในทีเดียว
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
let notifTab = "feed";   // กดแจ้งเตือนแล้วไปแท็บไหน

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

// แสดงแบนเนอร์แจ้งเตือน (ใช้ได้ทั้งโพสต์และข่าว)
function showNotif(avatarHtml, author, text, tab) {
    if (!getSetting("notificationsEnabled")) return;   // ปิดแจ้งเตือน = ไม่ทำอะไร
    markUnread();
    notifTab = tab || "feed";
    const notif = $("#tinyfeed-notif");
    notif.find(".tinyfeed-notif-avatar").html(avatarHtml);
    notif.find(".tinyfeed-notif-author").text(author || "");
    notif.find(".tinyfeed-notif-text").text(String(text || "").slice(0, 90));
    notif.addClass("tinyfeed-notif-show");
    try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) { /* ไม่รองรับก็ข้าม */ }
    clearTimeout(notifTimer);
    notifTimer = setTimeout(dismissNotif, 8000);
}

function showPushNotification(post) {
    showNotif(makeAvatar(post), post.author, htmlToPlain(post.text), "feed");
}

function dismissNotif() {
    $("#tinyfeed-notif").removeClass("tinyfeed-notif-show");
}

// กดแจ้งเตือน → เปิด TinyFeed ไปที่แท็บที่เกี่ยวข้อง
function openFeedFromNotif() {
    dismissNotif();
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(notifTab);
    openPhone();
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
    const bodyHtml = news.body.split("\n\n").map((p) => `<p>${p}</p>`).join("");
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
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
}

function closeDetail() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(activeTab);
}

// ===== Stage 5: หน้า settings ในโทรศัพท์ =====
function isSettingsOpen() {
    return !$("#tinyfeed-settings-screen").hasClass("tinyfeed-hidden");
}

// เติมค่าปัจจุบันลงในฟอร์ม settings
function populateSettings() {
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
}

function openSettings() {
    populateSettings();
    $(".tinyfeed-panel").addClass("tinyfeed-hidden");
    $("#tinyfeed-settings-screen").removeClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").addClass("tinyfeed-hidden");
    $("#tinyfeed-back").removeClass("tinyfeed-hidden");
}

function closeSettings() {
    $("#tinyfeed-back").addClass("tinyfeed-hidden");
    $(".tinyfeed-tabs").removeClass("tinyfeed-hidden");
    switchTab(activeTab);
}

// ปุ่มย้อนกลับใช้ร่วมกัน (settings หรือ detail)
function handleBack() {
    if (isSettingsOpen()) {
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
            renderFeed();
            renderNews();
            if (isSettingsOpen()) populateSettings();   // อัปเดตชื่อ/ลิงก์รูปตัวละครตามแชทใหม่
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

        // โหลดค่าที่บันทึกไว้
        loadSettings();

        console.log(`[${extensionName}] ✅ Loaded successfully`);
    } catch (error) {
        console.error(`[${extensionName}] ❌ Failed to load:`, error);
    }
});
