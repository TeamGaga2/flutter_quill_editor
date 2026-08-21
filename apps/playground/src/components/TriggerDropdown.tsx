import { createEffect, createMemo, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { CaretRect, ChannelInsert, MentionInsert } from "@teamgaga/richtext-core";
import {
  MOCK_CHANNELS,
  MOCK_EVERYONE,
  MOCK_ROLES,
  MOCK_USERS,
  type MockChannelItem,
  type MockMentionEveryoneItem,
  type MockMentionRoleItem,
  type MockMentionUserItem,
} from "../data/mock-data";
import { matchAny } from "../utils/fuzzy-match";

export interface TriggerDropdownProps {
  isOpen: boolean;
  type: "mention" | "channel" | null;
  query: string;
  anchor: CaretRect | null;
  onSelectMention: (mention: MentionInsert) => void;
  onSelectChannel: (channel: ChannelInsert) => void;
  onClose: () => void;
}

type FlatItem =
  | { kind: "everyone"; data: MockMentionEveryoneItem }
  | { kind: "role"; data: MockMentionRoleItem }
  | { kind: "user"; data: MockMentionUserItem }
  | { kind: "channel"; data: MockChannelItem };

export function TriggerDropdown(props: TriggerDropdownProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let listContainerRef: HTMLDivElement | undefined;

  // Filtered mentions
  const isEveryoneMatch = createMemo(() => {
    if (props.type !== "mention") return false;
    const q = props.query;
    return matchAny(q, [
      MOCK_EVERYONE.displayText,
      MOCK_EVERYONE.id,
      "everyone",
      "所有人",
      MOCK_EVERYONE.description,
    ]);
  });

  const filteredRoles = createMemo<MockMentionRoleItem[]>(() => {
    if (props.type !== "mention") return [];
    const q = props.query;
    return MOCK_ROLES.filter((role) => matchAny(q, [role.displayText, role.id, role.description]));
  });

  const filteredUsers = createMemo<MockMentionUserItem[]>(() => {
    if (props.type !== "mention") return [];
    const q = props.query;
    return MOCK_USERS.filter((user) =>
      matchAny(q, [user.displayText, user.username, user.id, user.subtitle]),
    );
  });

  // Filtered channels
  const filteredChannels = createMemo<MockChannelItem[]>(() => {
    if (props.type !== "channel") return [];
    const q = props.query;
    return MOCK_CHANNELS.filter((chan) =>
      matchAny(q, [chan.displayText, chan.id, chan.description]),
    );
  });

  // Flattened items for keyboard navigation & selection
  const flatItems = createMemo<FlatItem[]>(() => {
    if (props.type === "mention") {
      const items: FlatItem[] = [];
      if (isEveryoneMatch()) {
        items.push({ kind: "everyone", data: MOCK_EVERYONE });
      }
      for (const role of filteredRoles()) {
        items.push({ kind: "role", data: role });
      }
      for (const user of filteredUsers()) {
        items.push({ kind: "user", data: user });
      }
      return items;
    }

    if (props.type === "channel") {
      return filteredChannels().map((chan) => ({
        kind: "channel",
        data: chan,
      }));
    }

    return [];
  });

  // Reset selected index on query/type change
  createEffect(() => {
    // depend on query and type
    props.query;
    props.type;
    setSelectedIndex(0);
  });

  // Keep selected index within bounds
  createEffect(() => {
    const total = flatItems().length;
    if (total === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex() >= total) {
      setSelectedIndex(total - 1);
    }
  });

  // Scroll active item into view
  createEffect(() => {
    const idx = selectedIndex();
    if (!props.isOpen || !listContainerRef) return;

    requestAnimationFrame(() => {
      const selectedEl = listContainerRef?.querySelector<HTMLElement>(`[data-item-index="${idx}"]`);
      selectedEl?.scrollIntoView({ block: "nearest" });
    });
  });

  const selectFlatItem = (item: FlatItem): void => {
    if (item.kind === "everyone" || item.kind === "role" || item.kind === "user") {
      props.onSelectMention({
        id: item.data.id,
        sign: item.data.sign,
        displayText: item.data.displayText,
      });
    } else if (item.kind === "channel") {
      props.onSelectChannel({
        id: item.data.id,
        displayText: item.data.displayText,
      });
    }
  };

  // Keyboard navigation
  createEffect(() => {
    if (!props.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      const items = flatItems();
      const total = items.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (total > 0) {
          setSelectedIndex((prev) => (prev + 1) % total);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (total > 0) {
          setSelectedIndex((prev) => (prev - 1 + total) % total);
        }
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (total > 0 && selectedIndex() >= 0 && selectedIndex() < total) {
          e.preventDefault();
          e.stopPropagation();
          const target = items[selectedIndex()];
          if (target) {
            selectFlatItem(target);
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("keydown", handleKeyDown, true);
    });
  });

  // Positioning relative to viewport and caret anchor
  const positionStyle = createMemo<JSX.CSSProperties>(() => {
    const currentAnchor = props.anchor;
    const popoverWidth = 320;
    const popoverHeight = 280;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 800;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 600;

    let left = (viewportWidth - popoverWidth) / 2;
    let top = 100;

    if (currentAnchor) {
      // Place below caret / selection by default
      left = currentAnchor.x;
      top = currentAnchor.y + currentAnchor.height + 6;

      // Adjust horizontal overflow
      if (left + popoverWidth > viewportWidth - 16) {
        left = viewportWidth - popoverWidth - 16;
      }
      if (left < 16) {
        left = 16;
      }

      // Adjust vertical overflow
      if (top + popoverHeight > viewportHeight - 16) {
        const aboveTop = currentAnchor.y - popoverHeight - 6;
        if (aboveTop >= 16) {
          top = aboveTop;
        } else {
          top = Math.max(16, viewportHeight - popoverHeight - 16);
        }
      }
    }

    return {
      position: "fixed",
      left: `${Math.round(left)}px`,
      top: `${Math.round(top)}px`,
      "z-index": "1000",
    };
  });

  // Helper to find flat item index for an item
  const getMentionIndex = (kind: "everyone" | "role" | "user", id: string): number => {
    return flatItems().findIndex((f) => f.kind === kind && f.data.id === id);
  };

  const getChannelIndex = (id: string): number => {
    return flatItems().findIndex((f) => f.kind === "channel" && f.data.id === id);
  };

  return (
    <Show when={props.isOpen && props.type !== null}>
      <div
        class="tgg-trigger-dropdown"
        style={positionStyle()}
        role="listbox"
        aria-label={props.type === "mention" ? "选择提及 (@)" : "选择频道 (#)"}
        onClick={(e) => e.stopPropagation()}
        ref={(el) => {
          listContainerRef = el;
        }}
      >
        {/* Header with Query & Type Hint */}
        <div class="tgg-trigger-header">
          <span class="tgg-trigger-header-title">
            {props.type === "mention" ? "提及 (@)" : "频道 (#)"}
          </span>
          <Show when={props.query.length > 0}>
            <span class="tgg-trigger-header-query">匹配: "{props.query}"</span>
          </Show>
        </div>

        {/* Scrollable list content */}
        <div class="tgg-trigger-list">
          {/* MENTION MODE */}
          <Show when={props.type === "mention"}>
            {/* 1. Everyone Section */}
            <Show when={isEveryoneMatch()}>
              <div
                class="tgg-trigger-item tgg-trigger-item--everyone"
                classList={{
                  "is-selected": selectedIndex() === getMentionIndex("everyone", MOCK_EVERYONE.id),
                }}
                data-item-index={getMentionIndex("everyone", MOCK_EVERYONE.id)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => {
                  const idx = getMentionIndex("everyone", MOCK_EVERYONE.id);
                  if (idx >= 0) setSelectedIndex(idx);
                }}
                onClick={() => {
                  props.onSelectMention({
                    id: MOCK_EVERYONE.id,
                    sign: MOCK_EVERYONE.sign,
                    displayText: MOCK_EVERYONE.displayText,
                  });
                }}
              >
                <div class="tgg-item-icon tgg-item-icon--everyone">
                  <span>@</span>
                </div>
                <div class="tgg-item-content">
                  <span class="tgg-item-title tgg-item-title--everyone">
                    @{MOCK_EVERYONE.displayText}
                  </span>
                  <Show when={MOCK_EVERYONE.description}>
                    <span class="tgg-item-desc">{MOCK_EVERYONE.description}</span>
                  </Show>
                </div>
              </div>
            </Show>

            {/* 2. Roles Group */}
            <Show when={filteredRoles().length > 0}>
              <div class="tgg-trigger-group-title">所有身份组</div>
              <For each={filteredRoles()}>
                {(role) => {
                  const itemIndex = () => getMentionIndex("role", role.id);
                  return (
                    <div
                      class="tgg-trigger-item tgg-trigger-item--role"
                      classList={{
                        "is-selected": selectedIndex() === itemIndex(),
                      }}
                      data-item-index={itemIndex()}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => {
                        const idx = itemIndex();
                        if (idx >= 0) setSelectedIndex(idx);
                      }}
                      onClick={() => {
                        props.onSelectMention({
                          id: role.id,
                          sign: role.sign,
                          displayText: role.displayText,
                        });
                      }}
                    >
                      <div
                        class="tgg-item-icon tgg-item-icon--role"
                        style={{ color: role.color ?? "#009c64" }}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                        >
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </div>
                      <div class="tgg-item-content">
                        <span class="tgg-item-title" style={{ color: role.color ?? "inherit" }}>
                          @{role.displayText}
                        </span>
                        <Show when={role.description}>
                          <span class="tgg-item-desc">{role.description}</span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>

            {/* 3. Members Group */}
            <Show when={filteredUsers().length > 0}>
              <div class="tgg-trigger-group-title">所有成员</div>
              <For each={filteredUsers()}>
                {(user) => {
                  const itemIndex = () => getMentionIndex("user", user.id);
                  return (
                    <div
                      class="tgg-trigger-item tgg-trigger-item--user"
                      classList={{
                        "is-selected": selectedIndex() === itemIndex(),
                      }}
                      data-item-index={itemIndex()}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => {
                        const idx = itemIndex();
                        if (idx >= 0) setSelectedIndex(idx);
                      }}
                      onClick={() => {
                        props.onSelectMention({
                          id: user.id,
                          sign: user.sign,
                          displayText: user.displayText,
                        });
                      }}
                    >
                      <div class="tgg-item-avatar">
                        <span>{user.displayText.charAt(0).toUpperCase()}</span>
                      </div>
                      <div class="tgg-item-content">
                        <span class="tgg-item-title">@{user.displayText}</span>
                        <span class="tgg-item-username">@{user.username}</span>
                        <Show when={user.subtitle}>
                          <span class="tgg-item-desc">{user.subtitle}</span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>

            {/* Empty Mentions State */}
            <Show when={flatItems().length === 0}>
              <div class="tgg-trigger-empty">未找到匹配的成员或身份组</div>
            </Show>
          </Show>

          {/* CHANNEL MODE */}
          <Show when={props.type === "channel"}>
            <Show when={filteredChannels().length > 0}>
              <For each={filteredChannels()}>
                {(chan) => {
                  const itemIndex = () => getChannelIndex(chan.id);
                  return (
                    <div
                      class="tgg-trigger-item tgg-trigger-item--channel"
                      classList={{
                        "is-selected": selectedIndex() === itemIndex(),
                      }}
                      data-item-index={itemIndex()}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => {
                        const idx = itemIndex();
                        if (idx >= 0) setSelectedIndex(idx);
                      }}
                      onClick={() => {
                        props.onSelectChannel({
                          id: chan.id,
                          displayText: chan.displayText,
                        });
                      }}
                    >
                      <div class="tgg-item-icon tgg-item-icon--channel">
                        <span>#</span>
                      </div>
                      <div class="tgg-item-content">
                        <span class="tgg-item-title">#{chan.displayText}</span>
                        <Show when={chan.description}>
                          <span class="tgg-item-desc">{chan.description}</span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </Show>

            {/* Empty Channels State */}
            <Show when={flatItems().length === 0}>
              <div class="tgg-trigger-empty">未找到匹配的频道</div>
            </Show>
          </Show>
        </div>

        {/* Footer Hint */}
        <div class="tgg-trigger-footer">
          <span>↑↓ 切换 • ↵ / 点击选择 • Esc 关闭</span>
        </div>
      </div>
    </Show>
  );
}
