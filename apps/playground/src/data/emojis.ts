export interface OfficialEmojiItem {
  id: string;
  name: string;
  keywords: readonly string[];
  src: string;
}

export const OFFICIAL_EMOJIS: readonly OfficialEmojiItem[] = [
  { id: "ok", name: "OK", keywords: ["ok", "好的", "没问题"], src: "/images/emoji/ok.png" },
  {
    id: "thumbs_up",
    name: "点赞",
    keywords: ["thumbs_up", "赞", "好", "666"],
    src: "/images/emoji/thumbs_up.png",
  },
  {
    id: "hand_ok",
    name: "手势OK",
    keywords: ["hand_ok", "ok", "手势"],
    src: "/images/emoji/hand_ok.png",
  },
  {
    id: "applause",
    name: "鼓掌",
    keywords: ["applause", "guzhang", "拍手", "好样"],
    src: "/images/emoji/applause.png",
  },
  {
    id: "fist_bump",
    name: "碰拳",
    keywords: ["fist_bump", "pengquan", "兄弟", "合作"],
    src: "/images/emoji/fist_bump.png",
  },
  {
    id: "plus_one",
    name: "+1",
    keywords: ["plus_one", "+1", "赞同", "附议"],
    src: "/images/emoji/plus_one.png",
  },
  {
    id: "get",
    name: "收到",
    keywords: ["get", "shoudao", "明白", "收到"],
    src: "/images/emoji/get.png",
  },
  {
    id: "blush",
    name: "害羞",
    keywords: ["blush", "haixiu", "脸红"],
    src: "/images/emoji/blush.png",
  },
  {
    id: "laugh",
    name: "大笑",
    keywords: ["laugh", "daxiao", "哈哈", "开心"],
    src: "/images/emoji/laugh.png",
  },
  {
    id: "smile",
    name: "微笑",
    keywords: ["smile", "weixiao", "笑"],
    src: "/images/emoji/smile.png",
  },
  {
    id: "support",
    name: "支持",
    keywords: ["support", "zhichi", "加油", "给力"],
    src: "/images/emoji/support.png",
  },
  {
    id: "whimper",
    name: "委屈",
    keywords: ["whimper", "weiqu", "可怜"],
    src: "/images/emoji/whimper.png",
  },
  {
    id: "obsessed",
    name: "花痴",
    keywords: ["obsessed", "huachi", "崇拜"],
    src: "/images/emoji/obsessed.png",
  },
  {
    id: "show_off",
    name: "得意",
    keywords: ["show_off", "deyi", "炫耀"],
    src: "/images/emoji/show_off.png",
  },
  {
    id: "adoration",
    name: "爱慕",
    keywords: ["adoration", "aimu", "喜欢"],
    src: "/images/emoji/adoration.png",
  },
  {
    id: "tongue",
    name: "吐舌",
    keywords: ["tongue", "tushe", "调皮"],
    src: "/images/emoji/tongue.png",
  },
  {
    id: "terror",
    name: "惊恐",
    keywords: ["terror", "jingkong", "害怕"],
    src: "/images/emoji/terror.png",
  },
  {
    id: "sob",
    name: "大哭",
    keywords: ["sob", "daku", "流泪", "难过"],
    src: "/images/emoji/sob.png",
  },
  {
    id: "toasted",
    name: "裂开",
    keywords: ["toasted", "liekai", "崩溃"],
    src: "/images/emoji/toasted.png",
  },
  {
    id: "angry",
    name: "生气",
    keywords: ["angry", "shengqi", "发怒"],
    src: "/images/emoji/angry.png",
  },
  {
    id: "apathy",
    name: "无语",
    keywords: ["apathy", "wuyu", "冷漠", "翻白眼"],
    src: "/images/emoji/apathy.png",
  },
  {
    id: "lol",
    name: "爆笑",
    keywords: ["lol", "baoxiao", "笑死", "233"],
    src: "/images/emoji/lol.png",
  },
  {
    id: "disbelief",
    name: "难以置信",
    keywords: ["disbelief", "zhixin", "震惊", "问号"],
    src: "/images/emoji/disbelief.png",
  },
  { id: "kiss", name: "亲亲", keywords: ["kiss", "qinqin", "飞吻"], src: "/images/emoji/kiss.png" },
  {
    id: "scrunch",
    name: "嫌弃",
    keywords: ["scrunch", "xianqi", "鄙视"],
    src: "/images/emoji/scrunch.png",
  },
  {
    id: "dizzy",
    name: "头晕",
    keywords: ["dizzy", "touyun", "晕"],
    src: "/images/emoji/dizzy.png",
  },
  {
    id: "sleep",
    name: "睡觉",
    keywords: ["sleep", "shuijiao", "晚安", "困"],
    src: "/images/emoji/sleep.png",
  },
  {
    id: "strive",
    name: "奋斗",
    keywords: ["strive", "fendou", "努力", "加油"],
    src: "/images/emoji/strive.png",
  },
  {
    id: "shocked",
    name: "吃惊",
    keywords: ["shocked", "chijing", "惊呆"],
    src: "/images/emoji/shocked.png",
  },
  {
    id: "phone_frustrated",
    name: "看手机",
    keywords: ["phone_frustrated", "shouji", "地铁老人"],
    src: "/images/emoji/phone_frustrated.png",
  },
  {
    id: "facepalm",
    name: "捂脸",
    keywords: ["facepalm", "wulian", "无奈"],
    src: "/images/emoji/facepalm.png",
  },
  { id: "hug", name: "抱抱", keywords: ["hug", "baobao", "拥抱"], src: "/images/emoji/hug.png" },
  {
    id: "see_no_evil",
    name: "不看",
    keywords: ["see_no_evil", "bukan", "遮眼", "害羞"],
    src: "/images/emoji/see_no_evil.png",
  },
  {
    id: "speak_no_evil",
    name: "不说",
    keywords: ["speak_no_evil", "bushuo", "闭嘴", "保密"],
    src: "/images/emoji/speak_no_evil.png",
  },
  {
    id: "hear_no_evil",
    name: "不听",
    keywords: ["hear_no_evil", "buting", "捂耳"],
    src: "/images/emoji/hear_no_evil.png",
  },
  {
    id: "fist_greet",
    name: "抱拳",
    keywords: ["fist_greet", "baoquan", "多谢", "客气"],
    src: "/images/emoji/fist_greet.png",
  },
  {
    id: "disapproval",
    name: "不屑",
    keywords: ["disapproval", "buxie", "摇头"],
    src: "/images/emoji/disapproval.png",
  },
  {
    id: "thumbs_down",
    name: "点踩",
    keywords: ["thumbs_down", "diancai", "踩", "不行"],
    src: "/images/emoji/thumbs_down.png",
  },
  {
    id: "watermelon",
    name: "吃瓜",
    keywords: ["watermelon", "chigua", "西瓜", "吃瓜群众"],
    src: "/images/emoji/watermelon.png",
  },
  {
    id: "rose",
    name: "玫瑰",
    keywords: ["rose", "meigui", "鲜花", "花"],
    src: "/images/emoji/rose.png",
  },
  {
    id: "heart",
    name: "爱心",
    keywords: ["heart", "aixin", "红心", "喜欢"],
    src: "/images/emoji/heart.png",
  },
  {
    id: "confetti",
    name: "礼花",
    keywords: ["confetti", "lihua", "庆祝", "恭喜"],
    src: "/images/emoji/confetti.png",
  },
  {
    id: "clown",
    name: "小丑",
    keywords: ["clown", "xiaochou", "小丑竟是我"],
    src: "/images/emoji/clown.png",
  },
  {
    id: "monster",
    name: "幽灵",
    keywords: ["monster", "youling", "小怪兽"],
    src: "/images/emoji/monster.png",
  },
  {
    id: "flame",
    name: "火焰",
    keywords: ["flame", "fire", "huoyan", "火", "热度"],
    src: "/images/emoji/flame.png",
  },
  {
    id: "rainbow",
    name: "彩虹",
    keywords: ["rainbow", "caihong", "美好"],
    src: "/images/emoji/rainbow.png",
  },
  {
    id: "poop",
    name: "便便",
    keywords: ["poop", "bianbian", "大便"],
    src: "/images/emoji/poop.png",
  },
  {
    id: "check_mark",
    name: "勾选",
    keywords: ["check_mark", "gouxuan", "对", "完成"],
    src: "/images/emoji/check_mark.png",
  },
  {
    id: "cross_mark",
    name: "叉号",
    keywords: ["cross_mark", "chahao", "错", "禁止"],
    src: "/images/emoji/cross_mark.png",
  },
  {
    id: "100",
    name: "100分",
    keywords: ["100", "manfen", "满分", "给力"],
    src: "/images/emoji/100.png",
  },
  {
    id: "eyes",
    name: "双眼",
    keywords: ["eyes", "yanjing", "围观", "看戏"],
    src: "/images/emoji/eyes.png",
  },
  { id: "yes", name: "YES", keywords: ["yes", "对", "好的", "通过"], src: "/images/emoji/yes.png" },
  { id: "no", name: "NO", keywords: ["no", "不", "拒绝", "不行"], src: "/images/emoji/no.png" },
  {
    id: "number_1",
    name: "数字1",
    keywords: ["number_1", "1", "第一"],
    src: "/images/emoji/number_1.png",
  },
  {
    id: "number_2",
    name: "数字2",
    keywords: ["number_2", "2", "第二"],
    src: "/images/emoji/number_2.png",
  },
  {
    id: "number_3",
    name: "数字3",
    keywords: ["number_3", "3", "第三"],
    src: "/images/emoji/number_3.png",
  },
  {
    id: "number_4",
    name: "数字4",
    keywords: ["number_4", "4", "第四"],
    src: "/images/emoji/number_4.png",
  },
  {
    id: "option_A",
    name: "选项A",
    keywords: ["option_A", "A", "选项A"],
    src: "/images/emoji/option_A.png",
  },
  {
    id: "option_B",
    name: "选项B",
    keywords: ["option_B", "B", "选项B"],
    src: "/images/emoji/option_B.png",
  },
  {
    id: "option_C",
    name: "选项C",
    keywords: ["option_C", "C", "选项C"],
    src: "/images/emoji/option_C.png",
  },
  {
    id: "option_D",
    name: "选项D",
    keywords: ["option_D", "D", "选项D"],
    src: "/images/emoji/option_D.png",
  },
];

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
      return map.get(id);
    },
  };
}
