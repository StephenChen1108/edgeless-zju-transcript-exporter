const loadingPanel = document.getElementById("loading-panel");
const successPanel = document.getElementById("success-panel");
const messagePanel = document.getElementById("message-panel");
const messageTitle = document.getElementById("message-title");
const messageDetail = document.getElementById("message-detail");
const preview = document.getElementById("preview");
const primaryAction = document.getElementById("primary-action");
const properties = document.querySelector(".properties");
const dialog = document.getElementById("info-dialog");
const mainView = document.getElementById("main-view");
const settingsView = document.getElementById("settings-view");
const saveStatus = document.getElementById("save-status");
const reloadExtension = document.getElementById("reload-extension");
const DEFAULT_SETTINGS = {
  defaultMode: "current",
  defaultCourseExportFormat: "merged_markdown",
  transcriptLanguage: "original",
  includeTimestamp: true,
  includeFrontMatter: true,
  filenameTemplate: "{课程}_{日期}_{节次}",
  zipContents: { mergedMarkdown: true, splitMarkdown: true, index: true, ppt: false },
  theme: "system"
};
const SETTING_CHOICES = {
  "setting-default-mode": { key: "defaultMode", options: [["current", "当前课次"], ["course", "整门课程"]] },
  "setting-course-format": { key: "defaultCourseExportFormat", options: [["merged_markdown", "单个 Markdown"], ["zip", "课程资料包 ZIP"]] },
  "setting-language": { key: "transcriptLanguage", options: [["original", "原文"], ["translated", "译文"], ["bilingual", "中英双语"]] },
  "setting-filename": { key: "filenameTemplate", options: [["{课程}_{日期}_{节次}", "{课程}_{日期}_{节次}"], ["{课程}_{教师}_{日期}", "{课程}_{教师}_{日期}"], ["{日期}_{课程}_{节次}", "{日期}_{课程}_{节次}"]] },
  "setting-theme": { key: "theme", options: [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] }
};
let settings = { ...DEFAULT_SETTINGS, zipContents: { ...DEFAULT_SETTINGS.zipContents } };
let saveQueue = Promise.resolve();
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const currentContent = document.getElementById("current-content");
const courseContent = document.getElementById("course-content");
const courseList = document.getElementById("course-list");
const courseCount = document.getElementById("course-count");
const courseStatus = document.getElementById("course-status");
const courseAction = document.getElementById("course-action");
let transcript = null;
let pageContext = null;
let currentLoadPromise = null;
let courseLoadPromise = null;
let courseScanPromise = null;
let courseSessions = null;
let mode = "current";
let exportingCourse = false;

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme === "system"
    ? (systemTheme.matches ? "dark" : "light") : settings.theme;
}

function renderSettings() {
  for (const [id, choice] of Object.entries(SETTING_CHOICES)) {
    const button = document.getElementById(id);
    button.querySelector(".setting-select-value").textContent = choice.options.find(([value]) => value === settings[choice.key])?.[1] || "";
  }
  document.getElementById("setting-timestamp").checked = settings.includeTimestamp;
  document.getElementById("setting-frontmatter").checked = settings.includeFrontMatter;
  for (const input of document.querySelectorAll("[data-zip-key]")) input.checked = settings.zipContents[input.dataset.zipKey];
  document.getElementById("filename-preview").textContent = "预览：" + makeFilename("", { course: "国际商法", teacher: "周黎明", date: "2026-09-22", period: "第11-13节" });
}

