-- 024_app_users_signature.sql
-- Per-user email/message signature, surfaced in the Message Formatter tool so a
-- new message starts with the user's signature pre-filled (they type above it).
-- Stored as plain text with newlines; the formatter renders it as a tight block.

alter table app_users add column if not exists signature text;

-- Seed Nathan's signature (text core of his Gmail WiseStamp signature).
update app_users
set signature =
'Nathan King
Owner-Operations, Brett King Builder-Contractor Inc.
o. 215-536-1145 | c. 267-784-4134
www.brettkingbuilder.com
nathan@brettkingbuilder.com
Since 1982: "Building upon a solid foundation." (Luke 6:47-49)'
where id = 'nathan';
