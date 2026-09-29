const loadingPanel = document.getElementById("loading-panel");
const successPanel = document.getElementById("success-panel");
const messagePanel = document.getElementById("message-panel");
const messageTitle = document.getElementById("message-title");
const messageDetail = document.getElementById("message-detail");
const preview = document.getElementById("preview");
const primaryAction = document.getElementById("primary-action");
const pptAction = document.getElementById("ppt-action");
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
  "setting-filename": { key: "filenameTemplate", options: [["{课程}_{日期}_{节次}", "课程 · 日期 · 节次"], ["{课程}_{教师}_{日期}", "课程 · 教师 · 日期"], ["{日期}_{课程}_{节次}", "日期 · 课程 · 节次"]] },
  "setting-theme": { key: "theme", options: [["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]] }
};
let settings = { ...DEFAULT_SETTINGS, zipContents: { ...DEFAULT_SETTINGS.zipContents } };
let saveQueue = Promise.resolve();
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const zipDetails = document.getElementById("zip-details");
const currentContent = document.getElementById("current-content");
const courseContent = document.getElementById("course-content");
const courseList = document.getElementById("course-list");
const courseSelectAll = document.getElementById("course-select-all");
const courseSelectionCount = document.getElementById("course-selection-count");
const courseCount = document.getElementById("course-count");
const courseStatus = document.getElementById("course-status");
const courseAction = document.getElementById("course-action");
const resources = document.getElementById("resources");
const resourceStatus = document.getElementById("resource-status");
const transcriptCard = document.getElementById("transcript-card");
const pptCard = document.getElementById("ppt-card");
const pptPreview = document.getElementById("ppt-preview");
let transcript = null;
let pageContext = null;
let currentPpt = null;
let detectionRevision = 0;
let currentLoadPromise = null;
let courseLoadPromise = null;
let courseScanPromise = null;
let courseSessions = null;
let mode = "current";
let exportingCourse = false;
let transcriptState = "loading";
let pptState = "loading";
let openPreview = null;
let currentPptPreviewLoaded = false;
let expandedSession = -1;
let coursePreviewKey = "";

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
  document.getElementById("zip-summary").textContent = Object.values(settings.zipContents).filter(Boolean).length + " 项已选";
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
  zipDetails.open = settings.defaultCourseExportFormat === "zip";
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

function isLivingPage(url) {
  try {
    const page = new URL(url);
    return page.protocol === "https:"
      && page.hostname === "classroom.zju.edu.cn"
      && ["/livingpage", "/livingroom"].includes(page.pathname);
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

// This function runs in the current page's MAIN world; it cannot use popup variables.
async function extractLivingTranscript() {
  const params = new URL(location.href).searchParams;
  const courseId = params.get("course_id") || "";
  const subId = params.get("sub_id") || "";
  const context = { courseId, subId, courseType: "multi", metadata: {} };
  if (!courseId || !subId) return { success: false, error: "MISSING_SESSION_ID", ...context };

  try {
    const infoUrl = new URL("/courseapi/v3/portal-home-setting/get-sub-info", location.origin);
    infoUrl.searchParams.set("course_id", courseId);
    infoUrl.searchParams.set("sub_id", subId);
    const infoResponse = await fetch(infoUrl, { credentials: "include", signal: AbortSignal.timeout(20000) });
    if (infoResponse.status === 401 || infoResponse.status === 403) return { success: false, error: "ACCESS_DENIED", ...context };
    if (!infoResponse.ok) return { success: false, error: "REQUEST_FAILED", ...context };
    const info = await infoResponse.json();
    if (info?.code === 401 || info?.code === 403) return { success: false, error: "ACCESS_DENIED", ...context };
    if (info?.code !== 0) return { success: false, error: "API_ERROR", ...context };
    if (!info.data || String(info.data.course_id) !== courseId || String(info.data.sub_id) !== subId) {
      return { success: false, error: "INVALID_RESPONSE", ...context };
    }
    const title = String(info.data.sub_title || "");
    const parts = title.match(/^(\d{4}-\d{1,2}-\d{1,2})\s*(第\d+(?:[-－~～]\d+)?节)$/);
    context.metadata = {
      course: String(info.data.course_title || ""),
      teacher: String(info.data.lecturer_name || ""),
      time: parts ? parts[1] + " · " + parts[2] : title,
      date: parts?.[1] || "",
      period: parts?.[2] || ""
    };
    const ppt = info.data.content?.download?.ppt;
    context.pptFallback = ppt ? { pathName: ppt.path_name || "", fileName: ppt.file_name || "" } : null;

    const transcriptUrl = new URL("https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result");
    transcriptUrl.searchParams.set("sub_id", subId);
    transcriptUrl.searchParams.set("format", "json");
    const response = await fetch(transcriptUrl, { credentials: "omit", signal: AbortSignal.timeout(20000) });
    if (response.status === 401 || response.status === 403) return { success: false, error: "ACCESS_DENIED", ...context };
    if (!response.ok) return { success: false, error: "REQUEST_FAILED", ...context };
    const data = await response.json();
    if (data?.code === 401 || data?.code === 403) return { success: false, error: "ACCESS_DENIED", ...context };
    if (data?.code !== 0) return { success: false, error: "API_ERROR", ...context };
    const items = data?.list?.[0]?.all_content;
    if (!Array.isArray(data.list) || (items != null && !Array.isArray(items))) {
      return { success: false, error: "INVALID_RESPONSE", ...context };
    }
    if (!items?.length) return { success: true, items: [], ...context };
    const usable = items.filter(item => typeof item?.Text === "string" && item.Text.trim());
    return {
      success: true,
      items: usable.map(item => ({ BeginSec: item.BeginSec, Text: item.Text, TransText: item.TransText })),
      pageTitle: document.title,
      ...context
    };
  } catch (error) {
    console.error("无际 Edgeless：livingpage 请求失败", error);
    return { success: false, error: "REQUEST_FAILED", ...context };
  }
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

async function fetchLivingCourseSchedule(courseId) {
  const url = new URL("https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue");
  url.searchParams.set("course_id", courseId);
  const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("课次列表 HTTP " + response.status);
  const data = await response.json();
  if (data?.success !== true || data?.result?.code !== 200 || !Array.isArray(data.result.data)) {
    throw new Error("课次列表响应格式不符");
  }
  return data.result.data.map(item => {
    let ppt = null;
    try {
      const content = typeof item.content === "string" ? JSON.parse(item.content) : item.content;
      ppt = content?.download?.ppt;
    } catch { /* This lesson has no usable courseware metadata. */ }
    return {
      subId: String(item.sub_id || ""),
      subTitle: String(item.title || ""),
      pptFallback: ppt ? { pathName: ppt.path_name || "", fileName: ppt.file_name || "" } : null
    };
  });
}

async function findCourseware(courseId, subId, livingPage, fallback) {
  const url = new URL("/courseapi/v2/export/get-courseware-status", location.origin);
  for (const [key, value] of Object.entries({ type: "1", sub_id: subId, get_source_url: "1" })) url.searchParams.set(key, value);
  let primaryFailed = false;
  try {
    const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("课件状态 HTTP " + response.status);
    const data = await response.json();
    if (data?.code === 0 && data.data?.path_name) {
      return { status: "available", url: data.data.path_name, fileName: data.data.file_name || "", source: "courseware-status" };
    }
    primaryFailed = data?.code !== 0;
  } catch (error) {
    primaryFailed = true;
    console.error("无际 Edgeless：课件状态请求失败", error);
  }

  if (fallback?.pathName) return { status: "available", url: fallback.pathName, fileName: fallback.fileName || "", source: "sub-info" };
  if (livingPage) {
    try {
      const infoUrl = new URL("/courseapi/v3/portal-home-setting/get-sub-info", location.origin);
      infoUrl.searchParams.set("course_id", courseId);
      infoUrl.searchParams.set("sub_id", subId);
      const response = await fetch(infoUrl, { credentials: "include", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error("课次信息 HTTP " + response.status);
      const data = await response.json();
      if (data?.code !== 0) throw new Error("课次信息接口返回失败");
      const ppt = data.data?.content?.download?.ppt;
      if (ppt?.path_name) return { status: "available", url: ppt.path_name, fileName: ppt.file_name || "", source: "sub-info" };
      return { status: "empty" };
    } catch (error) {
      console.error("无际 Edgeless：课件详情请求失败", error);
      return { status: "error" };
    }
  }
  return { status: primaryFailed ? "error" : "empty" };
}

// Runs on the replay page. Preview failure never changes the original PPT download state.
async function fetchPptPreview(courseId, subId) {
  const path = new URL(location.origin).hostname === "classroom.zju.edu.cn"
    ? "/pptnote/v1/schedule/search-ppt" : "/pptnoteapi/v1/schedule/search-ppt";
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries({ course_id: courseId, sub_id: subId, page: "1", per_page: "100" })) url.searchParams.set(key, value);
  const response = await fetch(url, { credentials: "include", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("PPT 预览 HTTP " + response.status);
  const data = await response.json();
  const pages = [data?.list, data?.data?.list, data?.data, data?.result?.data].find(Array.isArray) || [];
  const seen = new Set();
  const thumbnails = [];
  for (const page of pages) {
    let content = page?.content;
    if (typeof content === "string") {
      try { content = JSON.parse(content); } catch { content = null; }
    }
    const raw = content?.pptthumb || content?.pptimgurl || page?.pptthumb || page?.pptimgurl;
    if (typeof raw !== "string" || !raw.trim()) continue;
    try {
      const image = new URL(raw, location.origin);
      if (image.protocol === "http:" && image.hostname === "video.cmc.zju.edu.cn") image.protocol = "https:";
      if (image.protocol !== "https:" || !/(?:^|\.)(?:cmc\.zju\.edu\.cn|zju\.edu\.cn)$/.test(image.hostname) || seen.has(image.href)) continue;
      seen.add(image.href);
      if (thumbnails.length < 4) thumbnails.push(image.href);
    } catch { /* Ignore missing or malformed preview URLs. */ }
  }
  const total = Number(data?.total);
  return { count: data?.total != null && Number.isFinite(total) ? total : pages.length, thumbnails };
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

async function fetchSessionTranscript(subId, livingPage = false) {
  const url = new URL("/courseapi/v3/web-socket/search-trans-result", livingPage ? "https://yjapi.cmc.zju.edu.cn" : location.origin);
  url.searchParams.set("sub_id", subId);
  url.searchParams.set("format", "json");
  const response = await fetch(url, { credentials: livingPage ? "omit" : "include", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("逐字稿 HTTP " + response.status);
  const data = await response.json();
  if (livingPage && data?.code !== 0) throw new Error("逐字稿接口返回失败");
  const list = data?.data?.list ?? data?.list;
  if (!Array.isArray(list)) throw new Error("逐字稿响应格式不符");
  const items = list[0]?.all_content;
  if (list.length === 0 || items == null) return [];
  if (!Array.isArray(items) || items.some(item => typeof item?.Text !== "string")) {
    throw new Error("逐字稿内容格式不符");
  }
  return (livingPage ? items.filter(item => item.Text.trim()) : items)
    .map(item => ({ BeginSec: item.BeginSec, Text: item.Text, TransText: item.TransText }));
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

async function makeCourseZip(sessions, metadata, pptFiles = [], wholeCourse = true) {
  const course = sanitizeFilename(metadata.course);
  const zip = new JSZip();
  const folder = zip.folder(course);
  const selected = settings.zipContents;
  if (selected.mergedMarkdown && sessions.some(session => session.status === "success")) {
    folder.file(course + (wholeCourse ? "_完整逐字稿.md" : "_已选" + sessions.length + "次逐字稿.md"), makeCombinedMarkdown(sessions, metadata));
  }
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
    pptFiles.forEach(file => file.bytes
      ? pptFolder.file(file.name, file.bytes)
      : pptFolder.file(file.name, file.base64, { base64: true }));
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
  transcriptState = state;
  const supported = !!pageContext?.kind;
  loadingPanel.hidden = state !== "loading";
  resources.hidden = state === "loading" || !supported;
  messagePanel.hidden = state === "loading" || supported || state === "success";
  if (!messagePanel.hidden) {
    messageTitle.textContent = title;
    messageDetail.textContent = detail;
  }
  primaryAction.disabled = state !== "success";
  primaryAction.textContent = "导出逐字稿";
  document.getElementById("retry-detection").hidden = state === "success" || !supported;
  transcriptCard.disabled = state !== "success";
  document.getElementById("transcript-card-status").textContent = state === "success"
    ? transcript.items.length + " 段" : state === "loading" ? "检测中…" : state === "empty" ? "暂无" : "获取失败";
  document.getElementById("transcript-count").textContent = state === "success" ? "共 " + transcript.items.length + " 段" : "";
  if (state === "success") setPreview("transcript");
  else if (pptState === "available") activatePptPreview();
  else setPreview(null);
  renderResourceStatus();
}

function renderResourceStatus() {
  const available = transcriptState === "success" || pptState === "available";
  document.getElementById("resource-status-text").textContent = available ? "✓ 已检测到课堂内容"
    : transcriptState === "loading" || pptState === "loading" ? "正在检测课堂内容…"
    : "暂未检测到课堂内容";
  resourceStatus.dataset.state = available ? "success" : transcriptState === "loading" || pptState === "loading" ? "loading" : "empty";
  document.getElementById("preview-placeholder-text").textContent = transcriptState === "loading" || pptState === "loading"
    ? "正在检测课堂内容…" : "当前课次暂无可预览的内容";
  pptCard.disabled = pptState !== "available";
  document.getElementById("ppt-card-status").textContent = pptState === "available" ? "可用"
    : pptState === "loading" ? "检测中…" : pptState === "empty" ? "暂无" : "获取失败";
}

function setPreview(next) {
  openPreview = next;
  document.getElementById("preview-placeholder").hidden = next !== null;
  successPanel.hidden = openPreview !== "transcript";
  pptPreview.hidden = openPreview !== "ppt";
  transcriptCard.setAttribute("aria-pressed", String(openPreview === "transcript"));
  pptCard.setAttribute("aria-pressed", String(openPreview === "ppt"));
}

function renderMetadata(metadata = {}) {
  for (const key of ["course", "teacher"]) {
    document.getElementById(key).textContent = metadata[key] || "—";
  }
  updateThirdProperty();
}

function updateThirdProperty() {
  const courseMode = mode === "course";
  document.getElementById("third-property-label").textContent = courseMode ? "课次" : "时间";
  document.getElementById("time").textContent = courseMode
    ? (courseSessions ? courseSessions.length + " 次" : "读取中…")
    : pageContext?.metadata?.time || "—";
}

function renderPreview(items) {
  fillTranscriptPreview(preview, items);
}

function fillTranscriptPreview(container, items) {
  container.replaceChildren();
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
  container.append(fragment);
  container.scrollTop = 0;
}

function setMode(nextMode) {
  mode = nextMode;
  currentContent.hidden = mode !== "current";
  courseContent.hidden = mode !== "course";
  properties.hidden = !pageContext?.kind;
  updateThirdProperty();
  for (const [id, active] of [["current-mode", mode === "current"], ["course-mode", mode === "course"]]) {
    const button = document.getElementById(id);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  if (mode === "course") loadCourse();
}

function renderCourse() {
  const scrollTop = courseList.scrollTop;
  const activeRow = document.activeElement?.closest?.(".course-row");
  const activeIndex = activeRow ? Number(activeRow.dataset.index) : -1;
  const activeCheckbox = activeRow?.querySelector(".course-row-select") === document.activeElement;
  const activeButton = activeRow ? [...activeRow.querySelectorAll("button")].indexOf(document.activeElement) : -1;
  courseList.replaceChildren();
  if (!courseSessions) {
    courseSelectAll.disabled = true;
    courseSelectionCount.textContent = "";
    return;
  }
  updateThirdProperty();
  const fragment = document.createDocumentFragment();
  const labels = { pending: "待检测", loading: "检测中", success: "可用", available: "可用", empty: "暂无", error: "失败" };
  for (const [index, session] of courseSessions.entries()) {
    const row = document.createElement("div");
    row.className = "course-row " + session.status;
    row.dataset.index = String(index);
    const top = document.createElement("div");
    top.className = "course-row-top";
    const checkbox = document.createElement("input");
    checkbox.className = "course-row-select";
    checkbox.type = "checkbox";
    checkbox.checked = session.selected;
    checkbox.disabled = exportingCourse;
    checkbox.setAttribute("aria-label", "将" + sessionTitle(session.subTitle) + "加入课程导出");
    checkbox.addEventListener("change", () => {
      session.selected = checkbox.checked;
      courseStatus.textContent = courseSessions.some(item => item.selected) ? "" : "请先勾选要导出的课次。";
      renderCourse();
    });
    const heading = document.createElement("button");
    heading.className = "course-row-heading";
    heading.type = "button";
    heading.setAttribute("aria-expanded", String(expandedSession === index));
    const title = document.createElement("span");
    title.className = "course-title";
    title.textContent = sessionTitle(session.subTitle);
    const transcriptBadge = document.createElement("small");
    transcriptBadge.textContent = "稿 " + labels[session.status];
    const pptBadge = document.createElement("small");
    pptBadge.textContent = "PPT " + labels[session.ppt?.status || "pending"];
    heading.append(title, transcriptBadge, pptBadge);
    heading.addEventListener("click", () => {
      expandedSession = expandedSession === index ? -1 : index;
      coursePreviewKey = "";
      renderCourse();
    });
    top.append(checkbox, heading);
    row.append(top);
    if (expandedSession === index) row.append(renderSessionDetails(session, index));
    fragment.append(row);
  }
  courseList.append(fragment);
  if (activeIndex >= 0) {
    if (activeCheckbox) courseList.children[activeIndex]?.querySelector(".course-row-select")?.focus({ preventScroll: true });
    else if (activeButton >= 0) courseList.children[activeIndex]?.querySelectorAll("button")[activeButton]?.focus({ preventScroll: true });
  }
  courseList.scrollTop = scrollTop;
  const selected = courseSessions.filter(session => session.selected);
  courseSelectAll.disabled = exportingCourse || !courseSessions.length;
  courseSelectAll.checked = selected.length === courseSessions.length && selected.length > 0;
  courseSelectAll.indeterminate = selected.length > 0 && selected.length < courseSessions.length;
  courseSelectionCount.textContent = selected.length + "/" + courseSessions.length;
  const available = courseSessions.filter(session => session.status === "success").length;
  const pptAvailable = courseSessions.filter(session => session.ppt?.status === "available").length;
  const done = courseSessions.filter(session => session.status !== "pending" && session.status !== "loading" && session.ppt?.status !== "loading" && session.ppt?.status !== "pending").length;
  courseCount.textContent = "已检测 " + done + "/" + courseSessions.length + " · 逐字稿 " + available + "/" + courseSessions.length + " · PPT " + pptAvailable + "/" + courseSessions.length;
  const pptOnly = document.querySelector('input[name="course-format"]:checked')?.value === "zip" && settings.zipContents.ppt;
  courseAction.disabled = exportingCourse || !selected.length || done < courseSessions.length
    || (!selected.some(session => session.status === "success") && !(pptOnly && selected.some(session => session.ppt?.status === "available")));
  if (!exportingCourse) {
    courseAction.textContent = done < courseSessions.length ? "正在检测资源 " + done + " / " + courseSessions.length + "…" : "导出课程资料包（已选 " + selected.length + " 次）";
  }
}

function renderSessionDetails(session, index) {
  const details = document.createElement("div");
  details.className = "course-row-details";
  const count = document.createElement("p");
  count.textContent = "逐字稿：" + (session.status === "success" ? session.transcript.length + " 段" : ({ empty: "暂无", error: "获取失败" }[session.status] || "检测中"))
    + " · PPT：" + ({ available: "可下载", empty: "暂无", error: "获取失败" }[session.ppt?.status] || "检测中");
  details.append(count);
  const actions = document.createElement("div");
  actions.className = "course-row-actions";
  const addAction = (label, enabled, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = !enabled;
    button.addEventListener("click", onClick);
    actions.append(button);
  };
  addAction("预览逐字稿", session.status === "success", () => {
    coursePreviewKey = coursePreviewKey === index + ":transcript" ? "" : index + ":transcript";
    renderCourse();
  });
  addAction("预览 PPT", session.ppt?.status === "available", () => {
    coursePreviewKey = coursePreviewKey === index + ":ppt" ? "" : index + ":ppt";
    renderCourse();
    if (coursePreviewKey && !session.pptPreview) loadSessionPptPreview(session, index);
  });
  addAction("导出逐字稿", session.status === "success", () => downloadSessionTranscript(session));
  addAction("下载 PPT", session.ppt?.status === "available", event => downloadSessionPpt(session, event.currentTarget));
  details.append(actions);
  if (coursePreviewKey === index + ":transcript") {
    const panel = document.createElement("div");
    panel.className = "preview course-transcript-preview";
    panel.tabIndex = 0;
    fillTranscriptPreview(panel, session.transcript);
    details.append(panel);
  }
  if (coursePreviewKey === index + ":ppt") {
    const panel = document.createElement("div");
    panel.className = "course-ppt-preview";
    const preview = session.pptPreview;
    if (preview?.count) {
      const count = document.createElement("p");
      count.textContent = "共 " + preview.count + " 页";
      panel.append(count);
    }
    if (preview?.thumbnails?.length) {
      const images = document.createElement("div");
      images.className = "ppt-thumbnails";
      for (const [number, src] of preview.thumbnails.entries()) {
        const image = document.createElement("img");
        image.src = src;
        image.alt = "第 " + (number + 1) + " 页缩略图";
        image.loading = "lazy";
        images.append(image);
      }
      panel.append(images);
    } else {
      const empty = document.createElement("p");
      empty.textContent = !preview || preview.loading ? "正在读取预览…" : "暂无预览";
      panel.append(empty);
    }
    details.append(panel);
  }
  return details;
}

async function loadSessionPptPreview(session, index) {
  session.pptPreview = { loading: true };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: fetchPptPreview,
      args: [pageContext.courseId, session.subId]
    });
    session.pptPreview = injection.result;
  } catch (error) {
    console.error("无际 Edgeless：课次 PPT 预览失败", error);
    session.pptPreview = { count: 0, thumbnails: [] };
  }
  if (expandedSession === index && coursePreviewKey === index + ":ppt") renderCourse();
}

function downloadSessionTranscript(session) {
  const metadata = pageContext.metadata;
  const name = sanitizeFilename(sessionTitle(session.subTitle).replace(" · ", "_")) + ".md";
  downloadBlob(new Blob([makeSessionMarkdown(session, metadata)], { type: "text/markdown;charset=utf-8" }), name);
}

async function downloadSessionPpt(session, button) {
  button.disabled = true;
  button.textContent = "正在下载…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const fallback = session.pptFallback || (session.pptUrl ? { pathName: session.pptUrl } : null);
    const [found] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: findCourseware,
      args: [pageContext.courseId, session.subId, pageContext.kind === "living", fallback]
    });
    if (found.result.status !== "available") throw new Error("当前课次没有可下载的 PPT");
    const [downloaded] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: fetchPptBinary, args: [found.result.url]
    });
    const bytes = Uint8Array.from(atob(downloaded.result.base64), char => char.charCodeAt(0));
    const name = sanitizeFilename((found.result.fileName || sessionTitle(session.subTitle) + "_课件").replace(/\.pptx?$/i, "")) + downloaded.result.extension;
    downloadBlob(new Blob([bytes]), name);
    button.textContent = "已下载";
  } catch (error) {
    console.error("无际 Edgeless：单课 PPT 下载失败", error);
    button.textContent = "下载失败，重试";
  } finally {
    button.disabled = false;
  }
}

async function loadCourse() {
  if (courseSessions || courseLoadPromise) return courseLoadPromise;
  courseCount.textContent = "正在读取课次…";
  courseStatus.textContent = "";
  courseAction.disabled = true;
  courseLoadPromise = (async () => {
    if (currentLoadPromise) await currentLoadPromise;
    if (!pageContext?.courseId || (pageContext.kind === "living" && !pageContext.subId)) {
      const missingSession = pageContext?.kind === "living" && !pageContext.subId;
      document.getElementById("time").textContent = "无法读取";
      courseCount.textContent = missingSession ? "无法识别当前课次" : "无法识别课程 ID";
      courseStatus.textContent = missingSession
        ? "页面地址缺少 sub_id，请重新打开课次后重试。"
        : "请刷新回放页后重试；检查页面 URL 或 Network 中是否包含 course_id。";
      console.error("无际 Edgeless：无法从回放页定位 " + (missingSession ? "sub_id" : "course_id"));
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN",
        func: pageContext.kind === "living" ? fetchLivingCourseSchedule : fetchCourseSchedule,
        args: pageContext.kind === "living" ? [pageContext.courseId] : [pageContext.courseId, pageContext.courseType]
      });
      courseSessions = injection.result.map(item => ({
        ...item, selected: true, status: item.subId ? "pending" : "error", transcript: [],
        ppt: { status: item.subId ? "pending" : "error" }
      }));
      renderCourse();
      if (courseSessions.length === 0) {
        courseStatus.textContent = "这门课程暂未返回课次。";
        return;
      }
      courseScanPromise = scanCourse(tab.id, pageContext.kind === "living");
      await courseScanPromise;
    } catch (error) {
      console.error("无际 Edgeless：读取课程课次失败", error);
      document.getElementById("time").textContent = "读取失败";
      courseCount.textContent = "读取课次失败";
      courseStatus.textContent = "请刷新课程页面后重试。";
      courseAction.disabled = false;
      courseAction.textContent = "↻  重新读取课次";
    }
  })();
  try { await courseLoadPromise; } finally { courseLoadPromise = null; }
}

async function scanCourse(tabId, livingPage = false) {
  for (const session of courseSessions) {
    if (session.status !== "pending") continue;
    session.status = "loading";
    renderCourse();
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", func: fetchSessionTranscript,
        args: [session.subId, livingPage]
      });
      session.transcript = injection.result;
      session.status = session.transcript.length > 0 ? "success" : "empty";
    } catch (error) {
      session.status = "error";
      console.error("无际 Edgeless：课次 " + session.subId + " 逐字稿读取失败", error);
    }
    session.ppt = { status: "loading" };
    renderCourse();
    try {
      const fallback = session.pptFallback || (session.pptUrl ? { pathName: session.pptUrl } : null);
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId }, world: "MAIN", func: findCourseware,
        args: [pageContext.courseId, session.subId, livingPage, fallback]
      });
      session.ppt = injection.result;
    } catch (error) {
      session.ppt = { status: "error" };
      console.error("无际 Edgeless：课次 " + session.subId + " PPT 检测失败", error);
    }
    renderCourse();
  }
  const available = courseSessions.filter(session => session.status === "success").length;
  const pptAvailable = courseSessions.filter(session => session.ppt?.status === "available").length;
  courseStatus.textContent = available || pptAvailable
    ? "已检测：逐字稿 " + available + " 次 · PPT " + pptAvailable + " 次"
    : "当前课程暂未发现可导出的逐字稿或 PPT。";
}

