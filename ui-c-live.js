/**
 * AI拍摄指导相机 C版 - 真机体验
 * C版UI + 摄像头 + MoveNet + 姿势数据库联动
 */
(function() {
'use strict';

// ============ State ============
var S = {
  stream: null, facingMode: 'user', cameraReady: false,
  detector: null, modelReady: false, scoreHistory: [],
  score: 0, guideIndex: 0, activePanel: null,
  lastDetectionTime: 0, modelLoadAttempts: 0,
  audienceGroup: '女性', audienceType: '单人', audiencePose: '全部', activeStyle: '推荐', activePose: null,
  autoScene: null, sceneFrameCount: 0, autoMode: false, flipOverlay: false,
  faceDetector: null, faceReady: false, faceData: null,
  modelOpacity: 20, outlineOpacity: 70,
  ctx: null, animFrame: null,
  poseLib: null, currentTemplates: [],
  imageCatalog: null // 分类图片资料库
};

// ============ DOM refs ============
function $(id) { return document.getElementById(id); }

// ============ MoveNet ============
async function initPoseDetector() {
  if (S.modelReady) return;
  updateLoading('正在加载AI姿态模型... (约需10秒)');
  try {
    await tf.ready();
    var model = poseDetection.SupportedModels.MoveNet;
    S.detector = await poseDetection.createDetector(model, {
      modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
      enableSmoothing: true
    });
    S.modelReady = true;
    updateLoading('MoveNet就绪，加载FaceMesh...');
  } catch (err) {
    updateLoading('模型加载失败，请刷新页面重试');
    throw err;
  }
}

async function initFaceMesh() {
  if (S.faceReady) return;
  try {
    if (typeof faceLandmarksDetection === 'undefined') {
      console.log('FaceMesh库未加载，跳过人脸检测');
      return;
    }
    var model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    S.faceDetector = await faceLandmarksDetection.createDetector(model, {
      runtime: 'tfjs',
      refineLandmarks: true,
      maxFaces: 1
    });
    S.faceReady = true;
    console.log('FaceMesh ready');
  } catch(e) {
    console.log('FaceMesh init failed:', e.message);
  }
}

// ============ Pose Library ============
async function loadPoseLibrary() {
  try {
    var resp = await fetch('./data/pose-library-100.json', { cache: 'no-store' });
    S.poseLib = await resp.json();
    console.log('Pose library loaded: ' + (S.poseLib.templates ? S.poseLib.templates.length : 0) + ' templates');
  } catch (e) {
    console.log('Pose library not available, using defaults');
    S.poseLib = null;
  }
}

async function loadImageCatalog() {
  try {
    var resp = await fetch('./data/generated-models/image-catalog.json', { cache: 'no-store' });
    S.imageCatalog = await resp.json();
    console.log('Image catalog loaded: ' + S.imageCatalog.length + ' classified images');
  } catch (e) {
    console.log('Image catalog not available, using placeholders');
    S.imageCatalog = null;
  }
}

/** Fisher-Yates 洗牌 */
function shuffleArray(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

/** 从 imageCatalog 中筛选当前 人群+类型+风格 的图片 */
function getImagesForSelection() {
  if (!S.imageCatalog || !S.imageCatalog.length) return [];
  return S.imageCatalog.filter(function(item) {
    if (item.audience !== S.audienceGroup) return false;
    if (item.type !== S.audienceType) return false;
    if (S.activeStyle !== '推荐' && item.style !== S.activeStyle) return false;
    return true;
  });
}

function getTemplatesForCurrentSelection() {
  if (!S.poseLib || !S.poseLib.templates) return [];
  // Filter by audience group mapping
  var templates = S.poseLib.templates;
  // Map audienceGroup to scene tags for filtering
  var sceneMap = {
    '女性': ['城市街拍','草地公园','海边','花丛','咖啡店','旅行打卡','夜景','室内氛围','花园','镜子自拍'],
    '男性': ['城市','街景','运动','旅行'],
    '孩童': ['公园','校园','运动','室内'],
    '多人': ['旅行打卡','海边','公园','城市街拍']
  };
  var allowedScenes = sceneMap[S.audienceGroup] || [];
  var filtered = templates.filter(function(t) {
    if (!t.sceneTags) return true;
    return t.sceneTags.some(function(tag) { return allowedScenes.indexOf(tag) >= 0; });
  });
  // Limit to 4
  return filtered.slice(0, 4);
}

// ========== 姿势卡片：从过滤后的资料库加载 ==========
function getCardsForStyle(activeStyle) {
  // 从 imageCatalog 中筛选匹配风格的图片
  var images = getImagesForSelection(); // audience + type + style 已过滤

  // 如果资料库有足够图片就用资料库，不够就用精选模板补足
  var items = [];
  var catalogSrc = (S.imageCatalog && S.imageCatalog.length > 0);

  if (catalogSrc && images.length >= 4) {
    // 资料库有 >=4 张，随机取4张
    images = shuffleArray(images).slice(0, 4);
    images.forEach(function(im) {
      var rel = im.rel_path ? im.rel_path.replace(/\\/g, '/') : '';
      var relCutout = im.rel_path_cutout ? im.rel_path_cutout.replace(/\\/g, '/') : '';
      var relOutline = im.rel_path_outline ? im.rel_path_outline.replace(/\\/g, '/') : '';
      items.push({
        img: rel ? './data/generated-models/' + rel : '',
        cutout: relCutout ? './data/generated-models/' + relCutout : '',
        outline: relOutline ? './data/generated-models/' + relOutline : '',
        name: im.scene || im.name || '',
        tip: (im.scene || '') + ' · ' + (im.style || '') + '风格',
        style: im.style
      });
    });
  } else {
    // 资料库不足4张，从精选模板补足
    var curated = [
      { img: './assets/ui-c-pose-1.png', outline: './data/generated-models/女性/单人/活泼/female_single_lively_002_outline.png',
        name: '显高全身照', tip: '手机降低到腰部，脚底靠近画面底部。', styles: ['活泼','通勤'] },
      { img: './assets/ui-c-pose-2.png', outline: './data/generated-models/女性/单人/痞帅/female_single_cool_001_outline.png',
        name: '城市侧身街拍', tip: '身体侧向30度，脸转回看镜头。', styles: ['痞帅','酷帅','轻熟'] },
      { img: './assets/ui-c-pose-3.png', outline: './data/generated-models/女性/单人/甜美/female_single_sweet_001_outline.png',
        name: '花丛氛围照',   tip: '蹲姿或坐姿，手轻扶花朵。',       styles: ['甜美'] },
      { img: './assets/ui-c-pose-4.png', outline: './data/generated-models/女性/单人/活泼/female_single_lively_001_outline.png',
        name: '走路抓拍',     tip: '预留前进方向，脚刚落地时按快门。', styles: ['活泼','痞帅'] },
    ];
    // 优先匹配风格
    var matched = curated.filter(function(t) { return t.styles.indexOf(activeStyle) >= 0; });
    var others = curated.filter(function(t) { return matched.indexOf(t) < 0; });
    var combined = matched.concat(others).slice(0, 4);
    combined.forEach(function(t) { items.push({ img: t.img, outline: t.outline || t.img, name: t.name, tip: t.tip, style: activeStyle }); });

    // 同时混入资料库图片（如果有1-3张）
    if (catalogSrc && images.length > 0) {
      images = shuffleArray(images);
      for (var k = 0; k < Math.min(images.length, items.length); k++) {
        var rel = images[k].rel_path ? images[k].rel_path.replace(/\\/g, '/') : '';
        if (rel) items[k] = {
          img: './data/generated-models/' + rel,
          name: images[k].scene || images[k].name || '',
          tip: (images[k].scene || '') + ' · ' + (images[k].style || '') + '风格',
          style: images[k].style
        };
      }
    }
  }
  return items;
}

function updatePoseCards() {
  var grid = $('poseGrid');
  if (!grid) return;

  var items = getCardsForStyle(S.activeStyle);

  grid.innerHTML = '';
  items.forEach(function(item, i) {
    var card = document.createElement('button');
    card.className = 'pose-card' + (i === 0 ? ' active' : '');
    card.type = 'button';
    card.dataset.title = item.name;
    card.dataset.tip = item.tip;
    card.dataset.imageSrc = item.cutout || item.img;  // 优先用抠图
    card.dataset.rawSrc = item.img;                    // 原始图
    card.dataset.outlineSrc = item.outline || '';

    var img = document.createElement('img');
    img.src = item.img;
    img.alt = item.name;
    img.onerror = function() { this.src = './assets/ui-c-pose-1.png'; };

    var span = document.createElement('span');
    span.textContent = item.name;

    card.appendChild(img);
    card.appendChild(span);
    grid.appendChild(card);
  });

  if (items.length > 0) {
    S.activePose = items[0].name;
    if ($('poseGuide')) $('poseGuide').textContent = items[0].tip;
  }
}

// ============ Camera ============
async function startCamera() {
  stopCamera();
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      updateLoading('需要HTTPS或localhost才能使用摄像头');
      return;
    }
    var constraints = {
      audio: false,
      video: {
        facingMode: S.facingMode,
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30 }
      }
    };
    S.stream = await navigator.mediaDevices.getUserMedia(constraints);
    $('cameraVideo').srcObject = S.stream;
    await new Promise(function(r) { $('cameraVideo').onloadedmetadata = r; });
    await $('cameraVideo').play();

    var canvas = $('poseCanvas');
    canvas.width = $('cameraVideo').videoWidth;
    canvas.height = $('cameraVideo').videoHeight;
    S.ctx = canvas.getContext('2d');
    S.cameraReady = true;
    updateLoading('摄像头就绪，正在检测姿势...');
    detectLoop();
    console.log('Camera ready');
  } catch (err) {
    updateLoading('摄像头权限被拒绝，请在浏览器设置中允许');
    console.error('Camera error:', err);
  }
}

