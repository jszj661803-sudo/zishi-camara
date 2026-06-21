const state = {
  mode: "人物",
  facingMode: "environment",
  stream: null,
  library: null,
  references: [],
  templates: [],
  currentReference: null,
  tipOffset: 0,
  metrics: {
    brightness: 0.56,
    sharpness: 0.58,
  },
};

const els = {
  video: document.querySelector("#cameraVideo"),
  canvas: document.querySelector("#analysisCanvas"),
  cameraState: document.querySelector("#cameraState"),
  scoreText: document.querySelector("#scoreText"),
  scoreBadge: document.querySelector("#scoreBadge"),
  templateName: document.querySelector("#templateName"),
  poseImage: document.querySelector("#poseImage"),
  mainTip: document.querySelector("#mainTip"),
  tipsList: document.querySelector("#tipsList"),
  diagnosisText: document.querySelector("#diagnosisText"),
  templateSelect: document.querySelector("#templateSelect"),
  sceneState: document.querySelector("#sceneState"),
  gridToggle: document.querySelector("#gridToggle"),
  poseToggle: document.querySelector("#poseToggle"),
  blurStrength: document.querySelector("#blurStrength"),
  blurPreview: document.querySelector("#blurPreview"),
  compositionScore: document.querySelector("#compositionScore"),
  poseScore: document.querySelector("#poseScore"),
  lightScore: document.querySelector("#lightScore"),
  sharpScore: document.querySelector("#sharpScore"),
  nextTipBtn: document.querySelector("#nextTipBtn"),
  captureBtn: document.querySelector("#captureBtn"),
  switchCameraBtn: document.querySelector("#switchCameraBtn"),
  modeButtons: Array.from(document.querySelectorAll(".mode-tabs button")),
};

const fallbackByMode = {
  风景: {
    name: "风景构图",
    userTips: ["地平线放在下方三分线。", "主体放在左侧或右侧三分线。", "保留一点前景，画面会更有层次。"],
    poseRules: [],
    cameraRules: ["手机保持水平。", "天空好看就多留天空。", "建筑可以稍微低机位拍。"],
  },
  静物: {
    name: "静物拍摄",
    userTips: ["靠近主体，背景保持干净。", "光从侧面来会更有质感。", "俯拍适合桌面小物。"],
    poseRules: [],
    cameraRules: ["手机和物体保持平行。", "画面边缘不要切到主体。", "背景杂乱时打开虚化。"],
  },
  室内: {
    name: "室内环境",
    userTips: ["站到窗边，脸朝向自然光。", "避开头顶强光。", "背景线条保持水平。"],
    poseRules: ["肩膀放松。", "脸轻微转向窗户。", "手可以扶杯子或椅背。"],
    cameraRules: ["手机与眼睛平齐。", "半身照更自然。", "背景虚化轻一点。"],
  },
  运动: {
    name: "运动抓拍",
    userTips: ["预留人物前进方向的空间。", "手机提前对准运动路线。", "连拍更容易抓到好动作。"],
    poseRules: ["身体向前，手臂自然摆动。", "眼神看前方。", "动作幅度稍微大一点。"],
    cameraRules: ["手机保持稳定。", "人物不要太贴边。", "光线不足时不要虚化太高。"],
  },
  自动: {
    name: "自动识别",
    userTips: ["第一版先按人物模式推荐。", "后续会接场景识别和姿态识别。", "当前可手动切换模板验证效果。"],
    poseRules: ["身体侧向一点。", "脸转回看镜头。", "手放在头发、口袋或包上。"],
    cameraRules: ["手机与眼睛平齐。", "全身照手机稍微降低。", "背景乱时打开虚化。"],
  },
};

async function loadLibrary() {
  const response = await fetch("./data/pose-library-100.json", { cache: "no-store" });
  state.library = await response.json();
  state.references = state.library.references || [];
  state.templates = state.library.templates || [];

  const seen = new Set();
  state.references.forEach((item) => {
    if (seen.has(item.templateName)) return;
    seen.add(item.templateName);
    const option = document.createElement("option");
    option.value = item.templateName;
    option.textContent = item.templateName;
    els.templateSelect.appendChild(option);
  });

  state.currentReference = state.references[0] || null;
  if (state.currentReference) {
    els.templateSelect.value = state.currentReference.templateName;
  }
  updateRecommendation();
}