async function exportCourse() {
  if (!courseSessions) {
    await loadCourse();
    if (!courseSessions) return;
  }
  if (exportingCourse) return;
  exportingCourse = true;
  courseAction.disabled = true;
  renderCourse();
  try {
    if (courseScanPromise) await courseScanPromise;
    const selected = courseSessions.filter(session => session.selected);
    if (!selected.length) {
      courseStatus.textContent = "请先勾选要导出的课次。";
      return;
    }
    const available = selected.filter(session => session.status === "success").length;
    const format = document.querySelector('input[name="course-format"]:checked').value;
    if (!available && (format !== "zip" || !settings.zipContents.ppt)) {
      courseStatus.textContent = "所选课次暂未发现可导出的逐字稿。";
      return;
    }
    const metadata = pageContext.metadata;
    const course = sanitizeFilename(metadata.course);
    courseAction.textContent = format === "zip" ? "正在生成 ZIP…" : "正在生成 Markdown…";
    const pptResult = format === "zip" && settings.zipContents.ppt
      ? await collectPptFiles(selected) : { files: [], missing: 0, failed: 0 };
    if (!available && !pptResult.files.length) {
      courseStatus.textContent = "所选课次没有可导出的逐字稿或 PPT。";
      return;
    }
    const blob = format === "zip"
      ? await makeCourseZip(selected, metadata, pptResult.files, selected.length === courseSessions.length)
      : new Blob([makeCombinedMarkdown(selected, metadata)], { type: "text/markdown;charset=utf-8" });
    if (!blob) {
      courseStatus.textContent = "未找到可加入课程资料包的文件。";
      return;
    }
    const partial = selected.length < courseSessions.length;
    downloadBlob(blob, course + (partial ? "_已选" + selected.length + "次" : "")
      + (format === "zip" ? "_课程资料包.zip" : partial ? "_逐字稿.md" : "_完整逐字稿.md"));
    courseStatus.textContent = "已导出所选逐字稿 " + available + " / " + selected.length + " 个课次"
      + (format === "zip" && settings.zipContents.ppt
        ? " · PPT 成功 " + pptResult.files.length + " · 暂无 " + pptResult.missing + " · 失败 " + pptResult.failed : "");
  } catch (error) {
    console.error("无际 Edgeless：整门课程导出失败", error);
    courseStatus.textContent = "导出失败，请重试。";
  } finally {
    exportingCourse = false;
    renderCourse();
  }
}