function stopCamera() {
  S.cameraReady = false;
  if (S.animFrame) { cancelAnimationFrame(S.animFrame); S.animFrame = null; }
  if (S.stream) { S.stream.getTracks().forEach(function(t) { t.stop(); }); S.stream = null; }
  if (S.ctx) { S.ctx.clearRect(0, 0, $('poseCanvas').width, $('poseCanvas').height); }
  updateLoading('摄像头已暂停');
  $('scoreValue').textContent = '--';
}

async function switchCamera() {
  S.facingMode = S.facingMode === 'user' ? 'environment' : 'user';
  if (S.cameraReady) await startCamera();
}

function updateLoading(msg) {
  var el = $('cameraState');
  if (el) el.textContent = msg;
}

// ============ 综合评分系统：姿势(60%) + 光线(20%) + 相机(20%) ============
var SKELETON_EDGES = [
  [5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],
  [0,1],[0,2],[1,3],[2,4],[3,5],[4,6]
];
var KP_NAMES = ['nose','left_eye','right_eye','left_ear','right_ear',
  'left_shoulder','right_shoulder','left_elbow','right_elbow',
  'left_wrist','right_wrist','left_hip','right_hip',
  'left_knee','right_knee','left_ankle','right_ankle'];

async function detectLoop() {
  if (!S.cameraReady) return;
  try {
    var video = $('cameraVideo');
    var canvas = $('poseCanvas');
    var pose = null;

    if (S.modelReady && S.detector) {
      var poses = await S.detector.estimatePoses(video, { flipHorizontal: false });
      if (poses && poses.length > 0) pose = poses[0];
    } else if (!S.modelReady) {
      updateLoading('模型加载中... ' + (S.modelLoadAttempts || 0) + 's');
      S.modelLoadAttempts = (S.modelLoadAttempts || 0) + 1;
    }

    // FaceMesh 检测（每5帧，轻量）
    if (S.faceReady && S.faceDetector && S.sceneFrameCount % 5 === 0) {
      try {
        var faces = await S.faceDetector.estimateFaces(video);
        S.faceData = (faces && faces.length > 0) ? analyzeFace(faces[0]) : null;
      } catch(e) {}
    }

    // 1. 光线分析（从视频帧采样，不依赖姿势）
    var lightScore = sampleLighting(video, canvas);

    // 场景识别（每60帧≈2秒检测一次）
    S.sceneFrameCount++;
    if (S.sceneFrameCount % 60 === 0) {
      var scene = detectScene(video, canvas);
      if (scene && scene !== S.autoScene) {
        S.autoScene = scene;
        if (S.autoMode) updatePoseCards();
        updateLoading((S.autoScene || '') + (S.modelReady ? '' : '·模型加载中'));
      }
    }

    // 自动模式：实时检测姿态（每15帧≈0.5秒）
    if (S.autoMode && pose && pose.keypoints && S.sceneFrameCount % 15 === 0) {
      var kp2 = extractKeypoints(pose);
      if (kp2) {
        var detectedPose = autoDetectPose(kp2);
        if (detectedPose && detectedPose !== S.audiencePose) {
          S.audiencePose = detectedPose;
          syncAudience();
          updatePoseCards();
          showToast('识别: ' + detectedPose);
        }
      }
    }

    // 2. 姿势 + 相机分析（依赖关键点）
    var postureScore = null, cameraScore = null;
    if (pose && pose.keypoints && pose.keypoints.length >= 11) {
      var kp = extractKeypoints(pose);
      if (kp) {
        postureScore = analyzePosture(kp);
        cameraScore = analyzeCamera(kp, canvas.width, canvas.height);
      }
    }

    // 3. 综合评分
    S.ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (postureScore) {
      drawSkeleton(pose.keypoints);
      var total = computeOverall(postureScore, lightScore, cameraScore);
      updateScoreDisplay(total);
      S.lastDetectionTime = Date.now();
    } else if (S.modelReady && Date.now() - (S.lastDetectionTime || 0) > 3000) {
      updateLoading('未检测到人体，请对准摄像头');
    }
  } catch(e) { console.log('detect error:', e.message); }
  S.animFrame = requestAnimationFrame(detectLoop);
}

