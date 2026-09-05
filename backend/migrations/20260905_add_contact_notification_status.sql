-- Contact email delivery state for environments with DB_AUTO_MIGRATE=false.
ALTER TABLE contact_messages
  ADD COLUMN notification_status VARCHAR(20) NOT NULL DEFAULT 'queued',
  ADD COLUMN notification_error TEXT NULL,
  ADD COLUMN notification_sent_at DATETIME NULL,
  ADD INDEX idx_contact_messages_notification_status (notification_status);
