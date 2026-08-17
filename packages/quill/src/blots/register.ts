import Quill from "quill";
import { MentionBlot } from "./mention-blot";
import { ChannelBlot } from "./channel-blot";
import { DividerBlot } from "./divider-blot";
import { EmojiBlot } from "./emoji-blot";
import { ImageBlot } from "./image-blot";
import { VideoBlot } from "./video-blot";
import { TgLinkBlot } from "./link-blot";
import { registerIndentFormat } from "./indent";

export function registerBlots() {
  registerIndentFormat();
  // Override Quill's default link so mp/mps survive DOM round-trips.
  Quill.register(TgLinkBlot, true);
  Quill.register(MentionBlot, true);
  Quill.register(ChannelBlot, true);
  Quill.register(DividerBlot, true);
  Quill.register(EmojiBlot, true);
  Quill.register(ImageBlot, true);
  Quill.register(VideoBlot, true);
}
