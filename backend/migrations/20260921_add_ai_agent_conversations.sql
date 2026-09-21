-- Admin AI assistant chat sessions: persisted conversations with a resumable
-- message history. Additive only; safe to run repeatedly.
CREATE TABLE IF NOT EXISTS `ai_agent_conversations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL DEFAULT '',
  `status` varchar(32) NOT NULL DEFAULT 'idle',
  `created_at` datetime(3) NULL,
  `updated_at` datetime(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_agent_conversations_status` (`status`),
  KEY `idx_ai_agent_conversations_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `ai_agent_conversation_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `conversation_id` bigint unsigned NOT NULL,
  `role` varchar(16) NOT NULL DEFAULT '',
  `content` longtext NULL,
  `steps_json` longtext NULL,
  `suggestions_json` longtext NULL,
  `tool_calls_json` longtext NULL,
  `created_at` datetime(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ai_agent_conversation_messages_conversation_id` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
