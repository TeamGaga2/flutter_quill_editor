import type { ChannelInsert, MentionInsert } from "@teamgaga/richtext-core";

export interface MockMentionUserItem extends MentionInsert {
  type: "user";
  username: string;
  avatar?: string;
  subtitle?: string;
}

export interface MockMentionRoleItem extends MentionInsert {
  type: "role";
  color?: string;
  description?: string;
}

export interface MockMentionEveryoneItem extends MentionInsert {
  type: "everyone";
  description?: string;
}

export type MockMentionItem = MockMentionUserItem | MockMentionRoleItem | MockMentionEveryoneItem;

export interface MockChannelItem extends ChannelInsert {
  description?: string;
}

export const MOCK_EVERYONE: MockMentionEveryoneItem = {
  id: "all",
  sign: "&",
  displayText: "所有人",
  type: "everyone",
  description: "通知本频道所有成员",
};

export const MOCK_ROLES: readonly MockMentionRoleItem[] = [
  {
    id: "role_admin",
    sign: "&",
    displayText: "管理员",
    type: "role",
    color: "#de3730",
    description: "社区管理与维护",
  },
  {
    id: "role_core",
    sign: "&",
    displayText: "Core Team",
    type: "role",
    color: "#009c64",
    description: "核心研发团队",
  },
  {
    id: "role_design",
    sign: "&",
    displayText: "Design Team",
    type: "role",
    color: "#0091ed",
    description: "UI/UX 设计组",
  },
  {
    id: "role_ops",
    sign: "&",
    displayText: "Operations",
    type: "role",
    color: "#e2a800",
    description: "运营与活动策划",
  },
];

export const MOCK_USERS: readonly MockMentionUserItem[] = [
  {
    id: "user_alice",
    sign: "!",
    displayText: "Alice",
    type: "user",
    username: "alice_wonder",
    subtitle: "前端架构师",
  },
  {
    id: "user_bob",
    sign: "!",
    displayText: "Bob",
    type: "user",
    username: "bob_builder",
    subtitle: "Flutter 核心开发",
  },
  {
    id: "user_charlie",
    sign: "!",
    displayText: "Charlie",
    type: "user",
    username: "charlie_ux",
    subtitle: "交互设计师",
  },
  {
    id: "user_zhangsan",
    sign: "!",
    displayText: "张三",
    type: "user",
    username: "zhangsan_dev",
    subtitle: "服务端开发",
  },
  {
    id: "user_lisi",
    sign: "!",
    displayText: "李四",
    type: "user",
    username: "lisi_qa",
    subtitle: "测试工程师",
  },
];

export const MOCK_CHANNELS: readonly MockChannelItem[] = [
  {
    id: "chan_general",
    displayText: "general",
    description: "综合交流与日常灌水",
  },
  {
    id: "chan_announcements",
    displayText: "announcements",
    description: "官方公告与重要通知",
  },
  {
    id: "chan_frontend",
    displayText: "frontend-dev",
    description: "前端与富文本技术交流",
  },
  {
    id: "chan_design",
    displayText: "design",
    description: "设计规范与视觉评审",
  },
  {
    id: "chan_random",
    displayText: "random",
    description: "随聊与生活分享",
  },
];