async function startCamera() {
  stopCamera();
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      els.cameraState.textContent = "当前地址不支持直接调用摄像头。电脑可用 http://127.0.0.1:8016/，手机真机建议部署到 HTTPS 地址后测试。";
      return;
    }
    const constraints = {
      audio: false,
      video: {
        facingMode: state.facingMode,
        width: { ideal: 1280 },
        height: { ideal: 1920 },
      },
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    els.video.srcObject = state.stream;
    els.cameraState.textContent = "摄像头已打开，正在根据画面亮度和清晰度评分。";
  } catch (error) {
    els.cameraState.textContent = "摄像头暂时打不开：请允许相机权限。手机真机如果用局域网 HTTP 地址打不开，需要换成 HTTPS 地址测试。";
  }
}

function stopCamera() {
  if (!state.stream) return;
  state.stream.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

function sampleFrame() {
  if (!els.video.videoWidth || !els.video.videoHeight) return;
  const canvas = els.canvas;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const width = 96;
  const height = 128;
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(els.video, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  let lightTotal = 0;
  let edgeTotal = 0;
  let prev = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    lightTotal += gray;
    edgeTotal += Math.abs(gray - prev);
    prev = gray;
  }
  const pixels = data.length / 4;
  state.metrics.brightness = clamp(lightTotal / pixels / 255, 0, 1);
  state.metrics.sharpness = clamp(edgeTotal / pixels / 60, 0, 1);
}

function getActiveReference() {
  if (state.mode !== "人物") return null;
  const selected = els.templateSelect.value;
  const pool = state.references.filter((item) => item.templateName === selected);
  if (!pool.length) return state.references[0] || null;
  const index = state.tipOffset % pool.length;
  return pool[index];
}

function updateRecommendation() {
  const ref = getActiveReference();
  state.currentReference = ref;

  if (ref) {
    els.templateName.textContent = ref.templateName;
    els.poseImage.src = ref.image;
    els.poseImage.style.display = "block";
    const tips = buildTips(ref);
    els.mainTip.textContent = tips[0] || "先保持手机稳定，再微调姿势。";
    renderTips(tips.slice(1, 4));
    applyBeautyAdvice(ref);
  } else {
    const fallback = fallbackByMode[state.mode] || fallbackByMode.自动;
    els.templateName.textContent = fallback.name;
    els.poseImage.style.display = "none";
    const tips = [...fallback.userTips, ...fallback.cameraRules].slice(0, 4);
    els.mainTip.textContent = tips[0];
    renderTips(tips.slice(1));
  }

  updateBlurPreview();
  updateScore();
}

function buildTips(ref) {
  const sceneState = els.sceneState.value;
  const tips = [];
  if (sceneState === "messy") tips.push("背景有点乱，打开虚化会更突出人物。");
  if (sceneState === "close_bg") tips.push("人离背景远一点，虚化效果会更自然。");
  if (sceneState === "dark") tips.push("光线偏暗，虚化别开太高，边缘容易不自然。");

  const combined = [
    ...(ref.userTips || []),
    ...(ref.poseRules || []),
    ...(ref.cameraRules || []),
  ];
  combined.forEach((tip) => {
    if (tips.length < 4 && !tips.includes(tip)) tips.push(tip);
  });
  return tips.slice(0, 4);
}

function renderTips(tips) {
  els.tipsList.innerHTML = "";
  tips.slice(0, 3).forEach((tip) => {
    const li = document.createElement("li");
    li.textContent = tip;
    els.tipsList.appendChild(li);
  });
}

function applyBeautyAdvice(ref) {
  const beauty = ref.beautyAdvice || {};
  const blur = ref.backgroundBlurAdvice || {};
  setRange("blurStrength", blur.strength ?? 20);
  setRange("faceSlim", beauty.faceSlim ?? 10);
  setRange("skinWhiten", beauty.skinWhiten ?? 12);
  setRange("skinSmooth", beauty.skinSmooth ?? 14);
  setRange("waistSlim", beauty.waistSlim ?? 8);
  setRange("legLengthen", beauty.legLengthen ?? 18);
}

function setRange(id, value) {
  const el = document.querySelector(`#${id}`);
  if (el) el.value = value;
}

function updateScore() {
  const ref = state.currentReference;
  const sceneState = els.sceneState.value;
  const blur = Number(els.blurStrength.value || 0);
  const brightness = state.metrics.brightness;
  const sharpness = state.metrics.sharpness;

  let composition = 27;
  let pose = 27;
  let light = Math.round(10 + brightness * 10);
  let clear = Math.round(5 + sharpness * 5);

  if (ref) {
    composition += Math.round((ref.referenceQuality - 70) / 10);
    pose += ref.scoreBias || 0;
  }
  if (sceneState === "messy") composition -= blur > 15 ? 2 : 7;
  if (sceneState === "close_bg") composition -= blur > 45 ? 5 : 2;
  if (sceneState === "dark") light -= 4;
  if (blur > 70) clear -= 2;
  if (blur > 20 && sceneState === "messy") composition += 4;

  composition = clampInt(composition, 10, 35);
  pose = clampInt(pose, 12, 35);
  light = clampInt(light, 5, 20);
  clear = clampInt(clear, 4, 10);

  const total = clampInt(composition + pose + light + clear, 0, 100);
  els.compositionScore.textContent = composition;
  els.poseScore.textContent = pose;
  els.lightScore.textContent = light;
  els.sharpScore.textContent = clear;
  els.scoreText.textContent = total;

  let badgeText = "继续调整";
  let badgeClass = "bad";
  if (total >= 90) {
    badgeText = "很适合拍";
    badgeClass = "good";
  } else if (total >= 80) {
    badgeText = "合格可拍";
    badgeClass = "waiting";
  }
  els.scoreBadge.textContent = badgeText;
  els.scoreBadge.className = `score-badge ${badgeClass}`;
  els.diagnosisText.textContent = buildDiagnosis({ total, composition, pose, light, clear, sceneState, blur });
}

function buildDiagnosis(score) {
  const issues = [];
  if (score.light < 14) issues.push("光线需提高，建议靠近窗边或补一点正面光。");
  if (score.pose < 28) issues.push("姿势待优化，身体侧向一点，脸再转回看镜头。");
  if (score.composition < 29) issues.push("构图还可以更干净，人物脚底靠近画面底部，背景杂乱可开虚化。");
  if (score.clear < 8) issues.push("画面清晰度偏低，先稳住手机再拍。");
  if (score.sceneState === "close_bg") issues.push("人物离背景再远一点，虚化边缘会自然。");
  if (score.blur > 65 && score.light < 15) issues.push("虚化强度偏高，暗光下边缘容易不自然。");
  if (!issues.length) return "当前画面已经合格，可以拍。想更出片的话，让眼神看镜头上方一点。";
  return issues.slice(0, 2).join(" ");
}

function updateBlurPreview() {
  const value = Number(els.blurStrength.value || 0);
  const blurPx = Math.round(value / 12);
  els.blurPreview.style.opacity = value > 0 ? Math.min(0.24, value / 280) : 0;
  els.blurPreview.style.backdropFilter = `blur(${blurPx}px)`;
  els.blurPreview.style.webkitBackdropFilter = `blur(${blurPx}px)`;
}

function captureAndScore() {
  sampleFrame();
  updateScore();
  const total = Number(els.scoreText.textContent || 0);
  if (total >= 80) {
    els.cameraState.textContent = `本次评分 ${total}，已经达到合格线，可以拍。`;
  } else {
    els.cameraState.textContent = `本次评分 ${total}，先按下方提示再调整一下。`;
  }
}

function bindEvents() {
  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      document.body.dataset.mode = state.mode;
      els.modeButtons.forEach((btn) => btn.classList.toggle("active", btn === button));
      updateRecommendation();
    });
  });

  els.templateSelect.addEventListener("change", () => {
    state.tipOffset = 0;
    updateRecommendation();
  });
  els.sceneState.addEventListener("change", updateRecommendation);
  els.gridToggle.addEventListener("change", () => {
    document.body.dataset.gridLines = els.gridToggle.checked ? "on" : "off";
  });
  els.poseToggle.addEventListener("change", () => {
    document.body.dataset.poseLines = els.poseToggle.checked ? "on" : "off";
  });
  els.blurStrength.addEventListener("input", () => {
    updateBlurPreview();
    updateScore();
  });
  els.nextTipBtn.addEventListener("click", () => {
    state.tipOffset += 1;
    updateRecommendation();
  });
  els.captureBtn.addEventListener("click", captureAndScore);
  els.switchCameraBtn.addEventListener("click", async () => {
    state.facingMode = state.facingMode === "environment" ? "user" : "environment";
    await startCamera();
  });

  document.querySelectorAll(".slider-list input").forEach((input) => {
    input.addEventListener("input", updateScore);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value, min, max) {
  return Math.round(clamp(value, min, max));
}

async function init() {
  document.body.dataset.mode = state.mode;
  document.body.dataset.gridLines = "on";
  document.body.dataset.poseLines = "on";
  bindEvents();
  await loadLibrary();
  await startCamera();
  setInterval(() => {
    sampleFrame();
    updateScore();
  }, 1200);
}

init();