// ========== 工具函数 ==========
function extractKeypoints(pose) {
  var kp = {};
  for (var i = 0; i < pose.keypoints.length; i++) {
    var pt = pose.keypoints[i];
    if (pt.name && pt.score > 0.2) kp[pt.name] = { x: pt.x, y: pt.y, score: pt.score };
  }
  if (!kp.nose) return null;
  if (!kp.left_shoulder && !kp.right_shoulder) return null;
  return kp;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ========== 1. 光线分析 (25%) ==========
function sampleLighting(video, canvas) {
  try {
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    var frame = ctx.getImageData(0, 0, w, h);
    var d = frame.data;
    var sx = Math.floor(w*0.3), ex = Math.floor(w*0.7);
    var sy = Math.floor(h*0.15), ey = Math.floor(h*0.55);
    var vals = [];
    for (var y = sy; y < ey; y += 2) {
      for (var x = sx; x < ex; x += 2) {
        var i = (y*w + x)*4;
        vals.push(d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114);
      }
    }
    if (!vals.length) return { score: 50, brightness: 0, contrast: 0 };
    var avg = vals.reduce(function(a,b){return a+b;},0) / vals.length;
    var variance = vals.reduce(function(s,v){return s+(v-avg)*(v-avg);},0) / vals.length;
    var std = Math.sqrt(variance);

    var brightScore;
    if (avg < 30) brightScore = Math.round(avg/30 * 20 + 5);
    else if (avg < 60) brightScore = Math.round(25 + (avg-30)/30 * 45);
    else if (avg <= 200) brightScore = Math.round(70 + (avg-60)/140 * 30);
    else if (avg <= 240) brightScore = Math.round(100 - (avg-200)/40 * 35);
    else brightScore = Math.round(Math.max(15, 65 - (avg-240)/30 * 50));

    var contrastScore;
    if (std < 10) contrastScore = Math.round(std/10 * 50 + 10);
    else if (std <= 50) contrastScore = Math.round(60 + (std-10)/40 * 40);
    else contrastScore = Math.round(Math.max(20, 100 - (std-50)/30 * 80));

    return {
      score: Math.round(brightScore*0.6 + contrastScore*0.4),
      brightness: Math.round(avg), contrast: Math.round(std),
      brightScore: brightScore, contrastScore: contrastScore
    };
  } catch(e) { return { score: 50, brightness: 0, contrast: 0 }; }
}

// ========== 场景自动识别（颜色启发式，每2秒刷新） ==========
function detectScene(video, canvas) {
  try {
    var ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    var w = canvas.width, h = canvas.height;
    var frame = ctx.getImageData(0, 0, w, h);
    var d = frame.data;
    var totalPixels = w * h;
    var colorBins = { blue: 0, green: 0, warm: 0, dark: 0, colorful: 0 };
    var totalBrightness = 0;

    // 隔4个像素采样加速
    for (var i = 0; i < d.length; i += 16) {
      var r = d[i], g = d[i+1], b = d[i+2];
      var brightness = r*0.299 + g*0.587 + b*0.114;
      totalBrightness += brightness;

      if (brightness < 40) colorBins.dark++;
      if (b > r + 20 && b > g + 10) colorBins.blue++;
      if (g > r + 20 && g > b + 10) colorBins.green++;
      if (r > 150 && g > 100 && b < g) colorBins.warm++;
      if (Math.max(r,g,b) - Math.min(r,g,b) > 100) colorBins.colorful++;
    }

    var samples = totalPixels / 4; // 每4像素采1个
    var avgBrightness = totalBrightness / samples;
    var darkRatio = colorBins.dark / samples;
    var blueRatio = colorBins.blue / samples;
    var greenRatio = colorBins.green / samples;
    var warmRatio = colorBins.warm / samples;
    var colorfulRatio = colorBins.colorful / samples;

    // 分类逻辑
    if (darkRatio > 0.45 && avgBrightness < 60) return '夜景';
    if (blueRatio > 0.25) return '海边';
    if (greenRatio > 0.30) return '草地公园';
    if (colorfulRatio > 0.20) return '花丛';
    if (warmRatio > 0.25 && avgBrightness < 160) return '室内';
    return '城市街拍';
  } catch(e) { return null; }
}

// ========== FaceMesh 面部分析 ==========
function analyzeFace(face) {
  var kp = face.keypoints; // 478点（含虹膜）
  if (!kp || kp.length < 400) return null;

  // 嘴唇关键点：上唇中点(13), 下唇中点(14), 左嘴角(61), 右嘴角(291)
  var lipTop = kp[13], lipBot = kp[14], lipL = kp[61], lipR = kp[291];
  var mouthOpen = lipTop && lipBot ? Math.abs(lipBot.y - lipTop.y) : 0;
  var mouthWidth = lipL && lipR ? Math.abs(lipR.x - lipL.x) : 1;
  var mouthRatio = mouthOpen / (mouthWidth + 1);

  // 微笑：嘴角宽度 vs 嘴唇张开度
  var smiling = mouthRatio > 0.08 && mouthWidth > 15;
  var mouthOpenWide = mouthRatio > 0.25;

  // 虹膜追踪：左虹膜(468-472), 右虹膜(473-477)
  var leftIris = kp[468], rightIris = kp[473];
  var leftEyeC = kp[33], rightEyeC = kp[263]; // 眼中心
  var gazeX = 0, gazeY = 0;
  if (leftIris && rightIris && leftEyeC && rightEyeC) {
    var ldx = leftIris.x - leftEyeC.x, rdx = rightIris.x - rightEyeC.x;
    var ldy = leftIris.y - leftEyeC.y, rdy = rightIris.y - rightEyeC.y;
    gazeX = (ldx + rdx) / 2;
    gazeY = (ldy + rdy) / 2;
  }

  // 面部朝向（鼻尖 vs 面部边缘中点）
  var nose = kp[1], faceL = kp[234], faceR = kp[454];
  var yaw = 0;
  if (nose && faceL && faceR) {
    var faceMidX = (faceL.x + faceR.x) / 2;
    yaw = (nose.x - faceMidX) / (Math.abs(faceR.x - faceL.x) + 1);
  }

  return {
    smiling: smiling,
    mouthOpen: mouthOpenWide,
    gazeX: gazeX, gazeY: gazeY,
    yaw: yaw,
    mouthRatio: mouthRatio
  };
}

// ========== 自动姿态检测（MoveNet → 站/坐/蹲） ==========
function autoDetectPose(kp) {
  if (!kp.left_hip && !kp.right_hip) return null;
  var hip = kp.left_hip || kp.right_hip;
  var knee = kp.left_knee || kp.right_knee;
  var ankle = kp.left_ankle || kp.right_ankle;
  var sw = (kp.left_shoulder && kp.right_shoulder) ? Math.abs(kp.right_shoulder.x - kp.left_shoulder.x) : 60;
  var legLen = (ankle && hip) ? ankle.y - hip.y : 999;

  // 蹲姿：髋低于膝
  if (knee && hip && hip.y > knee.y - 15) return '蹲姿';
  // 坐姿：腿压缩
  if (legLen < sw * 1.2) return '坐姿';
  // 站姿
  if (legLen >= sw * 1.2) return '站姿';
  return null;
}

// ========== 2. 相机位置分析 (20%) ==========
function analyzeCamera(kp, frameW, frameH) {
  var faceW = 60, faceH = 80;
  if (kp.left_eye && kp.right_eye) {
    var ed = Math.abs(kp.right_eye.x - kp.left_eye.x);
    faceW = ed * 3.5; faceH = ed * 4.5;
  }
  if (kp.left_ear && kp.right_ear) {
    faceW = Math.max(faceW, Math.abs(kp.right_ear.x - kp.left_ear.x) * 2.2);
  }
  var far = (faceW * faceH) / (frameW * frameH);

  var distScore;
  if (far < 0.01) distScore = Math.round(far/0.01 * 30);
  else if (far < 0.03) distScore = Math.round(30 + (far-0.01)/0.02 * 40);
  else if (far <= 0.15) distScore = Math.round(70 + (far-0.03)/0.12 * 30);
  else if (far <= 0.30) distScore = Math.round(100 - (far-0.15)/0.15 * 50);
  else distScore = Math.round(Math.max(10, 50 - (far-0.30)/0.20 * 40));

  var offC = Math.abs(kp.nose.x - frameW/2) / (frameW/2);
  var centerScore = Math.round(Math.max(10, 100 - offC * 90));

  var eyeY = kp.left_eye ? kp.left_eye.y : (kp.right_eye ? kp.right_eye.y : kp.nose.y - 30);
  var er = eyeY / frameH;
  var angleScore;
  if (er < 0.15) angleScore = Math.round(Math.max(10, er/0.15 * 50));
  else if (er < 0.28) angleScore = Math.round(50 + (er-0.15)/0.13 * 40);
  else if (er <= 0.40) angleScore = Math.round(90 + (er-0.28)/0.12 * 10);
  else if (er <= 0.55) angleScore = Math.round(100 - (er-0.40)/0.15 * 50);
  else angleScore = Math.round(Math.max(10, 50 - (er-0.55)/0.45 * 40));

  return {
    score: Math.round(distScore*0.40 + centerScore*0.30 + angleScore*0.30),
    distScore: distScore, centerScore: centerScore, angleScore: angleScore,
    distance: far < 0.03 ? '远' : far > 0.20 ? '近' : '适中',
    angle: er < 0.25 ? '仰' : er > 0.48 ? '俯' : '平'
  };
}

// ========== 3. 姿势分析 (50%) ==========
function analyzePosture(kp) {
  var n=kp.nose;
  var le=kp.left_ear, re=kp.right_ear;
  var ls=kp.left_shoulder, rs=kp.right_shoulder;

  var headScore = 70;
  if (le && re) {
    var tilt = Math.abs(Math.atan2(re.y-le.y, re.x-le.x)*180/Math.PI);
    headScore = Math.round(clamp(100 - tilt * 2.5, 0, 100));
  }

  var shoulderScore = 70, shoulderMidY = null;
  if (ls && rs) {
    var sAngle = Math.abs(Math.atan2(rs.y-ls.y, rs.x-ls.x)*180/Math.PI);
    shoulderScore = Math.round(clamp(100 - sAngle * 2.5, 0, 100));
    shoulderMidY = (ls.y+rs.y)/2;
  } else if (ls || rs) { shoulderMidY = (ls||rs).y; }

  var forwardScore = 50;
  if (shoulderMidY !== null) {
    var sw = (ls && rs) ? Math.abs(rs.x-ls.x) : 50;
    forwardScore = Math.round(clamp((shoulderMidY - n.y) / (sw + 1) * 180 + 25, 15, 100));
  }

  var symScore = 70;
  if (ls && rs) {
    var ld = Math.abs(n.x - ls.x), rd = Math.abs(rs.x - n.x);
    var ratio = ld > 0 ? Math.min(ld, rd) / Math.max(ld, rd) : 0;
    symScore = Math.round(clamp(ratio * 100, 10, 100));
  }

  // 姿势匹配度：基于当前选中的姿势名称特征
  var matchScore = 70;
  var ap = S.activePose || '';
  if (ap.indexOf('侧身') >= 0 && ls && rs) {
    var sr = Math.abs(rs.x-ls.x) / ((ls.y+rs.y)/2 + 1);
    matchScore = sr < 0.08 ? 90 : sr < 0.15 ? 70 : 40;
  } else if ((ap.indexOf('显高') >= 0 || ap.indexOf('全身') >= 0) && n) {
    matchScore = n.y < 200 ? 90 : n.y < 350 ? 70 : 45;
  } else if ((ap.indexOf('蹲') >= 0 || ap.indexOf('坐') >= 0) && shoulderMidY) {
    matchScore = shoulderMidY > 350 ? 90 : shoulderMidY > 250 ? 70 : 45;
  }

  return {
    score: Math.round(headScore*0.20 + shoulderScore*0.20 + forwardScore*0.25 + symScore*0.15 + matchScore*0.20),
    headScore: headScore, shoulderScore: shoulderScore, forwardScore: forwardScore,
    symScore: symScore, matchScore: matchScore
  };
}

// ========== 综合 ==========
function computeOverall(posture, lighting, camera) {
  var p = posture ? posture.score : 50;
  var l = lighting ? lighting.score : 50;
  var c = camera ? camera.score : 50;
  var total = Math.round(p*0.60 + l*0.20 + c*0.20);
  S.scoreHistory.push(total);
  if (S.scoreHistory.length > 10) S.scoreHistory.shift();
  var smoothed = Math.round(S.scoreHistory.reduce(function(a,b){return a+b;},0) / S.scoreHistory.length);
  return { total: total, smoothed: smoothed, posture: p, lighting: l, camera: c,
           postureDetail: posture, lightingDetail: lighting, cameraDetail: camera };
}

function drawSkeleton(keypoints) {
  var ctx = S.ctx; if (!ctx) return;
  ctx.lineWidth = 2;
  for (var e = 0; e < SKELETON_EDGES.length; e++) {
    var edge = SKELETON_EDGES[e], a = keypoints[edge[0]], b = keypoints[edge[1]];
    if (a && b && a.score>0.3 && b.score>0.3) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(233,69,96,' + (Math.min(a.score,b.score)*0.9) + ')';
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
  }
  for (var i = 0; i < keypoints.length; i++) {
    var pt = keypoints[i];
    if (pt.score>0.3 && KP_NAMES.slice(0,13).indexOf(pt.name)>=0) {
      ctx.beginPath(); ctx.arc(pt.x,pt.y,4,0,2*Math.PI);
      ctx.fillStyle = 'rgba(233,69,96,'+pt.score+')'; ctx.fill();
    }
  }
}

function updateScoreDisplay(result) {
  var score = result.smoothed;
  S.score = score;
  $('scoreValue').textContent = score;

  var level = score>=90?'棒极了':score>=75?'优秀':score>=60?'良好':score>=40?'待提高':'需调整';
  $('scoreRing').dataset.level = level;

  // 三维分项提示
  var p = result.postureDetail;
  var l = result.lightingDetail;
  var c = result.cameraDetail;
  var sceneTag = S.autoScene ? ' [' + S.autoScene + ']' : '';
  updateLoading(level + ': ' + score + '分 | 姿' + result.posture + ' 光' + result.lighting + ' 镜' + result.camera + sceneTag);

  // 1. 姿势提醒
  var poseText = '';
  if (p) {
    var pp = [];
    if (p.forwardScore < 50) pp.push('抬头挺胸');
    else if (p.forwardScore < 70) pp.push('头再抬高一点');
    if (p.headScore < 60) pp.push('头摆正');
    if (p.shoulderScore < 60) pp.push('肩膀放松放平');
    if (p.symScore < 60) pp.push('身体正对镜头');
    poseText = pp.length > 0 ? pp.join('，') : '姿势良好，继续保持';
  } else {
    poseText = '请对准摄像头';
  }
  if ($('poseGuide')) $('poseGuide').textContent = poseText;

  // 2. 面容提醒（FaceMesh实时 > 风格静态）
  var faceText = '';
  if (S.faceData) {
    if (S.faceData.mouthOpen) faceText = '嘴巴微张，自然闭合嘴唇';
    else if (S.faceData.smiling) faceText = '微笑很好，保持自然';
    else faceText = '嘴角微微上扬，保持微笑';
  } else {
    var styleMap = STYLE_FACE_EYE[S.activeStyle] || STYLE_FACE_EYE['推荐'];
    faceText = styleMap.face;
  }
  if ($('faceGuide')) $('faceGuide').textContent = faceText;

  // 3. 眼神提醒（FaceMesh实时 > 风格静态）
  var eyeText = '';
  if (S.faceData && (Math.abs(S.faceData.gazeX) > 2 || Math.abs(S.faceData.gazeY) > 2)) {
    var gx = S.faceData.gazeX, gy = S.faceData.gazeY;
    if (Math.abs(gx) > Math.abs(gy)) eyeText = gx > 0 ? '眼神偏右，向左看' : '眼神偏左，向右看';
    else eyeText = gy > 0 ? '眼神偏下，向上看' : '眼神偏上，向下看';
  } else if (S.faceData) {
    eyeText = '眼神正中，非常自然';
  } else {
    var sm = STYLE_FACE_EYE[S.activeStyle] || STYLE_FACE_EYE['推荐'];
    eyeText = sm.eye;
  }
  if ($('eyeGuide')) $('eyeGuide').textContent = eyeText;

  // 4. 光线提醒
  var lightText = '光线适中';
  if (l) {
    if (l.brightness < 40) lightText = '光线偏暗，建议开灯或补光';
    else if (l.brightness < 70) lightText = '光线略暗，靠近窗户或光源';
    else if (l.brightness > 220) lightText = '光线过亮，避开强光直射';
    else if (l.brightness > 190) lightText = '光线略亮，可换个柔和位置';
    else lightText = '光线适中，效果最佳';
  }
  if ($('lightGuide')) $('lightGuide').textContent = lightText;

  // 相机构图建议（状态栏显示）
  var tips = [];
  if (c) {
    if (c.distScore < 40) tips.push(c.distance==='远'?'靠近摄像头':'后退一点');
    if (c.angleScore < 40) tips.push(c.angle==='俯'?'手机抬高点':'手机放低点');
    if (c.centerScore < 40) tips.push('人脸居中');
  }
}

// ============ Photo Capture ============
async function capturePhoto() {
  if (!S.cameraReady) { showToast('请先开启摄像头'); return; }
  var vw = $('cameraVideo').videoWidth, vh = $('cameraVideo').videoHeight;
  var canvas = document.createElement('canvas');
  canvas.width = vw; canvas.height = vh;
  var ctx = canvas.getContext('2d');

  // 镜像绘制
  ctx.translate(vw,0); ctx.scale(-1,1);
  ctx.drawImage($('cameraVideo'),0,0,vw,vh);
  ctx.setTransform(1,0,0,1,0,0);

  // 美颜：美白 + 磨皮
  if (beautyValues.whiten > 5 || beautyValues.smooth > 5) {
    var imgData = ctx.getImageData(0, 0, vw, vh);
    var d = imgData.data;

    // 脸部区域遮罩（如果有FaceMesh数据）
    var faceMask = null;
    if (S.faceData && S.kp) {
      // 用面部椭圆36点构建简单遮罩
      faceMask = new Uint8Array(vw * vh);
    }

    for (var i = 0; i < d.length; i += 4) {
      // 美白：提亮RGB + 增强蓝色通道
      if (beautyValues.whiten > 5) {
        var w = beautyValues.whiten / 100;
        d[i] = Math.min(255, d[i] + w * 20 + w * 10);     // R
        d[i+1] = Math.min(255, d[i+1] + w * 15);           // G
        d[i+2] = Math.min(255, d[i+2] + w * 25);           // B 增强更多=冷白
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // 磨皮：整体轻度模糊
    if (beautyValues.smooth > 5) {
      var blurLevel = beautyValues.smooth / 100 * 3;
      if (blurLevel > 0.3) {
        ctx.filter = 'blur(' + blurLevel.toFixed(1) + 'px)';
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
      }
    }
  }

  // 美体塑形：瘦脸 + 瘦腰 + 拉腿 + 背景虚化（基于关键点）
  if (beautyValues.faceSlim > 5 || beautyValues.waistSlim > 5 || beautyValues.legLength > 5 || beautyValues.blur > 5) {
    // 获取当前帧的关键点（从最后一次检测）
    var bodyKp = null;
    if (S.modelReady && S.detector) {
      try {
        var poses = await S.detector.estimatePoses($('cameraVideo'), { flipHorizontal: false });
        if (poses && poses.length > 0) bodyKp = extractKeypoints(poses[0]);
      } catch(e) {}
    }

    // === 瘦脸 ===
    if (beautyValues.faceSlim > 5 && bodyKp) {
      var nosePt = bodyKp.nose;
      var lsPt = bodyKp.left_shoulder, rsPt = bodyKp.right_shoulder;
      if (nosePt && (lsPt || rsPt)) {
        var faceCX = nosePt.x, faceCY = nosePt.y - 15;
        var faceR = (lsPt && rsPt) ? Math.abs(rsPt.x - lsPt.x) * 0.35 : 50;
        faceR = Math.max(faceR, 35);
        var slim = beautyValues.faceSlim / 100 * 0.12; // 最多缩12%
        var sr = 1 - slim;

        // 在脸区域绘制缩小版（左右各缩一点）
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(faceCX, faceCY, faceR * 1.2, faceR * 1.4, 0, 0, Math.PI * 2);
        ctx.clip();
        // 水平方向缩小
        var sx = faceCX - faceR * 1.2, sy = faceCY - faceR * 1.6;
        var sw = faceR * 2.4, sh = faceR * 3.2;
        var offsetX = faceR * 1.2 * slim;
        ctx.drawImage(canvas, sx, sy, sw, sh, sx + offsetX, sy, sw * sr, sh);
        ctx.restore();
      }
    }

    // === 瘦腰 ===
    if (beautyValues.waistSlim > 5 && bodyKp) {
      var ls = bodyKp.left_shoulder, rs = bodyKp.right_shoulder;
      var lh = bodyKp.left_hip, rh = bodyKp.right_hip;
      if (ls && rs && lh && rh) {
        var waistTop = Math.min(ls.y, rs.y) + 30;
        var waistBot = Math.max(lh.y, rh.y);
        var waistH = waistBot - waistTop;
        var waistX = Math.min(ls.x, rs.x, lh.x, rh.x);
        var waistW = Math.max(ls.x, rs.x, lh.x, rh.x) - waistX;
        var ws = beautyValues.waistSlim / 100 * 0.15; // 最多缩15%

        ctx.save();
        ctx.beginPath();
        ctx.rect(waistX - 10, waistTop, waistW + 20, waistH);
        ctx.clip();
        var shrinkW = waistW * ws;
        ctx.drawImage(canvas, waistX - 10, waistTop, waistW + 20, waistH,
                      waistX - 10 + shrinkW / 2, waistTop, waistW + 20 - shrinkW, waistH);
        ctx.restore();
      }
    }

    // === 拉腿 ===
    if (beautyValues.legLength > 5 && bodyKp) {
      var lh2 = bodyKp.left_hip, rh2 = bodyKp.right_hip;
      var la = bodyKp.left_ankle, ra = bodyKp.right_ankle;
      var hipY = (lh2 && rh2) ? Math.max(lh2.y, rh2.y) : (lh2 || rh2 || {y: vh/2}).y;
      var ankleY = (la && ra) ? Math.max(la.y, ra.y) : vh;
      if (ankleY > hipY + 50) {
        var legH = ankleY - hipY;
        var stretch = 1 + beautyValues.legLength / 100 * 0.2; // 最多拉长20%
        var legTop = hipY - 10;
        var legBot = ankleY + 20;

        // 下半部分拉伸
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, legTop, vw, legBot - legTop);
        ctx.clip();
        ctx.drawImage(canvas, 0, legTop, vw, legBot - legTop,
                     0, legTop, vw, (legBot - legTop) * stretch);
        ctx.restore();

        // 上半部分保持不变，去除重叠
      }
    }
  }

  // === 人像背景虚化 ===
  if (beautyValues.blur > 5) {
    var maskCanvas2 = document.createElement('canvas');
    maskCanvas2.width = vw; maskCanvas2.height = vh;
    var mCtx2 = maskCanvas2.getContext('2d');
    mCtx2.fillStyle = '#000'; mCtx2.fillRect(0, 0, vw, vh);
    mCtx2.fillStyle = '#fff';

    if (bodyKp && bodyKp.nose) {
      var n2 = bodyKp.nose;
      var lh4 = bodyKp.left_hip, rh4 = bodyKp.right_hip;
      var ls4 = bodyKp.left_shoulder, rs4 = bodyKp.right_shoulder;
      var cx2 = n2.x;
      var cy2 = n2.y + 30;
      var rx2 = (ls4 && rs4) ? Math.abs(rs4.x - ls4.x) * 0.75 : 50;
      var rh = (lh4 || rh4) ? Math.max((lh4||rh4).y - n2.y, 80) + 40 : 200;
      rx2 = Math.max(rx2, 35);
      mCtx2.beginPath();
      mCtx2.ellipse(cx2, cy2 + rh/2, rx2 * 1.05, rh/2 + 10, 0, 0, Math.PI*2);
      mCtx2.fill();
    }

    var blurC2 = document.createElement('canvas'); blurC2.width = vw; blurC2.height = vh;
    var bCtx2 = blurC2.getContext('2d');
    var bp = Math.max(3, beautyValues.blur / 100 * 12);
    bCtx2.filter = 'blur(' + bp.toFixed(1) + 'px)';
    bCtx2.drawImage(canvas, 0, 0);
    bCtx2.filter = 'none';

    var sd2 = ctx.getImageData(0, 0, vw, vh);
    var bd2 = bCtx2.getImageData(0, 0, vw, vh);
    var md2 = mCtx2.getImageData(0, 0, vw, vh);
    var od2 = ctx.createImageData(vw, vh);

    for (var j = 0; j < md2.data.length; j += 4) {
      var ratio = Math.min(1, Math.max(0, md2.data[j] / 255));
      od2.data[j] = sd2.data[j] * ratio + bd2.data[j] * (1 - ratio);
      od2.data[j+1] = sd2.data[j+1] * ratio + bd2.data[j+1] * (1 - ratio);
      od2.data[j+2] = sd2.data[j+2] * ratio + bd2.data[j+2] * (1 - ratio);
      od2.data[j+3] = 255;
    }
    ctx.putImageData(od2, 0, 0);
  }

  // 创意设计叠加
  if (creativeMode === '画框') {
    var frameW = Math.min(vw, vh) * 0.03;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = frameW;
    ctx.strokeRect(frameW/2, frameW/2, vw - frameW, vh - frameW);
  }
  if (creativeMode === '日期戳') {
    var now = new Date();
    var dateStr = now.getFullYear()+'-'+(now.getMonth()+1)+'-'+now.getDate();
    ctx.font = Math.round(vw*0.05)+'px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, vw - 20, vh - 20);
  }
  if (creativeMode === '文字') {
    ctx.font = Math.round(vw*0.06)+'px -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'center';
    ctx.fillText('AI Camera', vw/2, vh - 30);
  }

  var a = document.createElement('a');
  a.download = 'pose-photo-'+Date.now()+'.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  showToast('已保存! 评分:'+S.score);
}

// ============ Toast ============
function showToast(text) {
  var t = $('toast'); t.textContent = text; t.classList.add('show');
  clearTimeout(showToast.tid);
  showToast.tid = setTimeout(function(){ t.classList.remove('show'); }, 1500);
}

// ========== 风格→面容/眼神映射 ==========
var STYLE_FACE_EYE = {
  '酷帅': { face: '表情冷峻自然，嘴角微收', eye: '不看镜头，望向远方' },
  '甜美': { face: '保持温柔微笑，表情放松', eye: '自然看镜头或轻闭眼' },
  '活泼': { face: '开心笑容，表情自然大方', eye: '眼含笑意，自然有神' },
  '轻熟': { face: '优雅从容，表情淡然放松', eye: '柔和注视，避开镜头' },
  '优雅': { face: '端庄大方，面部肌肉放松', eye: '平视前方，眼神自信' },
  '通勤': { face: '干练自信，保持自然表情', eye: '直视镜头，目光坚定' },
  '痞帅': { face: '表情冷峻，嘴角微收', eye: '不看镜头，望向远方' },
  '推荐': { face: '面部自然，保持放松状态', eye: '眼神自然，略带笑意' }
};

// ============ UI Interactions ============
function syncPoseOpacity() {
  $('posePersonLayer').style.setProperty('--model-opacity', S.modelOpacity/100);
  $('viewfinder').style.setProperty('--model-opacity', S.modelOpacity/100);
  $('viewfinder').style.setProperty('--outline-opacity', S.outlineOpacity/100);
  $('modelOpacityRange').value = S.modelOpacity;
  $('outlineOpacityRange').value = S.outlineOpacity;
  $('modelOpacityValue').textContent = S.modelOpacity+'%';
  $('outlineOpacityValue').textContent = S.outlineOpacity+'%';
}

function syncAudience() {
  var label = S.audienceGroup + ' · ' + S.audienceType;
  if (S.audiencePose && S.audiencePose !== '全部') label += ' · ' + S.audiencePose;
  $('sceneValue').textContent = label;
}

function centerStyleBtn(btn, behavior) {
  if (!btn) return;
  var scroller = $('styleTabs');
  scroller.scrollTo({ left: btn.offsetLeft - (scroller.clientWidth-btn.offsetWidth)/2, behavior: behavior });
}

// Style tabs
$('styleTabs').addEventListener('click', function(e) {
  var btn = e.target.closest('button');
  if (!btn) return;
  var all = document.querySelectorAll('.style-tabs button');
  for (var i=0;i<all.length;i++) all[i].classList.remove('active');
  btn.classList.add('active');
  S.activeStyle = btn.textContent;
  centerStyleBtn(btn, 'smooth');
  updatePoseCards();
  showToast('Style: ' + btn.textContent);
});

// Pose cards
$('poseGrid').addEventListener('click', function(e) {
  var card = e.target.closest('.pose-card');
  if (!card) return;
  var all = document.querySelectorAll('.pose-card');
  for (var i=0;i<all.length;i++) all[i].classList.remove('active');
  card.classList.add('active');
  S.activePose = card.dataset.title;
  if ($('poseGuide')) $('poseGuide').textContent = card.dataset.tip;
  // 更新取景框覆盖层：模特图 + 轮廓图联动
  if (card.dataset.imageSrc) {
    $('posePersonLayer').src = card.dataset.imageSrc;
  }
  if (card.dataset.outlineSrc) {
    $('poseOutlineLayer').src = card.dataset.outlineSrc;
  } else if (card.dataset.imageSrc) {
    // 没有专用轮廓图时用模特图代替（CSS opacity 会区分）
    $('poseOutlineLayer').src = card.dataset.imageSrc;
  }
  showToast(card.dataset.title);
});

// Scene/audience picker
$('sceneBtn').addEventListener('click', function() {
  $('audiencePicker').classList.toggle('overlay-hidden');
  $('opacityPicker').classList.add('overlay-hidden');
});

$('audiencePicker').addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-picker]');
  if (!btn) return;
  var all = document.querySelectorAll('[data-picker="'+btn.dataset.picker+'"]');
  for (var i=0;i<all.length;i++) all[i].classList.remove('active');
  btn.classList.add('active');
  if (btn.dataset.picker==='group') S.audienceGroup = btn.dataset.value;
  if (btn.dataset.picker==='type') S.audienceType = btn.dataset.value;
  if (btn.dataset.picker==='pose') S.audiencePose = btn.dataset.value;
  syncAudience();
  updatePoseCards();
  showToast(S.audienceGroup + ' · ' + S.audienceType + ' · ' + S.audiencePose);
});