async function collectPptFiles(sessions = courseSessions) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const files = [];
  let missing = 0;
  let failed = 0;
  for (const [index, session] of sessions.entries()) {
    courseAction.textContent = "正在检查 PPT " + (index + 1) + " / " + sessions.length + "…";
    if (!session.subId) { failed++; continue; }
    try {
      const fallback = session.pptFallback || (session.pptUrl ? { pathName: session.pptUrl } : null);
      const [found] = await chrome.scripting.executeScript({
        target: { tabId: tab.id }, world: "MAIN", func: findCourseware,
        args: [pageContext.courseId, session.subId, pageContext.kind === "living", fallback]
      });
      const courseware = found.result;
      if (courseware.status === "empty") { missing++; continue; }
      if (courseware.status !== "available") { failed++; continue; }
      const [downloaded] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: fetchPptBinary, args: [courseware.url] });
      const prefix = String(index + 1).padStart(2, "0");
      const bytes = Uint8Array.from(atob(downloaded.result.base64), char => char.charCodeAt(0));
      files.push({ name: prefix + "_" + sanitizeFilename(sessionTitle(session.subTitle).replace(" · ", "_")) + downloaded.result.extension, bytes });
    } catch (error) {
      failed++;
      console.error("无际 Edgeless：课次 " + session.subId + " PPT 读取失败", error);
    }
  }
  return { files, missing, failed };
}

