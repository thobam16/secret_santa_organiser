export type EventStatus = "open" | "locked" | "drawing" | "drawn" | "archived";

export interface EventInput {
  name: string;
  signupDeadline: number;
  exchangeAt: number;
  timezone: "Europe/London";
  budget: number;
  details: string;
  guidelines: string[];
  giftIdeas: string[];
}

export interface SantaEvent extends EventInput {
  id: string;
  status: EventStatus;
  memberCount: number;
  activeRunId: string | null;
  createdAt: number;
}

export interface Member {
  uid: string;
  name: string;
  joinedAt: number;
}

export interface Assignment {
  giverUid: string;
  recipientUid: string;
  recipientName: string;
}

export const DEFAULT_GUIDELINES = [
  "Please be thoughtful with your gift selection",
  "Wrap your gift before the exchange",
  "Label your gift with recipient’s name only",
  "If you’ll be away for the exchange, drop the gift with someone going to the Christmas party",
];

export const DEFAULT_GIFT_IDEAS = [
  "Desk accessories",
  "Books",
  "Homemade gift (drawing, decoration etc.)",
  "Gourmet treats",
  "Cozy winter items",
  "Self-care items",
];
