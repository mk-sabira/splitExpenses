import { createContext, useContext } from "react";
import type { Member } from "../lib/types";
import { Avatar } from "../ui";

// Things every card on the group screen needs: who's who, and the currency.
export interface GroupCtx {
  groupId: string;
  currency: string;
  me: string;
  members: Member[];
  name: (userId: string) => string;
  crayon: (userId: string) => string | number; // Avatar colorKey: join order, so colours differ
  closed: boolean;
  afterChange: () => Promise<void>;
}

export const GroupContext = createContext<GroupCtx | null>(null);

export function useGroup() {
  const ctx = useContext(GroupContext);
  if (!ctx) throw new Error("useGroup must be used inside the group screen");
  return ctx;
}

// A member's avatar with the group's colour for them.
export function MemberAvatar({ userId, size }: { userId: string; size?: number }) {
  const { name, crayon } = useGroup();
  return <Avatar name={name(userId)} colorKey={crayon(userId)} size={size} />;
}