document.getElementById("current-mode").addEventListener("click", () => setMode("current"));
document.getElementById("course-mode").addEventListener("click", () => setMode("course"));
courseSelectAll.addEventListener("change", () => {
  if (!courseSessions) return;
  for (const session of courseSessions) session.selected = courseSelectAll.checked;
  courseStatus.textContent = courseSelectAll.checked ? "" : "请先勾选要导出的课次。";
  renderCourse();
});
transcriptCard.addEventListener("click", () => { if (transcript) setPreview("transcript"); });
pptCard.addEventListener("click", activatePptPreview);
async function activatePptPreview() {
  if (currentPpt?.status !== "available") return;
  setPreview("ppt");
  if (currentPptPreviewLoaded) return;
  currentPptPreviewLoaded = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await loadPptPreview(tab.id, detectionRevision);
  } catch (error) {
    console.error("无际 Edgeless：PPT 轻预览失败", error);
    document.getElementById("ppt-preview-empty").textContent = "暂无预览";
  }
}
document.getElementById("retry-detection").addEventListener("click", loadTranscript);
courseAction.addEventListener("click", exportCourse);
for (const input of document.querySelectorAll('input[name="course-format"]')) input.addEventListener("change", renderCourse);

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
      if (transcript) primaryAction.textContent = "导出逐字稿";
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

