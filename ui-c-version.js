const state = {
  score: 85,
  guideIndex: 0,
  activePanel: null,
  audienceGroup: "女性",
  audienceType: "单人",
  modelOpacity: 20,
  outlineOpacity: 70
};

const guides = [
  {
    light: "脸再转向光源一点",
    pose: "手抬高一点更自然",
    camera: "手机略低更显高"
  },
  {
    light: "光线从侧前方进来更柔",
    pose: "肩膀放松，身体侧一点",
    camera: "手机与眼睛略低一点"
  },
  {
    light: "背景偏乱可轻度虚化",
    pose: "手臂离身体留点空隙",
    camera: "靠近人物，背景更干净"
  },
  {
    light: "避开头顶强光更自然",
    pose: "眼睛看镜头上方一点",
    camera: "镜头保持水平别歪"
  }
];

const panels = {
  color: {
    title: "色彩调整",
    html: `
      ${slider("亮度", 62)}
      ${slider("对比", 46)}
      ${slider("暖色", 58)}
      ${slider("饱和", 54)}
      ${slider("清透", 72)}
      ${slider("清晰", 60)}
    `
  },
  beauty: {
    title: "美颜美体",
    html: `
      ${slider("美白", 35)}
      ${slider("美肤", 42)}
      ${slider("瘦脸", 28)}
      ${slider("瘦腰", 22)}
      ${slider("长腿", 30)}
      ${slider("虚化", 26)}
    `
  },
  creative: {
    title: "创意设计",
    html: `
      <div class="chips">
        <button class="chip active" type="button">图片边框</button>
        <button class="chip" type="button">花朵贴纸</button>
        <button class="chip" type="button">文字排版</button>
        <button class="chip" type="button">日期水印</button>
        <button class="chip" type="button">手写标签</button>
        <button class="chip" type="button">氛围光效</button>
      </div>
    `
  }
};

function slider(label, value) {
  return `
    <label class="setting">
      <span>${label}</span>
      <input type="range" min="0" max="100" value="${value}" />
      <output>${value}</output>
    </label>
  `;
}

function showToast(text) {
  const toast = document.getElementById("toast");
  toast.textContent = text;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1200);
}

function updateGuide(tip) {
  const nextTip = typeof tip === "string"
    ? { light: tip, pose: "手抬高一点更自然", camera: "手机略低更显高" }
    : tip;
  document.getElementById("lightTip").textContent = nextTip.light;
  document.getElementById("poseTip").textContent = nextTip.pose;
  document.getElementById("cameraTip").textContent = nextTip.camera;
}

function updateScore(delta = 0) {
  state.score = Math.max(72, Math.min(98, state.score + delta));
  const ring = document.getElementById("scoreRing");
  document.getElementById("scoreValue").textContent = state.score;
  ring.style.setProperty("--score", state.score);
  ring.dataset.level = getScoreLevel(state.score);
}

function pulsePoseGuide() {
  const outline = document.getElementById("poseOutlineLayer");
  outline.classList.remove("pulse");
  void outline.offsetWidth;
  outline.classList.add("pulse");
}

function syncAudiencePicker() {
  document.getElementById("sceneValue").textContent = `${state.audienceGroup} · ${state.audienceType}`;
}

function syncPoseOpacity() {
  const viewfinder = document.getElementById("viewfinder");
  viewfinder.style.setProperty("--model-opacity", state.modelOpacity / 100);
  viewfinder.style.setProperty("--outline-opacity", state.outlineOpacity / 100);
  document.getElementById("modelOpacityRange").value = state.modelOpacity;
  document.getElementById("outlineOpacityRange").value = state.outlineOpacity;
  document.getElementById("modelOpacityValue").textContent = `${state.modelOpacity}%`;
  document.getElementById("outlineOpacityValue").textContent = `${state.outlineOpacity}%`;
}

function centerStyleButton(btn, behavior = "smooth") {
  if (!btn) return;
  const scroller = document.getElementById("styleTabs");
  const targetLeft = btn.offsetLeft - ((scroller.clientWidth - btn.offsetWidth) / 2);
  scroller.scrollTo({ left: targetLeft, behavior });
}

function getScoreLevel(score) {
  if (score < 60) return "待提高";
  if (score >= 90) return "棒极了";
  if (score >= 80) return "优秀";
  if (score >= 70) return "良好";
  return "待提高";
}

updateScore(0);
syncPoseOpacity();
closeFloatingPanels();

