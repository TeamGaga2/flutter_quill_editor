/**
 * Fuzzy matching utilities for mention and channel dropdown filtering.
 */

// Simple pinyin initial mapping for common Chinese words in mock data
const PINYIN_INITIALS: Record<string, string[]> = {
  所有人: ["syr", "suoyouren"],
  管理员: ["gly", "guanliyuan"],
  张三: ["zs", "zhangsan"],
  李四: ["ls", "lisi"],
  核心研发团队: ["hxyf", "hexi"],
  交互设计师: ["jhsjs", "jiaohu"],
  前端架构师: ["qdjgs", "qianduan"],
  服务端开发: ["fwkf", "fuwuduan"],
  测试工程师: ["csgcs", "ceshi"],
  综合交流与日常灌水: ["zhjl"],
  官方公告与重要通知: ["gfgg"],
  前端与富文本技术交流: ["qdfwb"],
  设计规范与视觉评审: ["sjgf"],
  随聊与生活分享: ["slysh"],
};

/**
 * Checks if a target string matches a search query using fuzzy matching:
 * 1. Empty query matches everything.
 * 2. Case-insensitive substring match.
 * 3. Subsequence match (e.g. "ct" matches "Core Team").
 * 4. Pinyin initial/full match for known Chinese terms.
 */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (!target) return false;

  const t = target.toLowerCase();

  // 1. Exact substring
  if (t.includes(q)) return true;

  // 2. Subsequence match
  let qIdx = 0;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      qIdx++;
    }
  }
  if (qIdx === q.length) return true;

  // 3. Pinyin match for Chinese characters
  for (const [chinese, initials] of Object.entries(PINYIN_INITIALS)) {
    if (target.includes(chinese)) {
      for (const p of initials) {
        if (p.includes(q) || q.includes(p)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks if any of the target candidates match the query.
 */
export function matchAny(query: string, candidates: (string | undefined | null)[]): boolean {
  if (!query.trim()) return true;
  return candidates.some((cand) => (cand ? fuzzyMatch(query, cand) : false));
}