async function loadCurrentPpt(tabId, revision) {
  pptAction.disabled = true;
  pptAction.textContent = "下载 PPT";
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", func: findCourseware,
      args: [pageContext.courseId, pageContext.subId, pageContext.kind === "living", pageContext.pptFallback || null]
    });
    if (revision !== detectionRevision) return;
    currentPpt = injection.result;
    pptState = currentPpt.status;
    pptAction.disabled = currentPpt.status !== "available";
    pptAction.textContent = currentPpt.status === "available" ? "下载 PPT"
      : currentPpt.status === "empty" ? "暂无 PPT" : "PPT 获取失败";
    renderResourceStatus();
    if (currentPpt.status === "available") {
      if (transcriptState !== "loading" && transcriptState !== "success") activatePptPreview();
    }
  } catch (error) {
    if (revision !== detectionRevision) return;
    console.error("无际 Edgeless：检查当前课次 PPT 失败", error);
    pptState = "error";
    pptAction.textContent = "PPT 获取失败";
    renderResourceStatus();
  }
}

async function loadPptPreview(tabId, revision) {
  const thumbnails = document.getElementById("ppt-thumbnails");
  const empty = document.getElementById("ppt-preview-empty");
  thumbnails.replaceChildren();
  empty.textContent = "正在读取预览…";
  empty.hidden = false;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", func: fetchPptPreview,
      args: [pageContext.courseId, pageContext.subId]
    });
    if (revision !== detectionRevision) return;
    const result = injection.result;
    document.getElementById("ppt-page-count").textContent = result.count ? "共 " + result.count + " 页" : "";
    for (const [index, src] of result.thumbnails.entries()) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = "第 " + (index + 1) + " 页缩略图";
      image.loading = "lazy";
      thumbnails.append(image);
    }
    empty.textContent = "暂无预览";
    empty.hidden = result.thumbnails.length > 0;
  } catch (error) {
    if (revision !== detectionRevision) return;
    console.error("无际 Edgeless：PPT 轻预览失败", error);
    empty.textContent = "暂无预览";
  }
}