function syncRestoreAssist() {
  const scoreHidden = document.getElementById("scoreRing").classList.contains("overlay-hidden");
  const guideHidden = document.getElementById("guideBubble").classList.contains("overlay-hidden");
  document.getElementById("restoreAssist").classList.toggle("overlay-hidden", !scoreHidden && !guideHidden);
}

function closeFloatingPanels() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("opacityPicker").classList.add("overlay-hidden");
  document.getElementById("audiencePicker").classList.add("overlay-hidden");
  document.querySelectorAll(".bottom-tools button").forEach(item => item.classList.remove("active"));
}

document.addEventListener("click", (event) => {
  const closeBtn = event.target.closest("[data-close-overlay]");
  if (!closeBtn) return;
  event.preventDefault();
  event.stopPropagation();
  closeOverlay(closeBtn.dataset.closeOverlay);
}, true);

document.querySelectorAll("[data-close-overlay]").forEach((closeBtn) => {
  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeOverlay(closeBtn.dataset.closeOverlay);
  });
});

function closeOverlay(type) {
  if (type === "score") {
    document.getElementById("scoreRing").classList.add("overlay-hidden");
    showToast("已隐藏评分");
  }
  if (type === "guide") {
    document.getElementById("guideBubble").classList.add("overlay-hidden");
    showToast("已隐藏提示");
  }
  syncRestoreAssist();
}

document.getElementById("restoreAssist").addEventListener("click", () => {
  document.getElementById("scoreRing").classList.remove("overlay-hidden");
  document.getElementById("guideBubble").classList.remove("overlay-hidden");
  syncRestoreAssist();
  showToast("已恢复辅助提示");
});

function openPanel(panelKey) {
  const panel = panels[panelKey];
  if (!panel) return;
  document.querySelectorAll(".bottom-tools button").forEach(item => item.classList.remove("active"));
  const legacyButton = document.querySelector(`.bottom-tools button[data-panel="${panelKey}"]`);
  if (legacyButton) legacyButton.classList.add("active");
  state.activePanel = panelKey;
  document.getElementById("drawerTitle").textContent = panel.title;
  document.getElementById("drawerContent").innerHTML = panel.html;
  document.getElementById("drawer").classList.add("open");
}

document.getElementById("styleTabs").addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;
  document.querySelectorAll(".style-tabs button").forEach(item => item.classList.remove("active"));
  btn.classList.add("active");
  centerStyleButton(btn);
  updateScore(Math.round(Math.random() * 6 - 1));
  showToast(`已切换到「${btn.textContent}」风格`);
});

requestAnimationFrame(() => {
  centerStyleButton(document.querySelector(".style-tabs button.active"), "auto");
});

document.getElementById("poseGrid").addEventListener("click", (event) => {
  const card = event.target.closest(".pose-card");
  if (!card) return;
  document.querySelectorAll(".pose-card").forEach(item => item.classList.remove("active"));
  card.classList.add("active");
  document.getElementById("posePersonLayer").src = "./assets/ui-c-pose-person-user-viewport.png";
  document.getElementById("poseOutlineLayer").src = "./assets/ui-c-pose-outline-user-viewport.png";
  updateGuide({
    light: "脸再转向光源一点",
    pose: card.dataset.tip,
    camera: "手机略低更显高"
  });
  pulsePoseGuide();
  updateScore(3);
  showToast(card.dataset.title);
});

document.getElementById("guideBubble").addEventListener("click", () => {
  state.guideIndex = (state.guideIndex + 1) % guides.length;
  updateGuide(guides[state.guideIndex]);
  showToast("已换一条拍摄提醒");
});

document.getElementById("captureBtn").addEventListener("click", () => {
  updateScore(4);
  showToast("已模拟拍摄，当前画面合格");
});

document.getElementById("sceneBtn").addEventListener("click", () => {
  const picker = document.getElementById("audiencePicker");
  picker.classList.toggle("overlay-hidden");
  showToast(`姿势库：${state.audienceGroup} · ${state.audienceType}`);
});