// Opacity
$('opacityBtn').addEventListener('click', function() {
  $('opacityPicker').classList.toggle('overlay-hidden');
  $('audiencePicker').classList.add('overlay-hidden');
});

$('opacityPicker').addEventListener('input', function(e) {
  if (e.target.id==='modelOpacityRange') S.modelOpacity = +e.target.value;
  if (e.target.id==='outlineOpacityRange') S.outlineOpacity = +e.target.value;
  syncPoseOpacity();
});

// Click outside to close
document.addEventListener('click', function(e) {
  if (!e.target.closest('#audiencePicker') && !e.target.closest('#sceneBtn'))
    $('audiencePicker').classList.add('overlay-hidden');
  if (!e.target.closest('#opacityPicker') && !e.target.closest('#opacityBtn'))
    $('opacityPicker').classList.add('overlay-hidden');
});

// Guide bubble（点击收起，再点展开）
$('guideBubble').addEventListener('click', function(e) {
  if (e.target.closest('.guide-close')) return; // 关闭按钮单独处理
  var lines = this.querySelectorAll('.guide-line');
  var hidden = lines[1].style.display === 'none';
  for (var i = 1; i < lines.length; i++) {
    lines[i].style.display = hidden ? '' : 'none';
  }
  showToast(hidden ? '展开全部提示' : '收起，仅显示姿势提醒');
});