async function downloadCurrentPpt() {
  if (!currentPpt || currentPpt.status !== "available" || !pageContext) return;
  pptAction.disabled = true;
  pptAction.textContent = "正在下载 PPT…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [found] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: findCourseware,
      args: [pageContext.courseId, pageContext.subId, pageContext.kind === "living", pageContext.pptFallback || null]
    });
    const courseware = found.result;
    if (courseware.status !== "available") throw new Error("当前课次没有可下载的 PPT");
    const [downloaded] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, world: "MAIN", func: fetchPptBinary, args: [courseware.url]
    });
    const bytes = Uint8Array.from(atob(downloaded.result.base64), char => char.charCodeAt(0));
    const fallback = [pageContext.metadata.course, pageContext.metadata.date, pageContext.metadata.period, "课件"].filter(Boolean).join("_");
    const name = sanitizeFilename((courseware.fileName || fallback).replace(/\.pptx?$/i, "")) + downloaded.result.extension;
    downloadBlob(new Blob([bytes]), name);
    pptAction.textContent = "✓  已下载 PPT";
  } catch (error) {
    console.error("无际 Edgeless：下载当前课次 PPT 失败", error);
    pptAction.textContent = "PPT 下载失败，请重试";
  } finally {
    pptAction.disabled = false;
  }
}