document.getElementById("audiencePicker").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-picker]");
  if (!btn) return;

  const pickerType = btn.dataset.picker;
  const value = btn.dataset.value;
  document
    .querySelectorAll(`[data-picker="${pickerType}"]`)
    .forEach(item => item.classList.remove("active"));
  btn.classList.add("active");

  if (pickerType === "group") state.audienceGroup = value;
  if (pickerType === "type") state.audienceType = value;

  syncAudiencePicker();
  updateGuide({
    light: "已按当前环境匹配公园花丛",
    pose: `${state.audienceGroup}${state.audienceType}姿势库已更新`,
    camera: "继续参考红色轮廓调整姿势"
  });
  pulsePoseGuide();
  showToast(`已选择：${state.audienceGroup} · ${state.audienceType}`);
});

document.addEventListener("click", (event) => {
  const picker = document.getElementById("audiencePicker");
  if (
    picker.classList.contains("overlay-hidden") ||
    event.target.closest("#audiencePicker") ||
    event.target.closest("#sceneBtn")
  ) {
    return;
  }
  picker.classList.add("overlay-hidden");
});

document.getElementById("opacityBtn").addEventListener("click", () => {
  const picker = document.getElementById("opacityPicker");
  picker.classList.toggle("overlay-hidden");
  document.getElementById("audiencePicker").classList.add("overlay-hidden");
  document.getElementById("modelOpacityRange").focus();
  showToast("调节模特和边框透明度");
});

document.getElementById("opacityPicker").addEventListener("input", (event) => {
  if (event.target.id === "modelOpacityRange") {
    state.modelOpacity = Number(event.target.value);
  }
  if (event.target.id === "outlineOpacityRange") {
    state.outlineOpacity = Number(event.target.value);
  }
  syncPoseOpacity();
});

document.addEventListener("click", (event) => {
  const picker = document.getElementById("opacityPicker");
  if (
    picker.classList.contains("overlay-hidden") ||
    event.target.closest("#opacityPicker") ||
    event.target.closest("#opacityBtn")
  ) {
    return;
  }
  picker.classList.add("overlay-hidden");
});

document.querySelector(".bottom-tools").addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-panel]");
  if (!btn) return;
  document.getElementById("opacityPicker").classList.add("overlay-hidden");
  document.getElementById("audiencePicker").classList.add("overlay-hidden");
  openPanel(btn.dataset.panel);
});

document.querySelector(".reference-hotspots").addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;

  if (btn.dataset.style) {
    updateScore(1);
    showToast(`已切换到「${btn.dataset.style}」风格`);
    return;
  }

  if (btn.dataset.pose) {
    updateScore(3);
    const poseTips = {
      推荐姿势1: { light: "脸再转向光源一点", pose: "手抬高一点更自然", camera: "手机略低更显高" },
      推荐姿势2: { light: "光线从正前方更显肤色", pose: "下巴微收，笑容放松", camera: "镜头与眼睛平齐" },
      推荐姿势3: { light: "侧光会让轮廓更立体", pose: "身体侧向 30°，手臂留出弧度", camera: "脚靠近画面底部" },
      推荐姿势4: { light: "让头发边缘吃到光", pose: "肩膀放松，回头角度小一点", camera: "镜头稍微靠近人物" }
    };
    updateGuide(poseTips[btn.dataset.pose] || guides[0]);
    showToast(btn.dataset.pose);
    return;
  }

  if (btn.dataset.panel) {
    openPanel(btn.dataset.panel);
    showToast(`已打开「${panels[btn.dataset.panel].title}」`);
    return;
  }

  if (btn.dataset.action === "guide") {
    state.guideIndex = (state.guideIndex + 1) % guides.length;
    updateGuide(guides[state.guideIndex]);
    showToast("已换一条拍摄提醒");
    return;
  }

  if (btn.dataset.action === "scene") {
    showToast("识别到：公园、花丛、自然光");
    return;
  }

  if (btn.dataset.action === "capture") {
    updateScore(4);
    showToast("已模拟拍摄，当前画面 89 分");
    return;
  }

  if (btn.dataset.action === "import") {
    document.getElementById("opacityBtn").click();
  }
});

document.getElementById("closeDrawer").addEventListener("click", () => {
  document.getElementById("drawer").classList.remove("open");
  document.querySelectorAll(".bottom-tools button").forEach(item => item.classList.remove("active"));
});

document.getElementById("drawerContent").addEventListener("input", (event) => {
  if (event.target.type !== "range") return;
  event.target.parentElement.querySelector("output").textContent = event.target.value;
});

document.getElementById("drawerContent").addEventListener("click", (event) => {
  const chip = event.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll(".chip").forEach(item => item.classList.remove("active"));
  chip.classList.add("active");
  showToast(`已选择「${chip.textContent}」`);
});
