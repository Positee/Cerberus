/**
 * Inbox.
 *
 * Direct messaging between team members. A conversation is a thread between
 * two people in the same organization. Messages are ordered by time.
 */

export type Conversation = {
  id: string;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationParticipant = {
  id: string;
  conversationId: string;
  userId: string;
  lastReadAt: string | null;
  createdAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: string;
  editedAt: string | null;
};

/** A conversation with the other person's info and last message preview. */
export type ConversationSummary = Conversation & {
  otherUser: {
    id: string;
    fullName: string;
    email: string;
    avatarUpdatedAt: string | null;
  };
  lastMessage: {
    body: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
};

/** A message with the sender's public info. */
export type MessageWithSender = Message & {
  sender: {
    id: string;
    fullName: string;
    email: string;
    avatarUpdatedAt: string | null;
  };
  /** The quoted message, if reply_to_id is set. */
  replyTo?: MessageWithSender | null;
};