// Close overlays
document.addEventListener('click', function(e) {
  var closeBtn = e.target.closest('[data-close-overlay]');
  if (!closeBtn) return;
  var type = closeBtn.dataset.closeOverlay;
  if (type==='score') { $('scoreRing').classList.add('overlay-hidden'); showToast('Score hidden'); }
  if (type==='guide') { $('guideBubble').classList.add('overlay-hidden'); showToast('Guide hidden'); }
  $('restoreAssist').classList.toggle('overlay-hidden',
    !$('scoreRing').classList.contains('overlay-hidden')||!$('guideBubble').classList.contains('overlay-hidden'));
});

// Restore assist
$('restoreAssist').addEventListener('click', function() {
  $('scoreRing').classList.remove('overlay-hidden');
  $('guideBubble').classList.remove('overlay-hidden');
  $('restoreAssist').classList.add('overlay-hidden');
  showToast('Assist restored');
});

// Bottom tools drawer
var colorValues = { brightness: 62, contrast: 46, warmth: 58, saturation: 54, clarity: 72, sharpness: 60 };
var beautyValues = { whiten: 35, smooth: 42, faceSlim: 28, waistSlim: 22, legLength: 30, blur: 26 };
var creativeMode = 'Frame';

var panels = {
  color: {
    title: '色彩调整',
    html: slider('亮度',colorValues.brightness,'brightness')+slider('对比度',colorValues.contrast,'contrast')+
          slider('色温',colorValues.warmth,'warmth')+slider('饱和度',colorValues.saturation,'saturation')+
          slider('清晰度',colorValues.clarity,'clarity')+slider('锐度',colorValues.sharpness,'sharpness')
  },
  beauty: {
    title: '美颜美体',
    html: slider('美白',beautyValues.whiten,'whiten')+slider('磨皮',beautyValues.smooth,'smooth')+
          slider('瘦脸',beautyValues.faceSlim,'faceSlim')+slider('瘦腰',beautyValues.waistSlim,'waistSlim')+
          slider('拉腿',beautyValues.legLength,'legLength')+slider('虚化',beautyValues.blur,'blur')
  },
  creative: {
    title: '创意设计',
    html: '<div class="chips">'+['画框','日期戳','文字','贴纸','手写','发光'].map(function(c){
      return '<button class="chip'+(c===creativeMode?' active':'')+'" type="button" data-creative="'+c+'">'+c+'</button>';
    }).join('')+'</div>'
  }
};