pptAction.addEventListener("click", downloadCurrentPpt);

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
  if (choice.key === "defaultCourseExportFormat") {
    document.querySelector(`input[name="course-format"][value="${value}"]`).checked = true;
    if (value === "zip") zipDetails.open = true;
    renderCourse();
  }
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
  if (document.querySelector('input[name="course-format"]:checked')?.value === "zip") zipDetails.open = true;
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
    renderSettings();
    if (mode === "course") renderCourse();
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
    zipDetails.open = false;
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
  openInfo("使用帮助", "打开智云课堂回放页。旧版回放需先打开「语音识别」面板；新版课次可直接检测。当前课次可预览、单独导出逐字稿或下载 PPT；整门课程可按课次查看资源并导出整包。未检测到内容时可点击「重新检测」。");
});

async function loadTranscriptImpl() {
  const revision = ++detectionRevision;
  transcript = null;
  pageContext = null;
  currentPpt = null;
  currentPptPreviewLoaded = false;
  pptState = "loading";
  setPreview(null);
  showState("loading");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const livingPage = isLivingPage(tab?.url);
    if (!tab?.id || (!isReplayPage(tab.url) && !livingPage)) {
      properties.hidden = true;
      showState("error", "请打开受支持的智云课堂回放页面", "打开课程回放后重新检测。");
      return;
    }

    properties.hidden = false;

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: livingPage ? extractLivingTranscript : extractTranscript
    });
    const result = injection?.result;
    pageContext = result ? { ...result, kind: livingPage ? "living" : "legacy" } : null;
    renderMetadata(result?.metadata);
    if (pageContext?.courseId && pageContext?.subId) loadCurrentPpt(tab.id, revision);
    else { pptState = "empty"; renderResourceStatus(); }

    if (result?.success && result.items.length > 0) {
      transcript = result;
      renderPreview(result.items);
      showState("success");
      return;
    }

    if (result?.error === "MISSING_SESSION_ID") {
      showState("error", "无法识别当前课次", "页面地址缺少 course_id 或 sub_id，请重新打开课次后重试。");
    } else if (result?.error === "ACCESS_DENIED") {
      showState("error", "无法访问课程数据", "请确认已登录智云课堂，并且有权限查看该课次。");
    } else if (result?.error === "API_ERROR") {
      showState("error", "智云课堂接口返回失败", "请稍后重新检测；若持续失败，请检查课程页面是否仍可访问。");
    } else if (livingPage && result?.success) {
      showState("empty", "该课次暂无逐字稿", "当前课次接口未返回可导出的语音识别文本。");
    } else if (result?.error === "TRANSCRIPT_API_NOT_FOUND" || result?.success) {
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

