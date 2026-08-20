export interface OfficialEmojiItem {
  id: string;
  name: string;
  keywords: readonly string[];
  src: string;
}

const rawBase = (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
const basePrefix = rawBase.endsWith("/") ? rawBase : `${rawBase}/`;

export function getEmojiUrl(id: string): string {
  return `${basePrefix}images/emoji/${id}.png`;
}

interface RawEmojiDef {
  id: string;
  name: string;
  keywords: readonly string[];
}

const RAW_EMOJI_DEFS: readonly RawEmojiDef[] = [
  { id: "ok", name: "OK", keywords: ["ok", "好的", "没问题"] },
  { id: "thumbs_up", name: "点赞", keywords: ["thumbs_up", "赞", "好", "666"] },
  { id: "hand_ok", name: "手势OK", keywords: ["hand_ok", "ok", "手势"] },
  { id: "applause", name: "鼓掌", keywords: ["applause", "guzhang", "拍手", "好样"] },
  { id: "fist_bump", name: "碰拳", keywords: ["fist_bump", "pengquan", "兄弟", "合作"] },
  { id: "plus_one", name: "+1", keywords: ["plus_one", "+1", "赞同", "附议"] },
  { id: "get", name: "收到", keywords: ["get", "shoudao", "明白", "收到"] },
  { id: "blush", name: "害羞", keywords: ["blush", "haixiu", "脸红"] },
  { id: "laugh", name: "大笑", keywords: ["laugh", "daxiao", "哈哈", "开心"] },
  { id: "smile", name: "微笑", keywords: ["smile", "weixiao", "笑"] },
  { id: "support", name: "支持", keywords: ["support", "zhichi", "加油", "给力"] },
  { id: "whimper", name: "委屈", keywords: ["whimper", "weiqu", "可怜"] },
  { id: "obsessed", name: "花痴", keywords: ["obsessed", "huachi", "崇拜"] },
  { id: "show_off", name: "得意", keywords: ["show_off", "deyi", "炫耀"] },
  { id: "adoration", name: "爱慕", keywords: ["adoration", "aimu", "喜欢"] },
  { id: "tongue", name: "吐舌", keywords: ["tongue", "tushe", "调皮"] },
  { id: "terror", name: "惊恐", keywords: ["terror", "jingkong", "害怕"] },
  { id: "sob", name: "大哭", keywords: ["sob", "daku", "流泪", "难过"] },
  { id: "toasted", name: "裂开", keywords: ["toasted", "liekai", "崩溃"] },
  { id: "angry", name: "生气", keywords: ["angry", "shengqi", "发怒"] },
  { id: "apathy", name: "无语", keywords: ["apathy", "wuyu", "冷漠", "翻白眼"] },
  { id: "lol", name: "爆笑", keywords: ["lol", "baoxiao", "笑死", "233"] },
  { id: "disbelief", name: "难以置信", keywords: ["disbelief", "zhixin", "震惊", "问号"] },
  { id: "kiss", name: "亲亲", keywords: ["kiss", "qinqin", "飞吻"] },
  { id: "scrunch", name: "嫌弃", keywords: ["scrunch", "xianqi", "鄙视"] },
  { id: "dizzy", name: "头晕", keywords: ["dizzy", "touyun", "晕"] },
  { id: "sleep", name: "睡觉", keywords: ["sleep", "shuijiao", "晚安", "困"] },
  { id: "strive", name: "奋斗", keywords: ["strive", "fendou", "努力", "加油"] },
  { id: "shocked", name: "吃惊", keywords: ["shocked", "chijing", "惊呆"] },
  { id: "phone_frustrated", name: "看手机", keywords: ["phone_frustrated", "shouji", "地铁老人"] },
  { id: "facepalm", name: "捂脸", keywords: ["facepalm", "wulian", "无奈"] },
  { id: "hug", name: "抱抱", keywords: ["hug", "baobao", "拥抱"] },
  { id: "see_no_evil", name: "不看", keywords: ["see_no_evil", "bukan", "遮眼", "害羞"] },
  { id: "speak_no_evil", name: "不说", keywords: ["speak_no_evil", "bushuo", "闭嘴", "保密"] },
  { id: "hear_no_evil", name: "不听", keywords: ["hear_no_evil", "buting", "捂耳"] },
  { id: "fist_greet", name: "抱拳", keywords: ["fist_greet", "baoquan", "多谢", "客气"] },
  { id: "disapproval", name: "不屑", keywords: ["disapproval", "buxie", "摇头"] },
  { id: "thumbs_down", name: "点踩", keywords: ["thumbs_down", "diancai", "踩", "不行"] },
  { id: "watermelon", name: "吃瓜", keywords: ["watermelon", "chigua", "西瓜", "吃瓜群众"] },
  { id: "rose", name: "玫瑰", keywords: ["rose", "meigui", "鲜花", "花"] },
  { id: "heart", name: "爱心", keywords: ["heart", "aixin", "红心", "喜欢"] },
  { id: "confetti", name: "礼花", keywords: ["confetti", "lihua", "庆祝", "恭喜"] },
  { id: "clown", name: "小丑", keywords: ["clown", "xiaochou", "小丑竟是我"] },
  { id: "monster", name: "幽灵", keywords: ["monster", "youling", "小怪兽"] },
  { id: "flame", name: "火焰", keywords: ["flame", "fire", "huoyan", "火", "热度"] },
  { id: "rainbow", name: "彩虹", keywords: ["rainbow", "caihong", "美好"] },
  { id: "poop", name: "便便", keywords: ["poop", "bianbian", "大便"] },
  { id: "check_mark", name: "勾选", keywords: ["check_mark", "gouxuan", "对", "完成"] },
  { id: "cross_mark", name: "叉号", keywords: ["cross_mark", "chahao", "错", "禁止"] },
  { id: "100", name: "100分", keywords: ["100", "manfen", "满分", "给力"] },
  { id: "eyes", name: "双眼", keywords: ["eyes", "yanjing", "围观", "看戏"] },
  { id: "yes", name: "YES", keywords: ["yes", "对", "好的", "通过"] },
  { id: "no", name: "NO", keywords: ["no", "不", "拒绝", "不行"] },
  { id: "number_1", name: "数字1", keywords: ["number_1", "1", "第一"] },
  { id: "number_2", name: "数字2", keywords: ["number_2", "2", "第二"] },
  { id: "number_3", name: "数字3", keywords: ["number_3", "3", "第三"] },
  { id: "number_4", name: "数字4", keywords: ["number_4", "4", "第四"] },
  { id: "option_A", name: "选项A", keywords: ["option_A", "A", "选项A"] },
  { id: "option_B", name: "选项B", keywords: ["option_B", "B", "选项B"] },
  { id: "option_C", name: "选项C", keywords: ["option_C", "C", "选项C"] },
  { id: "option_D", name: "选项D", keywords: ["option_D", "D", "选项D"] },
];

export const OFFICIAL_EMOJIS: readonly OfficialEmojiItem[] = RAW_EMOJI_DEFS.map((def) => ({
  ...def,
  src: getEmojiUrl(def.id),
}));

export interface PlaygroundEmojiRegistry {
  get(id: string): { id: string; src: string } | undefined;
}

export function createPlaygroundEmojiRegistry(): PlaygroundEmojiRegistry {
  const map = new Map<string, { id: string; src: string }>();
  for (const item of OFFICIAL_EMOJIS) {
    map.set(item.id, { id: item.id, src: item.src });
  }
  return {
    get(id) {
      return map.get(id) ?? { id, src: getEmojiUrl(id) };
    },
  };
}
