// Response shapes of the backend API (see backend/src/*/routes.ts).

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export type GroupStatus = "OPEN" | "CLOSED";
export type Role = "OWNER" | "MEMBER";

export interface GroupSummary {
  id: string;
  name: string;
  currency: string;
  status: GroupStatus;
  closedAt: string | null;
  reminderDays: number;
  memberCount: number;
  myRole: Role;
  createdAt: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  currency: string;
  currencyLocked: boolean;
  reminderDays: number;
  status: GroupStatus;
  closedAt: string | null;
  ledgerVersion: number;
  createdById: string;
  createdAt: string;
  inviteLink: string;
  inviteToken: string;
  members: Member[];
  pendingInvites: { id: string; email: string; expiresAt: string; invitedById: string; createdAt: string }[];
}

export interface MemberBalance {
  userId: string;
  net: number; // minor units; > 0 is owed money, < 0 owes
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED";

export interface Payment {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  status: PaymentStatus;
  note: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export type Category =
  | "FOOD"
  | "GROCERIES"
  | "TRANSPORT"
  | "ACCOMMODATION"
  | "ENTERTAINMENT"
  | "UTILITIES"
  | "RENT"
  | "SHOPPING"
  | "OTHER";

export type SplitType = "EQUAL" | "SHARES" | "EXACT";

export type SplitInput =
  | { type: "EQUAL"; participants: string[] }
  | { type: "SHARES"; shares: { userId: string; shares: number }[] }
  | { type: "EXACT"; amounts: { userId: string; amount: number }[] };

export interface Expense {
  id: string;
  groupId: string;
  paidById: string;
  amount: number;
  description: string;
  category: Category;
  date: string; // YYYY-MM-DD
  comment: string | null;
  splitType: SplitType;
  version: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  splits: { userId: string; shares: number | null; amount: number }[];
}

export type ActivityType =
  | "GROUP_CREATED"
  | "MEMBER_JOINED"
  | "MEMBER_INVITED"
  | "EXPENSE_CREATED"
  | "EXPENSE_UPDATED"
  | "EXPENSE_DELETED"
  | "PAYMENT_CREATED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_REJECTED"
  | "PAYMENT_CANCELLED"
  | "GROUP_SETTINGS_UPDATED"
  | "GROUP_CLOSED"
  | "GROUP_REOPENED";

export interface Activity {
  id: string;
  type: ActivityType;
  actor: { id: string; name: string };
  data: Record<string, unknown>;
  createdAt: string;
}

// Socket.io "group:update" payload (backend D18).
export interface GroupUpdate {
  groupId: string;
  change: { type: string; id?: string; actorId: string } | null;
  ledgerVersion: number;
  group: { name: string; currency: string; status: GroupStatus; closedAt: string | null; reminderDays: number };
  balances: MemberBalance[];
  settlement: { transfers: Transfer[]; method: "exact" | "greedy" };
  pendingPayments: Payment[];
}

// In-app notifications (backend D33): REST /api/notifications and the
// Socket.io "notification:new" / "notification:read" events.
export type NotificationType = "EXPENSE_ADDED" | "EXPENSE_UPDATED" | "EXPENSE_DELETED";

export interface AppNotification {
  id: string;
  type: NotificationType;
  group: { id: string; name: string; currency: string } | null;
  data: {
    actor: { id: string; name: string };
    expenseId: string;
    description: string;
    amount: number;
    share: number | null; // your part of the split; null if you're not in it
    previousShare?: number | null; // only on EXPENSE_UPDATED
  };
  readAt: string | null;
  createdAt: string;
}