function slider(label, val, key) {
  return '<label class="setting"><span>'+label+'</span><input type="range" min="0" max="100" value="'+val+'" data-key="'+key+'" /><output>'+val+'</output></label>';
}
function applyVideoFilters() {
  var v = $('cameraVideo');
  if (!v) return;
  var filters = [];
  // 色彩调整
  filters.push('brightness(' + (colorValues.brightness/50) + ')'); // 0-200%
  filters.push('contrast(' + (colorValues.contrast/50) + ')');
  filters.push('sepia(' + (colorValues.warmth/200) + ')'); // warmth → sepia
  filters.push('saturate(' + (colorValues.saturation/50) + ')');
  v.style.filter = filters.join(' ');
}

// 连接 Color + Beauty 滑块
$('drawerContent').addEventListener('input', function(e) {
  if (e.target.type!=='range') return;
  e.target.parentElement.querySelector('output').textContent = e.target.value;
  var key = e.target.dataset.key;
  if (key) {
    if (key in colorValues) colorValues[key] = +e.target.value;
    if (key in beautyValues) beautyValues[key] = +e.target.value;
    applyVideoFilters();
  }
});

document.querySelector('.bottom-tools').addEventListener('click', function(e) {
  var btn = e.target.closest('button[data-panel]');
  if (!btn) return;
  var all = document.querySelectorAll('.bottom-tools button');
  for (var i=0;i<all.length;i++) all[i].classList.remove('active');
  btn.classList.add('active');
  var panel = panels[btn.dataset.panel];
  if (!panel) return;
  $('drawerTitle').textContent = panel.title;
  $('drawerContent').innerHTML = panel.html;
  $('drawer').classList.add('open');
});