async function saveSetting(key, value) {
  const previous = settings[key];
  settings[key] = value;
  const operation = saveQueue.then(() => chrome.storage.local.set({ [key]: value }));
  saveQueue = operation.catch(() => {});
  try {
    await operation;
    saveStatus.textContent = "✓ 已保存";
    saveStatus.classList.remove("error");
  } catch (error) {
    if (settings[key] === value) settings[key] = previous;
    renderSettings();
    applyTheme();
    const missingStorage = !chrome.storage?.local;
    saveStatus.textContent = missingStorage ? "扩展存储权限未生效，请重新加载扩展" : "保存失败，请重试";
    saveStatus.classList.add("error");
    reloadExtension.hidden = !missingStorage;
    console.error("无际 Edgeless：保存设置失败", error);
  }
}

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...stored,
      zipContents: { ...DEFAULT_SETTINGS.zipContents, ...(stored.zipContents || {}) } };
    for (const [key, valid] of Object.entries({
      defaultMode: ["current", "course"], defaultCourseExportFormat: ["merged_markdown", "zip"],
      transcriptLanguage: ["original", "translated", "bilingual"],
      filenameTemplate: ["{课程}_{日期}_{节次}", "{课程}_{教师}_{日期}", "{日期}_{课程}_{节次}"],
      theme: ["system", "light", "dark"]
    })) if (!valid.includes(settings[key])) settings[key] = DEFAULT_SETTINGS[key];
    for (const key of ["includeTimestamp", "includeFrontMatter"]) if (typeof settings[key] !== "boolean") settings[key] = DEFAULT_SETTINGS[key];
    settings.zipContents = Object.fromEntries(Object.keys(DEFAULT_SETTINGS.zipContents).map(key => [
      key, typeof settings.zipContents[key] === "boolean" ? settings.zipContents[key] : DEFAULT_SETTINGS.zipContents[key]
    ]));
    if (!Object.values(settings.zipContents).some(Boolean)) settings.zipContents.mergedMarkdown = true;
  } catch (error) {
    if (!chrome.storage?.local) {
      saveStatus.textContent = "扩展存储权限未生效，请重新加载扩展";
      saveStatus.classList.add("error");
      reloadExtension.hidden = false;
    }
    console.error("无际 Edgeless：读取设置失败，使用默认设置", error);
  }
  applyTheme();
  renderSettings();
  document.querySelector(`input[name="course-format"][value="${settings.defaultCourseExportFormat}"]`).checked = true;
}

function isReplayPage(url) {
  try {
    const page = new URL(url);
    return page.protocol === "https:"
      && page.hostname === "interactivemeta.cmc.zju.edu.cn"
      && page.hash.startsWith("#/replay");
  } catch {
    return false;
  }
}

// This function runs in the current page's MAIN world; it cannot use popup variables.
async function extractTranscript() {
  const rawSub = document.querySelector("header .sub")?.textContent.trim() || "";
  const timeParts = rawSub.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*(第\d+(?:[-－~～]\d+)?节)$/);
  const metadata = {
    course: document.querySelector("header .title")?.textContent.trim() || "",
    teacher: document.querySelector("header .name")?.textContent.trim() || "",
    time: timeParts ? timeParts[1] + " · " + timeParts[2] : rawSub,
    date: timeParts?.[1] || "",
    period: timeParts?.[2] || ""
  };
  const pageUrl = new URL(location.href);
  const hashQuery = pageUrl.hash.includes("?") ? pageUrl.hash.slice(pageUrl.hash.indexOf("?") + 1) : "";
  const hashParams = new URLSearchParams(hashQuery);
  const resources = performance.getEntriesByType("resource").map(entry => entry.name);
  const findId = key => {
    const direct = pageUrl.searchParams.get(key) || hashParams.get(key);
    if (direct) return direct;
    for (const resource of resources) {
      try {
        const value = new URL(resource).searchParams.get(key);
        if (value) return value;
      } catch { /* Ignore malformed resource URLs. */ }
    }
    return "";
  };
  const context = {
    metadata,
    courseId: findId("course_id"),
    subId: findId("sub_id"),
    courseType: pageUrl.searchParams.get("course_type") || hashParams.get("course_type") || "multi"
  };
  const urls = resources.filter(url => url.includes("search-trans-result"));

  if (urls.length === 0) {
    return { success: false, error: "TRANSCRIPT_API_NOT_FOUND", ...context };
  }

  let response;
  try {
    response = await fetch(urls[urls.length - 1], { credentials: "include" });
  } catch (error) {
    console.error("无际 Edgeless：逐字稿请求失败", error);
    return { success: false, error: "REQUEST_FAILED", ...context };
  }

  if (!response.ok) {
    console.error("无际 Edgeless：逐字稿请求失败", response.status);
    return { success: false, error: "REQUEST_FAILED", ...context };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    console.error("无际 Edgeless：逐字稿响应不是有效 JSON", error);
    return { success: false, error: "INVALID_RESPONSE", ...context };
  }

  const items = data?.list?.[0]?.all_content;
  if (!Array.isArray(items) || items.some(item => typeof item?.Text !== "string")) {
    console.error("无际 Edgeless：逐字稿接口格式不符");
    return { success: false, error: "INVALID_RESPONSE", ...context };
  }

  return {
    success: true,
    items: items.map(item => ({ BeginSec: item.BeginSec, Text: item.Text, TransText: item.TransText })),
    pageTitle: document.title,
    ...context
  };
}

