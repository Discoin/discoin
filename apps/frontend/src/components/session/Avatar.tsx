import { useState } from "preact/hooks";
import type { CurrentUser } from "../../api/types.js";
import "./Avatar.scss";

export function displayName(user: CurrentUser): string {
  return user.username ?? user.userId;
}

export function Avatar({ user }: { user: CurrentUser }) {
  const [failed, setFailed] = useState(false);

  return (
    <img
      class="avatar"
      src={failed ? user.defaultAvatarUrl : user.avatarUrl}
      alt=""
      width="28"
      height="28"
      onError={() => setFailed(true)}
    />
  );
}