$('closeDrawer').addEventListener('click', function() { $('drawer').classList.remove('open'); });

$('drawerContent').addEventListener('input', function(e) {
  if (e.target.type!=='range') return;
  e.target.parentElement.querySelector('output').textContent = e.target.value;
});
$('drawerContent').addEventListener('click', function(e) {
  var chip = e.target.closest('.chip');
  if (!chip) return;
  var all = document.querySelectorAll('.chip');
  for (var i=0;i<all.length;i++) all[i].classList.remove('active');
  chip.classList.add('active');
  showToast('Selected: '+chip.textContent);
});

// ============ Button bindings ============
$('btnStartCamera').addEventListener('click', async function() {
  $('btnStartCamera').style.display = 'none';
  $('btnStopCamera').style.display = 'inline-block';
  updateLoading('Loading AI model...');
  try {
    await initPoseDetector();
    initFaceMesh(); // 异步加载，不阻塞
    await startCamera();
    updateLoading('就绪');
  } catch(err) {
    updateLoading('Start failed, please refresh');
    $('btnStartCamera').style.display = 'inline-block';
    $('btnStopCamera').style.display = 'none';
  }
});

$('btnStopCamera').addEventListener('click', function() {
  stopCamera();
  $('btnStartCamera').style.display = 'inline-block';
  $('btnStopCamera').style.display = 'none';
});