// These requests run on the signed-in replay page, with its existing session.
async function fetchCourseSchedule(courseId, courseType) {
  const url = new URL("/courseapi/v2/course-live/search-live-course-list", location.origin);
  for (const [key, value] of Object.entries({
    all: "1", show_all: "1", show_delete: "2", with_sub_data: "1",
    course_id: courseId, course_type: courseType
  })) url.searchParams.set(key, value);
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("课次列表 HTTP " + response.status);
  const data = await response.json();
  const list = data?.data?.list ?? data?.list;
  if (!Array.isArray(list)) throw new Error("课次列表响应格式不符");
  return list.map(item => ({
    subId: String(item.sub_id || ""),
    subTitle: String(item.sub_title || ""),
    pptUrl: Object.values(item).find(value => typeof value === "string" && /^https:\/\//i.test(value) && /\.pptx?(?:[?#]|$)/i.test(value)) || ""
  }));
}

async function findSessionPpt(courseId, subId) {
  const url = new URL("/pptnoteapi/v1/schedule/search-ppt", location.origin);
  for (const [key, value] of Object.entries({ course_id: courseId, sub_id: subId, page: "1", per_page: "100" })) url.searchParams.set(key, value);
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("PPT 列表 HTTP " + response.status);
  const data = await response.json();
  const list = data?.data?.list ?? data?.list;
  if (!Array.isArray(list)) throw new Error("PPT 列表响应格式不符");
  for (const item of list) {
    let content = item.content;
    if (typeof content === "string") {
      try { content = JSON.parse(content); } catch { content = {}; }
    }
    for (const value of [...Object.values(item), ...Object.values(content || {})]) {
      if (typeof value === "string" && /^https:\/\//i.test(value) && /\.pptx?(?:[?#]|$)/i.test(value)) return value;
    }
  }
  return "";
}

async function fetchPptBinary(fileUrl) {
  const url = new URL(fileUrl);
  if (url.protocol !== "https:" || !/\.(?:cmc\.zju\.edu\.cn|zju\.edu\.cn)$/.test(url.hostname)) throw new Error("PPT 地址不在智云域名下");
  const response = await fetch(url, { credentials: url.origin === location.origin ? "include" : "omit", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error("PPT 文件 HTTP " + response.status);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const pptx = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ppt = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  if (!pptx && !ppt) throw new Error("返回内容不是 PPT 文件");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { base64: btoa(binary), extension: pptx ? ".pptx" : ".ppt" };
}

async function fetchSessionTranscript(subId) {
  const url = new URL("/courseapi/v3/web-socket/search-trans-result", location.origin);
  url.searchParams.set("sub_id", subId);
  url.searchParams.set("format", "json");
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("逐字稿 HTTP " + response.status);
  const data = await response.json();
  const list = data?.data?.list ?? data?.list;
  if (!Array.isArray(list)) throw new Error("逐字稿响应格式不符");
  const items = list[0]?.all_content;
  if (list.length === 0 || items == null) return [];
  if (!Array.isArray(items) || items.some(item => typeof item?.Text !== "string")) {
    throw new Error("逐字稿内容格式不符");
  }
  return items.map(item => ({ BeginSec: item.BeginSec, Text: item.Text, TransText: item.TransText }));
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const remainingSeconds = String(total % 60).padStart(2, "0");
  return hours + ":" + minutes + ":" + remainingSeconds;
}

function frontMatter(entries) {
  const lines = ["---"];
  for (const [key, value] of entries) if (value !== undefined && value !== "") lines.push(key + ": " + JSON.stringify(value));
  return [...lines, "---", ""];
}

function makeMarkdown(items, metadata, options = settings) {
  const lines = options.includeFrontMatter ? frontMatter([
    ["course", metadata?.course], ["teacher", metadata?.teacher], ["date", metadata?.date],
    ["period", metadata?.period], ["source", "ZJU 智云课堂"]
  ]) : [];
  lines.push("# " + (metadata?.course || "智云课堂逐字稿"), "");
  const courseInfo = [
    ["课程", metadata?.course],
    ["教师", metadata?.teacher],
    ["时间", metadata?.time]
  ].filter(([, value]) => value);
  if (courseInfo.length) {
    lines.push("## 课程信息", "");
    for (const [label, value] of courseInfo) lines.push("- " + label + "：" + value);
    lines.push("", "## 逐字稿", "");
  }
  lines.push(...transcriptLines(items, options));
  return lines.join("\n") + "\n";
}

function makeFilename(pageTitle, metadata = {}) {
  const values = {
    课程: metadata.course || pageTitle || "智云课堂",
    教师: metadata.teacher,
    日期: metadata.date,
    节次: metadata.period
  };
  const tokens = settings.filenameTemplate.match(/\{[^}]+\}/g) || [];
  const parts = tokens.map(token => cleanFilenamePart(values[token.slice(1, -1)])).filter(Boolean);
  return (parts.join("_") || "智云课堂逐字稿") + ".md";
}

function cleanFilenamePart(value) {
  return String(value || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ").replace(/_+/g, "_").trim().replace(/^[_. ]+|[_. ]+$/g, "").slice(0, 70);
}

function sanitizeFilename(value) {
  return cleanFilenamePart(value) || "智云课堂";
}

function sessionTitle(raw) {
  const match = String(raw || "").match(/^(\d{4}-\d{1,2}-\d{1,2})\s*(第\d+(?:[-－~～]\d+)?节)$/);
  return match ? match[1] + " · " + match[2] : String(raw || "未命名课次");
}

function shortSessionTitle(raw) {
  return sessionTitle(raw).replace(/^\d{4}-/, "");
}

function transcriptLines(items, options = settings) {
  const lines = [];
  for (const item of items) {
    const translation = typeof item.TransText === "string" ? item.TransText : "";
    if (options.includeTimestamp) lines.push("**" + formatTime(item.BeginSec) + "**", "");
    if (options.transcriptLanguage === "translated" && translation) lines.push(translation, "");
    else if (options.transcriptLanguage === "bilingual" && translation) lines.push(item.Text, "", "> " + translation, "");
    else lines.push(item.Text, "");
  }
  return lines;
}

function makeCombinedMarkdown(sessions, metadata, now = new Date(), options = settings) {
  const available = sessions.filter(session => session.status === "success");
  const time = [
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0")
  ].join(" ");
  const lines = options.includeFrontMatter ? frontMatter([
    ["course", metadata.course], ["teacher", metadata.teacher], ["source", "ZJU 智云课堂"],
    ["lesson_count", available.length], ["exported_at", time.slice(0, 10)]
  ]) : [];
  lines.push("# " + (metadata.course || "智云课堂"), "", "- 教师：" + (metadata.teacher || "未提供"), "- 已导出课次：" + available.length, "- 导出时间：" + time, "", "---", "");
  for (const session of available) {
    lines.push("## " + sessionTitle(session.subTitle), "", ...transcriptLines(session.transcript, options), "---", "");
  }
  return lines.join("\n") + "\n";
}

function makeSessionMarkdown(session, metadata, options = settings) {
  const match = String(session.subTitle).match(/^(\d{4}-\d{1,2}-\d{1,2})\s*(第.+节)$/);
  const lines = options.includeFrontMatter ? frontMatter([
    ["course", metadata.course], ["teacher", metadata.teacher], ["date", match?.[1]],
    ["period", match?.[2]], ["source", "ZJU 智云课堂"]
  ]) : [];
  lines.push("# " + (metadata.course || "智云课堂"), "", "- 教师：" + (metadata.teacher || "未提供"), "- 时间：" + sessionTitle(session.subTitle), "", "---", "", ...transcriptLines(session.transcript, options));
  return lines.join("\n") + "\n";
}

function makeIndexMarkdown(sessions, metadata) {
  const lines = ["# " + (metadata.course || "智云课堂"), "", "教师：" + (metadata.teacher || "未提供"), "", "## 已导出课次", ""];
  const available = sessions.filter(session => session.status === "success");
  available.forEach((session, index) => lines.push((index + 1) + ". " + sessionTitle(session.subTitle)));
  const omitted = sessions.filter(item => item.status !== "success");
  if (omitted.length) {
    lines.push("", "## 未导出课次", "");
    for (const session of omitted) lines.push("- " + sessionTitle(session.subTitle) + "：" + (session.status === "error" ? "读取失败" : "暂无逐字稿"));
  }
  return lines.join("\n") + "\n";
}

async function makeCourseZip(sessions, metadata, pptFiles = []) {
  const course = sanitizeFilename(metadata.course);
  const zip = new JSZip();
  const folder = zip.folder(course);
  const selected = settings.zipContents;
  if (selected.mergedMarkdown) folder.file(course + "_完整逐字稿.md", makeCombinedMarkdown(sessions, metadata));
  if (selected.index) folder.file("index.md", makeIndexMarkdown(sessions, metadata));
  if (selected.splitMarkdown) {
    const lessons = folder.folder("分课逐字稿");
    sessions.filter(session => session.status === "success").forEach((session, index) => {
      const prefix = String(index + 1).padStart(2, "0");
      lessons.file(prefix + "_" + sanitizeFilename(sessionTitle(session.subTitle).replace(" · ", "_")) + ".md", makeSessionMarkdown(session, metadata));
    });
  }
  if (selected.ppt && pptFiles.length) {
    const pptFolder = folder.folder("PPT");
    pptFiles.forEach(file => pptFolder.file(file.name, file.base64, { base64: true }));
  }
  if (!Object.values(zip.files).some(file => !file.dir)) return null;
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function showState(state, title = "", detail = "") {
  loadingPanel.hidden = state !== "loading";
  successPanel.hidden = state !== "success";
  messagePanel.hidden = state !== "empty" && state !== "error";
  primaryAction.disabled = state === "loading";
  if (state === "empty" || state === "error") {
    messageTitle.textContent = title;
    messageDetail.textContent = detail;
  }
  if (state === "loading") primaryAction.textContent = "正在提取…";
  if (state === "success") primaryAction.textContent = "↓  导出 Markdown";
  if (state === "empty" || state === "error") primaryAction.textContent = "↻  重新检测";
}

function renderMetadata(metadata = {}) {
  for (const key of ["course", "teacher", "time"]) {
    document.getElementById(key).textContent = metadata[key] || "—";
  }
}

function renderPreview(items) {
  preview.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const time = document.createElement("span");
    time.className = "preview-time";
    time.textContent = formatTime(item.BeginSec);
    const content = document.createElement("span");
    content.className = "preview-text";
    const translation = typeof item.TransText === "string" ? item.TransText : "";
    content.textContent = settings.transcriptLanguage === "translated" && translation ? translation
      : settings.transcriptLanguage === "bilingual" && translation ? item.Text + "\n" + translation : item.Text;
    row.append(time, content);
    fragment.append(row);
  }
  preview.append(fragment);
  preview.scrollTop = 0;
}

function setMode(nextMode) {
  mode = nextMode;
  currentContent.hidden = mode !== "current";
  courseContent.hidden = mode !== "course";
  document.getElementById("time-property").hidden = mode === "course";
  for (const [id, active] of [["current-mode", mode === "current"], ["course-mode", mode === "course"]]) {
    const button = document.getElementById(id);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (mode === "course") loadCourse();
}

function renderCourse() {
  courseList.replaceChildren();
  if (!courseSessions) return;
  const fragment = document.createDocumentFragment();
  const marks = { pending: "○", loading: "…", success: "✓", empty: "○", error: "!" };
  const labels = { pending: "等待", loading: "正在读取", success: "已有逐字稿", empty: "暂无逐字稿", error: "读取失败" };
  for (const session of courseSessions) {
    const row = document.createElement("div");
    row.className = "course-row " + session.status;
    const mark = document.createElement("span");
    mark.className = "course-mark";
    mark.textContent = marks[session.status];
    const title = document.createElement("span");
    title.className = "course-title";
    title.textContent = shortSessionTitle(session.subTitle);
    const status = document.createElement("small");
    status.textContent = labels[session.status];
    row.append(mark, title, status);
    fragment.append(row);
  }
  courseList.append(fragment);
  const available = courseSessions.filter(session => session.status === "success").length;
  const done = courseSessions.filter(session => session.status !== "pending" && session.status !== "loading").length;
  courseCount.textContent = "已排课 " + courseSessions.length + " 次 · 当前可导出 " + available + " 次";
  courseAction.disabled = exportingCourse || available === 0;
  if (!exportingCourse) {
    courseAction.textContent = done < courseSessions.length ? "正在读取 " + done + " / " + courseSessions.length + "…" : "↓  导出整门课程";
  }
}

async function loadCourse() {
  if (courseSessions || courseLoadPromise) return courseLoadPromise;
  courseCount.textContent = "正在读取课次…";
  courseStatus.textContent = "";
  courseAction.disabled = true;
  courseLoadPromise = (async () => {
    if (currentLoadPromise) await currentLoadPromise;
    if (!pageContext?.courseId) {
      courseCount.textContent = "无法识别课程 ID";
      courseStatus.textContent = "请刷新回放页后重试；检查页面 URL 或 Network 中是否包含 course_id。";
      console.error("无际 Edgeless：无法从回放页定位 course_id");
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", func: fetchCourseSchedule,
        args: [pageContext.courseId, pageContext.courseType]
      });
      courseSessions = injection.result.map(item => ({
        ...item, status: item.subId ? "pending" : "error", transcript: []
      }));
      renderCourse();
      if (courseSessions.length === 0) {
        courseStatus.textContent = "这门课程暂未返回课次。";
        return;
      }
      courseScanPromise = scanCourse(tab.id);
      await courseScanPromise;
    } catch (error) {
      console.error("无际 Edgeless：读取课程课次失败", error);
      courseCount.textContent = "读取课次失败";
      courseStatus.textContent = "请刷新课程页面后重试。";
      courseAction.disabled = false;
      courseAction.textContent = "↻  重新读取课次";
    }
  })();
  try { await courseLoadPromise; } finally { courseLoadPromise = null; }
}

async function scanCourse(tabId) {
  for (const session of courseSessions) {
    if (session.status !== "pending") continue;
    session.status = "loading";
    renderCourse();
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", func: fetchSessionTranscript, args: [session.subId]
      });
      session.transcript = injection.result;
      session.status = session.transcript.length > 0 ? "success" : "empty";
    } catch (error) {
      session.status = "error";
      console.error("无际 Edgeless：课次 " + session.subId + " 逐字稿读取失败", error);
    }
    renderCourse();
  }
  const available = courseSessions.filter(session => session.status === "success").length;
  const omitted = courseSessions.length - available;
  courseStatus.textContent = available
    ? "✓ 已准备 " + available + " 个课次" + (omitted ? " · " + omitted + " 个课次暂无逐字稿或读取失败" : "")
    : "当前课程暂未发现可导出的逐字稿。";
}

