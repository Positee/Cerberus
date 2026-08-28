import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Pencil, Reply, Search, Send } from 'lucide-react';
import {
  listConversations,
  createConversation,
  listMessages,
  sendMessage,
  markConversationRead,
  listInboxMembers,
  type InboxConversationSummary,
  type InboxMessage,
  type InboxMember,
} from '../../app/api';
import { useToast } from '../../app/toast';
import { type Session, allows } from '../../app/session';

function avatarUrl(member: { avatarUpdatedAt: string | null }): string | null {
  if (!member.avatarUpdatedAt) return null;
  return `/api/profile/avatar?v=${encodeURIComponent(member.avatarUpdatedAt)}`;
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return (words[0] ?? '').slice(0, 2).toUpperCase();
  return ((words[0]?.[0] ?? '') + (words[words.length - 1]?.[0] ?? '')).toUpperCase();
}

function formatTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMessageTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Inbox({ session }: { session: Session }) {
  const toast = useToast();
  const currentUserId = session.user.id;

  const [conversations, setConversations] = useState<InboxConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [members, setMembers] = useState<InboxMember[]>([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await listConversations();
      setConversations(res.conversations);
    } catch {
      // Silent fail.
    }
  }, []);

  useEffect(() => {
    refreshConversations();
    const timer = setInterval(refreshConversations, 15_000);
    return () => clearInterval(timer);
  }, [refreshConversations]);

  const loadMessages = useCallback(async (convId: string) => {
    setLoadingMessages(true);
    try {
      const res = await listMessages(convId, { limit: 100 });
      setMessages(res.messages);
      await markConversationRead(convId);
      setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unreadCount: 0 } : c)));
    } catch {
      toast.fail('Could not load messages.');
    } finally {
      setLoadingMessages(false);
    }
  }, [toast]);

  useEffect(() => {
    if (activeId && !showNewChat) loadMessages(activeId);
  }, [activeId, showNewChat, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll for new messages every 5s.
  useEffect(() => {
    if (!activeId || showNewChat) return;
    const timer = setInterval(() => {
      listMessages(activeIdRef.current!, { limit: 100 })
        .then((res) => setMessages(res.messages))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [activeId, showNewChat]);

  useEffect(() => {
    if (showNewChat && members.length === 0) {
      listInboxMembers()
        .then((res) => setMembers(res.members))
        .catch(() => {});
    }
  }, [showNewChat, members.length]);

  const handleSend = useCallback(async () => {
    const body = input.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const res = await sendMessage(activeId, body, replyTo?.id);
      setMessages((prev) => [...prev, res.message]);
      setInput('');
      setReplyTo(null);
      refreshConversations();
      textareaRef.current?.focus();
    } catch {
      toast.fail('The message was not sent.');
    } finally {
      setSending(false);
    }
  }, [input, activeId, sending, replyTo, toast, refreshConversations]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      if (e.key === 'Escape') setReplyTo(null);
    },
    [handleSend],
  );

  const handleNewChat = useCallback(
    async (member: InboxMember) => {
      try {
        const res = await createConversation(member.userId);
        setShowNewChat(false);
        setMemberSearch('');
        await refreshConversations();
        setActiveId(res.conversation.id);
      } catch {
        toast.fail('Could not start a conversation.');
      }
    },
    [refreshConversations, toast],
  );

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  const filteredConversations = conversations.filter((c) => {
    if (!search) return true;
    return c.otherUser.fullName.toLowerCase().includes(search.toLowerCase());
  });

  const filteredMembers = members.filter((m) => {
    if (!memberSearch) return true;
    const q = memberSearch.toLowerCase();
    return m.fullName.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
  });

  return (
    <div className="page inbox-page">
      <div className="inbox-layout">
        {/* Sidebar */}
        <div className="inbox-sidebar">
          <div className="inbox-sidebar-head">
            <h3>Chats</h3>
            {allows(session, 'workspace.view') && (
              <button
                className="inbox-new-chat-btn"
                onClick={() => { setShowNewChat(true); setActiveId(null); }}
                title="New chat"
              >
                <Pencil size={15} />
              </button>
            )}
          </div>
          <div className="inbox-search">
            <Search size={14} aria-hidden="true" />
            <input
              placeholder="Search chats..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="inbox-conv-list">
            {!conversations.length && (
              <div className="inbox-empty">
                <MessageSquare size={24} style={{ color: 'var(--faint)' }} />
                <p>No conversations yet.</p>
              </div>
            )}
            {conversations.length > 0 && filteredConversations.length === 0 && (
              <div className="inbox-empty">
                <p>No matches.</p>
              </div>
            )}
            {filteredConversations.map((c) => (
              <button
                key={c.id}
                className={`inbox-conv-row ${activeId === c.id ? 'active' : ''} ${c.unreadCount > 0 ? 'unread' : ''}`}
                onClick={() => { setActiveId(c.id); setShowNewChat(false); setReplyTo(null); }}
              >
                <div className="inbox-avatar">
                  {avatarUrl(c.otherUser) ? (
                    <img src={avatarUrl(c.otherUser)!} alt="" />
                  ) : (
                    <span>{initials(c.otherUser.fullName)}</span>
                  )}
                </div>
                <div className="inbox-conv-info">
                  <div className="inbox-conv-top">
                    <span className="inbox-conv-name">{c.otherUser.fullName}</span>
                    {c.lastMessage && (
                      <span className="inbox-conv-time">{formatTime(c.lastMessage.createdAt)}</span>
                    )}
                  </div>
                  <div className="inbox-conv-bottom">
                    {c.lastMessage && (
                      <span className="inbox-conv-preview">
                        {c.lastMessage.senderId === currentUserId ? 'You: ' : ''}
                        {c.lastMessage.body}
                      </span>
                    )}
                    {c.unreadCount > 0 && (
                      <span className="inbox-unread-badge">{c.unreadCount}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Chat area */}
        <div className="inbox-chat">
          {showNewChat ? (
            <div className="inbox-new-chat">
              <div className="inbox-new-chat-head">
                <button
                  className="ghost-button"
                  onClick={() => { setShowNewChat(false); setMemberSearch(''); }}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                </button>
                <h3>New chat</h3>
              </div>
              <div className="inbox-search" style={{ margin: '0 12px' }}>
                <Search size={14} aria-hidden="true" />
                <input
                  placeholder="Search team members..."
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="inbox-member-list">
                {filteredMembers.map((m) => (
                  <button
                    key={m.userId}
                    className="inbox-member-row"
                    onClick={() => handleNewChat(m)}
                  >
                    <div className="inbox-avatar">
                      {avatarUrl(m) ? (
                        <img src={avatarUrl(m)!} alt="" />
                      ) : (
                        <span>{initials(m.fullName)}</span>
                      )}
                    </div>
                    <div className="inbox-member-info">
                      <span className="inbox-member-name">{m.fullName}</span>
                      <span className="inbox-member-email">{m.email}</span>
                    </div>
                  </button>
                ))}
                {filteredMembers.length === 0 && (
                  <div className="inbox-empty">
                    <p>{members.length === 0 ? 'No team members.' : 'No matches.'}</p>
                  </div>
                )}
              </div>
            </div>
          ) : activeConv ? (
            <>
              <div className="inbox-chat-head">
                <div className="inbox-avatar small">
                  {avatarUrl(activeConv.otherUser) ? (
                    <img src={avatarUrl(activeConv.otherUser)!} alt="" />
                  ) : (
                    <span>{initials(activeConv.otherUser.fullName)}</span>
                  )}
                </div>
                <div>
                  <h3>{activeConv.otherUser.fullName}</h3>
                  <p className="inbox-chat-head-email">{activeConv.otherUser.email}</p>
                </div>
              </div>

              <div className="inbox-messages">
                {loadingMessages && messages.length === 0 && (
                  <div className="inbox-loading">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="inbox-msg skeleton-line" />
                    ))}
                  </div>
                )}
                {!loadingMessages && messages.length === 0 && (
                  <div className="inbox-empty-chat">
                    <p>Start a conversation with {activeConv.otherUser.fullName}.</p>
                  </div>
                )}
                {messages.map((msg) => {
                  const isMe = msg.senderId === currentUserId;
                  return (
                    <div key={msg.id} className={`inbox-msg ${isMe ? 'mine' : 'theirs'}`}>
                      {!isMe && (
                        <div className="inbox-avatar tiny">
                          {avatarUrl(msg.sender) ? (
                            <img src={avatarUrl(msg.sender)!} alt="" />
                          ) : (
                            <span>{initials(msg.sender.fullName)}</span>
                          )}
                        </div>
                      )}
                      <div className="inbox-msg-bubble">
                        {!isMe && <span className="inbox-msg-sender">{msg.sender.fullName}</span>}
                        {msg.replyToId && (
                          <div className="inbox-msg-quote">
                            <Reply size={12} />
                            <span>Reply to a message</span>
                          </div>
                        )}
                        <p>{msg.body}</p>
                        <span className="inbox-msg-time">{formatMessageTime(msg.createdAt)}</span>
                      </div>
                      {isMe && (
                        <button
                          className="inbox-msg-reply"
                          onClick={() => setReplyTo(msg)}
                          title="Reply"
                        >
                          <Reply size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {replyTo && (
                <div className="inbox-reply-preview">
                  <Reply size={13} />
                  <span>Replying to {replyTo.sender.fullName}</span>
                  <button onClick={() => setReplyTo(null)}>×</button>
                </div>
              )}

              <div className="inbox-chat-input">
                <textarea
                  ref={textareaRef}
                  placeholder="Type a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  disabled={sending}
                />
                <button
                  className="inbox-send-btn"
                  onClick={handleSend}
                  disabled={!input.trim() || sending}
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="inbox-empty-chat">
              <MessageSquare size={32} style={{ color: 'var(--faint)', marginBottom: 8 }} />
              <p>Select a conversation or start a new one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