$('btnSwitchCamera').addEventListener('click', switchCamera);
$('captureBtnLive').addEventListener('click', capturePhoto);
$('reshuffleBtn').addEventListener('click', function() {
  updatePoseCards();
  showToast('已换一批');
});

// 翻转叠加层按钮
$('flipBtn').addEventListener('click', function() {
  S.flipOverlay = !S.flipOverlay;
  if (S.flipOverlay) {
    $('viewfinder').classList.add('flip-overlay');
    $('flipBtn').style.background = '#e94560';
    $('flipBtn').style.color = '#fff';
  } else {
    $('viewfinder').classList.remove('flip-overlay');
    $('flipBtn').style.background = '';
    $('flipBtn').style.color = '';
  }
  showToast(S.flipOverlay ? '已翻转' : '已还原');
});

// 自动模式按钮
$('autoBtn').addEventListener('click', function() {
  S.autoMode = !S.autoMode;
  if (S.autoMode) {
    $('autoBtn').classList.add('active');
    $('autoBtn').textContent = '自动中';
    showToast('自动识别已开启');
  } else {
    $('autoBtn').classList.remove('active');
    $('autoBtn').textContent = '自动';
    showToast('已切回手动');
  }
});

// Lifecycle
document.addEventListener('visibilitychange', function() {
  if (document.hidden && S.cameraReady) stopCamera();
});
window.addEventListener('beforeunload', function() { stopCamera(); });

// ============ Init ============
syncPoseOpacity();
syncAudience();
requestAnimationFrame(function() {
  centerStyleBtn(document.querySelector('.style-tabs button.active'), 'auto');
});
// 同时加载模板库和分类图片资料库
Promise.all([loadPoseLibrary(), loadImageCatalog()]).then(function() {
  updatePoseCards();
});
updatePoseCards();

console.log('AI Camera C-Live ready');
})();