async function exportCourse() {
  if (!courseSessions) {
    loadCourse();
    return;
  }
  if (exportingCourse) return;
  exportingCourse = true;
  courseAction.disabled = true;
  try {
    if (courseScanPromise) await courseScanPromise;
    if (!courseSessions.some(session => session.status === "success")) {
      courseStatus.textContent = "当前课程暂未发现可导出的逐字稿。";
      return;
    }
    const metadata = pageContext.metadata;
    const course = sanitizeFilename(metadata.course);
    const format = document.querySelector('input[name="course-format"]:checked').value;
    courseAction.textContent = format === "zip" ? "正在生成 ZIP…" : "正在生成 Markdown…";
    const pptFiles = format === "zip" && settings.zipContents.ppt ? await collectPptFiles() : [];
    const blob = format === "zip"
      ? await makeCourseZip(courseSessions, metadata, pptFiles)
      : new Blob([makeCombinedMarkdown(courseSessions, metadata)], { type: "text/markdown;charset=utf-8" });
    if (!blob) {
      courseStatus.textContent = "未找到可加入课程资料包的文件。";
      return;
    }
    downloadBlob(blob, course + (format === "zip" ? "_课程资料包.zip" : "_完整逐字稿.md"));
    const available = courseSessions.filter(session => session.status === "success").length;
    courseStatus.textContent = "已导出 " + available + " / " + courseSessions.length + " 个课次" + (format === "zip" && settings.zipContents.ppt ? (pptFiles.length ? " · PPT " + pptFiles.length + " 份" : " · 未找到原始 PPT 文件") : "");
  } catch (error) {
    console.error("无际 Edgeless：整门课程导出失败", error);
    courseStatus.textContent = "导出失败，请重试。";
  } finally {
    exportingCourse = false;
    renderCourse();
  }
}

