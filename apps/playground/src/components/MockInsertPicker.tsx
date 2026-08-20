import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type { ChannelInsert, MentionInsert } from "@teamgaga/richtext-core";
import { OFFICIAL_EMOJIS, type OfficialEmojiItem } from "../data/emojis";
import {
  MOCK_CHANNELS,
  MOCK_EVERYONE,
  MOCK_ROLES,
  MOCK_USERS,
  type MockChannelItem,
  type MockMentionRoleItem,
  type MockMentionUserItem,
} from "../data/mock-data";

export interface MockInsertPickerProps {
  isOpen: boolean;
  type: "mention" | "channel" | "emoji" | null;
  onClose: () => void;
  onSelectMention: (mention: MentionInsert) => void;
  onSelectChannel: (channel: ChannelInsert) => void;
  onSelectEmoji: (emojiId: string) => void;
}

export function MockInsertPicker(props: MockInsertPickerProps): JSX.Element {
  const [query, setQuery] = createSignal("");
  let searchInputRef: HTMLInputElement | undefined;

  // Reset query and focus on open
  createEffect(() => {
    if (props.isOpen) {
      setQuery("");
      queueMicrotask(() => {
        searchInputRef?.focus();
      });
    }
  });

  // Global Esc key listener
  createEffect(() => {
    if (!props.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
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

  const filteredEmojis = (): OfficialEmojiItem[] => {
    const q = query().trim().toLowerCase();
    if (!q) return [...OFFICIAL_EMOJIS];

    return OFFICIAL_EMOJIS.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  };

  const filteredRoles = (): MockMentionRoleItem[] => {
    const q = query().trim().toLowerCase();
    if (!q) return [...MOCK_ROLES];

    return MOCK_ROLES.filter(
      (item) =>
        item.displayText.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  };

  const filteredUsers = (): MockMentionUserItem[] => {
    const q = query().trim().toLowerCase();
    if (!q) return [...MOCK_USERS];

    return MOCK_USERS.filter(
      (item) =>
        item.displayText.toLowerCase().includes(q) ||
        item.username.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)),
    );
  };

  const isEveryoneMatch = (): boolean => {
    const q = query().trim().toLowerCase();
    if (!q) return true;
    return (
      MOCK_EVERYONE.displayText.toLowerCase().includes(q) ||
      MOCK_EVERYONE.id.toLowerCase().includes(q) ||
      "everyone".includes(q) ||
      "所有人".includes(q)
    );
  };

  const filteredChannels = (): MockChannelItem[] => {
    const q = query().trim().toLowerCase();
    if (!q) return [...MOCK_CHANNELS];

    return MOCK_CHANNELS.filter(
      (item) =>
        item.displayText.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  };

  const getTitle = (): string => {
    switch (props.type) {
      case "mention":
        return "选择提及 (@)";
      case "channel":
        return "选择频道 (#)";
      case "emoji":
        return "表情 (Emoji)";
      default:
        return "";
    }
  };

  const getSearchPlaceholder = (): string => {
    switch (props.type) {
      case "mention":
        return "搜索成员、身份组...";
      case "channel":
        return "搜索频道名称...";
      case "emoji":
        return "搜索表情 (如 ok, 赞, 微笑)...";
      default:
        return "搜索...";
    }
  };

  return (
    <Show when={props.isOpen && props.type !== null}>
      <div class="tgg-picker-backdrop" onClick={props.onClose}>
        <div
          class="tgg-picker-surface"
          classList={{
            "tgg-picker-surface--emoji": props.type === "emoji",
          }}
          role="dialog"
          aria-modal="true"
          aria-label={getTitle()}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header & Search */}
          <header class="tgg-picker-header">
            <div class="tgg-picker-search-bar">
              <svg
                class="tgg-picker-search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={(el) => {
                  searchInputRef = el;
                }}
                type="text"
                class="tgg-picker-search-input"
                placeholder={getSearchPlaceholder()}
                value={query()}
                onInput={(e) => setQuery(e.currentTarget.value)}
              />
              <Show when={query().length > 0}>
                <button
                  type="button"
                  class="tgg-picker-search-clear"
                  onClick={() => setQuery("")}
                  aria-label="清空搜索"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </Show>
              <button
                type="button"
                class="tgg-picker-close-btn"
                onClick={props.onClose}
                aria-label="关闭"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </header>

          {/* Body Content */}
          <div class="tgg-picker-body">
            {/* 1. EMOJI KEYBOARD (7-Column Grid, 32px) */}
            <Show when={props.type === "emoji"}>
              <div class="tgg-emoji-keyboard" role="listbox">
                <For
                  each={filteredEmojis()}
                  fallback={<div class="tgg-picker-empty">未找到匹配的表情</div>}
                >
                  {(item) => (
                    <button
                      type="button"
                      class="tgg-emoji-keyboard-btn"
                      title={`${item.name} (:${item.id}:)`}
                      onClick={() => {
                        props.onSelectEmoji(item.id);
                      }}
                    >
                      <img
                        class="tgg-emoji-keyboard-img"
                        src={item.src}
                        alt={item.name}
                        loading="lazy"
                      />
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* 2. MENTION LIST (42px item height, teamgaga desktop specs) */}
            <Show when={props.type === "mention"}>
              <div class="tgg-mention-list" role="listbox">
                {/* Everyone Section */}
                <Show when={isEveryoneMatch()}>
                  <button
                    type="button"
                    class="tgg-list-item tgg-list-item--everyone"
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
                    <span class="tgg-item-title tgg-item-title--everyone">
                      @{MOCK_EVERYONE.displayText}
                    </span>
                    <span class="tgg-item-desc">{MOCK_EVERYONE.description}</span>
                  </button>
                </Show>

                {/* Roles Group */}
                <Show when={filteredRoles().length > 0}>
                  <div class="tgg-list-group-title">所有身份组</div>
                  <For each={filteredRoles()}>
                    {(role) => (
                      <button
                        type="button"
                        class="tgg-list-item tgg-list-item--role"
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
                            width="20"
                            height="20"
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
                        <span class="tgg-item-title" style={{ color: role.color ?? "inherit" }}>
                          @{role.displayText}
                        </span>
                        <Show when={role.description}>
                          <span class="tgg-item-desc">{role.description}</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>

                {/* Members Group */}
                <Show when={filteredUsers().length > 0}>
                  <div class="tgg-list-group-title">所有成员</div>
                  <For each={filteredUsers()}>
                    {(user) => (
                      <button
                        type="button"
                        class="tgg-list-item tgg-list-item--user"
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
                        <span class="tgg-item-title">@{user.displayText}</span>
                        <span class="tgg-item-username">@{user.username}</span>
                        <Show when={user.subtitle}>
                          <span class="tgg-item-desc">{user.subtitle}</span>
                        </Show>
                      </button>
                    )}
                  </For>
                </Show>

                <Show
                  when={
                    !isEveryoneMatch() &&
                    filteredRoles().length === 0 &&
                    filteredUsers().length === 0
                  }
                >
                  <div class="tgg-picker-empty">未找到匹配的成员或身份组</div>
                </Show>
              </div>
            </Show>

            {/* 3. CHANNEL LIST (42px item height, teamgaga desktop specs) */}
            <Show when={props.type === "channel"}>
              <div class="tgg-channel-list" role="listbox">
                <For
                  each={filteredChannels()}
                  fallback={<div class="tgg-picker-empty">未找到匹配的频道</div>}
                >
                  {(chan) => (
                    <button
                      type="button"
                      class="tgg-list-item tgg-list-item--channel"
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
                      <span class="tgg-item-title">#{chan.displayText}</span>
                      <Show when={chan.description}>
                        <span class="tgg-item-desc">{chan.description}</span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <footer class="tgg-picker-footer">
            <span>点击插入 • Esc 关闭</span>
          </footer>
        </div>
      </div>
    </Show>
  );
}
