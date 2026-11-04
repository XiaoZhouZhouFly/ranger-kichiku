  const APP_VERSION = "v6.0";
  const LOCAL = "data/";
  // 自製測試角色放在 custom/（不含官方素材，不受每日同步影響）
  const CUSTOM = "custom/", customIds = new Set();
  const baseOf = (id) => (customIds.has(id) ? CUSTOM : LOCAL);
  // 預設角色（官方資料改名或移除時會依序退回下一個，全部找不到就任選）
  const DEFAULT_UNIT = "u362e-blast";
  const DEFAULT_LEFT = [DEFAULT_UNIT];
  const DEFAULT_RIGHT = ["u010u-clara", "u1001u-brown"];
  const FPS = 30; // 時間軸的影格率：單人惡搞剪輯與雙人對戰都用這個（錄影也是）

  const CLIPS = [
    { key: "idle", label: "待機", names: ["idle", "wait"] },
    { key: "move", label: "移動", names: ["walk"] },
    { key: "attack", label: "一般攻擊", names: ["attack_all", "attack", "attack_a", "attack_b"] },
    { key: "skill1", label: "技能1", names: ["s_attack_all", "s_action_attack_all", "s_attack", "s_attack_a", "s_attack_b", "s_action_attack_2", "s_action_attack_3"] },
    { key: "skill2", label: "技能2", names: ["s2_attack_all", "s2_attack", "s2_attack_a", "s2_attack_b", "skill"] },
    { key: "knockback", label: "被擊退", names: ["knockback"] },
  ];
  const PART_LABEL = { body: "本體", bul: "投射物・普攻", bul2: "投射物・技能1", bul3: "投射物・技能2" };
  const BG = { white: "#ffffff", black: "#000000", green: "#00b140", transparent: null };

  const $ = (id) => document.getElementById(id);
  const cv = $("cv");
  const ctx = cv.getContext("2d");

  const S = {
    index: [], skills: {}, proj: {}, stats: {}, fx: {}, projOn: true, projPlan: null, clipN: 0, bul: {},
    unit: null, meta: null, partKey: "body", part: null, animName: null,
    atlas: null, sprites: new Map(), hueCache: new Map(),
    bounds: null, centers: [],
    comps: {}, segs: [],
    mode: "orig", playing: true, speed: 1, camZoom: 1, follow: false, loop: true,
    bg: "white", panX: 0, panY: 0,
    pos: 0, lastTs: 0, timeline: [],
    recording: false, audioBuf: null, audioUrl: null,
    clock: { abs: null, ref: null, st: null }, // 播放音效的時鐘（見 js-05）
    urlSync: { on: false, timer: 0 }, // 網址列同步（見 js-16 syncUrl）
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem("rk_" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("rk_" + k, JSON.stringify(v)); } catch {} },
  };