async function collectPptFiles() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const files = [];
  for (const [index, session] of courseSessions.entries()) {
    courseAction.textContent = "正在检查 PPT " + (index + 1) + " / " + courseSessions.length + "…";
    try {
      let fileUrl = session.pptUrl;
      if (!fileUrl) {
        const [found] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: findSessionPpt, args: [pageContext.courseId, session.subId] });
        fileUrl = found.result;
      }
      if (!fileUrl) continue;
      const [downloaded] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: fetchPptBinary, args: [fileUrl] });
      const prefix = String(index + 1).padStart(2, "0");
      files.push({ name: prefix + "_" + sanitizeFilename(sessionTitle(session.subTitle).replace(" · ", "_")) + downloaded.result.extension, base64: downloaded.result.base64 });
    } catch (error) {
      console.error("无际 Edgeless：课次 " + session.subId + " PPT 读取失败", error);
    }
  }
  if (files.length === 0) courseStatus.textContent = "未找到原始 PPT 文件；智云返回的幻灯片截图不会冒充 PPT。";
  return files;
}

document.getElementById("current-mode").addEventListener("click", () => setMode("current"));
document.getElementById("course-mode").addEventListener("click", () => setMode("course"));
courseAction.addEventListener("click", exportCourse);

async function downloadTranscript() {
  if (!transcript) return;
  if (typeof window.showSaveFilePicker !== "function") {
    primaryAction.textContent = "当前浏览器不支持本地保存";
    return;
  }

  let handle;
  try {
    handle = await window.showSaveFilePicker({
      id: "edgeless-markdown",
      suggestedName: makeFilename(transcript.pageTitle, transcript.metadata),
      types: [{ description: "Markdown 文件", accept: { "text/markdown": [".md"] } }]
    });
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("无际 Edgeless：无法打开保存对话框", error);
      primaryAction.textContent = "无法打开保存对话框";
    }
    return;
  }

  primaryAction.disabled = true;
  primaryAction.textContent = "正在保存…";
  try {
    const writable = await handle.createWritable();
    await writable.write(makeMarkdown(transcript.items, transcript.metadata));
    await writable.close();
    primaryAction.textContent = "✓  已保存";
    setTimeout(() => {
      if (transcript) primaryAction.textContent = "↓  导出 Markdown";
    }, 1800);
  } catch (error) {
    console.error("无际 Edgeless：保存 Markdown 失败", error);
    primaryAction.textContent = "保存失败，请重试";
  } finally {
    primaryAction.disabled = false;
  }
}

primaryAction.addEventListener("click", () => {
  if (transcript) downloadTranscript();
  else loadTranscript();
});

function openInfo(title, detail) {
  document.getElementById("dialog-title").textContent = title;
  document.getElementById("dialog-detail").textContent = detail;
  dialog.showModal();
}
const settingMenu = document.getElementById("setting-menu");
let activeSettingButton = null;

function closeSettingMenu(restoreFocus = false) {
  if (!activeSettingButton) return;
  settingMenu.hidden = true;
  activeSettingButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) activeSettingButton.focus();
  activeSettingButton = null;
}

function chooseSetting(choice, value) {
  if (settings[choice.key] === value) return;
  saveSetting(choice.key, value);
  renderSettings();
  if (choice.key === "theme") applyTheme();
  if (choice.key === "defaultCourseExportFormat") document.querySelector(`input[name="course-format"][value="${value}"]`).checked = true;
  if (choice.key === "transcriptLanguage" && transcript) renderPreview(transcript.items);
}

function openSettingMenu(button, step = 0) {
  closeSettingMenu();
  const choice = SETTING_CHOICES[button.id];
  activeSettingButton = button;
  button.setAttribute("aria-expanded", "true");
  settingMenu.setAttribute("aria-label", button.getAttribute("aria-label"));
  const options = choice.options.map(([value, label]) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "setting-option";
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", String(settings[choice.key] === value));
    option.textContent = label;
    option.addEventListener("click", () => { closeSettingMenu(true); chooseSetting(choice, value); });
    return option;
  });
  settingMenu.replaceChildren(...options);
  settingMenu.hidden = false;
  const rect = button.getBoundingClientRect();
  settingMenu.style.width = `${Math.min(button.id === "setting-filename" ? 248 : Math.max(164, rect.width + 36), window.innerWidth - 16)}px`;
  const menuWidth = settingMenu.offsetWidth;
  const menuHeight = settingMenu.offsetHeight;
  settingMenu.style.left = `${Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
  settingMenu.style.top = `${rect.bottom + 4 + menuHeight <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - menuHeight - 4)}px`;
  const selected = choice.options.findIndex(([value]) => value === settings[choice.key]);
  options[(selected + step + options.length) % options.length].focus();
}

for (const id of Object.keys(SETTING_CHOICES)) {
  const button = document.getElementById(id);
  button.addEventListener("click", () => activeSettingButton === button ? closeSettingMenu(true) : openSettingMenu(button));
  button.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openSettingMenu(button, event.key === "ArrowDown" ? 1 : -1);
    }
  });
}
settingMenu.addEventListener("keydown", event => {
  const options = [...settingMenu.querySelectorAll(".setting-option")];
  const index = options.indexOf(document.activeElement);
  if (event.key === "Escape") { event.preventDefault(); closeSettingMenu(true); }
  else if (event.key === "Tab") closeSettingMenu(true);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }
});
document.addEventListener("pointerdown", event => {
  if (activeSettingButton && !activeSettingButton.contains(event.target) && !settingMenu.contains(event.target)) closeSettingMenu();
});
document.querySelector(".settings-scroll").addEventListener("scroll", () => closeSettingMenu());
reloadExtension.addEventListener("click", () => chrome.runtime.reload());
document.getElementById("settings").addEventListener("click", () => {
  mainView.hidden = true;
  settingsView.hidden = false;
  renderSettings();
});
document.getElementById("settings-back").addEventListener("click", () => {
  closeSettingMenu();
  settingsView.hidden = true;
  mainView.hidden = false;
  if (transcript) renderPreview(transcript.items);
});
for (const [id, key] of [
  ["setting-timestamp", "includeTimestamp"], ["setting-frontmatter", "includeFrontMatter"]
]) {
  document.getElementById(id).addEventListener("change", event => {
    saveSetting(key, event.target.checked);
  });
}
for (const input of document.querySelectorAll("[data-zip-key]")) {
  input.addEventListener("change", () => {
    const next = { ...settings.zipContents, [input.dataset.zipKey]: input.checked };
    if (!Object.values(next).some(Boolean)) {
      input.checked = true;
      document.getElementById("zip-hint").textContent = "课程资料包至少需要包含一项内容。";
      return;
    }
    document.getElementById("zip-hint").textContent = "";
    saveSetting("zipContents", next);
  });
}
document.getElementById("reset-settings").addEventListener("click", () => document.getElementById("reset-dialog").showModal());
document.getElementById("reset-dialog").addEventListener("close", async event => {
  if (event.target.returnValue !== "default") return;
  try {
    await saveQueue;
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, zipContents: { ...DEFAULT_SETTINGS.zipContents } };
    applyTheme();
    renderSettings();
    document.querySelector('input[name="course-format"][value="merged_markdown"]').checked = true;
    saveStatus.textContent = "✓ 已恢复默认设置";
    saveStatus.classList.remove("error");
    document.getElementById("zip-hint").textContent = "";
    if (transcript) renderPreview(transcript.items);
  } catch (error) {
    saveStatus.textContent = "恢复失败，请重试";
    saveStatus.classList.add("error");
    console.error("无际 Edgeless：恢复默认设置失败", error);
  }
});
systemTheme.addEventListener("change", () => { if (settings.theme === "system") applyTheme(); });
document.getElementById("help").addEventListener("click", () => {
  openInfo("使用帮助", "打开智云课堂课程回放页，在右侧打开「语音识别」并等待字幕加载，然后点击「重新检测」或重新打开插件。");
});

async function loadTranscriptImpl() {
  transcript = null;
  pageContext = null;
  showState("loading");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isReplayPage(tab.url)) {
      properties.hidden = true;
      showState("error", "请先打开智云课堂课程回放页面", "打开课程回放后，再点击下方按钮。");
      return;
    }

    properties.hidden = false;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: extractTranscript
    });
    const result = injection?.result;
    pageContext = result;
    renderMetadata(result?.metadata);

    if (result?.success && result.items.length > 0) {
      transcript = result;
      renderPreview(result.items);
      showState("success");
      return;
    }

    if (result?.error === "TRANSCRIPT_API_NOT_FOUND" || result?.success) {
      showState("empty", "暂未检测到逐字稿", "请先在智云课堂页面右侧打开「语音识别」，等待字幕加载后再重新检测。");
    } else if (result?.error === "INVALID_RESPONSE") {
      showState("error", "读取逐字稿失败", "智云课堂接口格式可能已变化，请刷新课程页面后重试。");
    } else {
      showState("error", "逐字稿读取失败", "请稍后重试。");
    }
  } catch (error) {
    console.error("无际 Edgeless：无法读取当前页面", error);
    showState("error", "逐字稿读取失败", "请稍后重试。");
  }
}

function loadTranscript() {
  currentLoadPromise = loadTranscriptImpl();
  return currentLoadPromise;
}

async function initialize() {
  document.getElementById("app-version").textContent = "v" + chrome.runtime.getManifest().version;
  await loadSettings();
  loadTranscript();
  setMode(settings.defaultMode);
}

initialize();

