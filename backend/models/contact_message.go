package models

import (
	"time"
)

// ContactMessage 联系消息模型
type ContactMessage struct {
	ID          uint       `json:"id" gorm:"primaryKey"`
	Name        string     `json:"name" gorm:"type:varchar(100);not null" binding:"required"`
	Email       string     `json:"email" gorm:"type:varchar(100);not null;index" binding:"required,email"`
	Phone       string     `json:"phone" gorm:"type:varchar(50)"`
	Company     string     `json:"company" gorm:"type:varchar(100)"`
	Subject     string     `json:"subject" gorm:"type:varchar(200);not null" binding:"required"`
	Message     string     `json:"message" gorm:"type:text;not null" binding:"required"`
	InquiryType string     `json:"inquiry_type" gorm:"type:varchar(20);default:'general';index"`
	Status      string     `json:"status" gorm:"type:varchar(20);default:'new';index"`
	Priority    string     `json:"priority" gorm:"type:varchar(20);default:'medium'"`
	IPAddress   string     `json:"ip_address" gorm:"type:varchar(45)"`
	UserAgent   string     `json:"user_agent" gorm:"type:text"`
	RepliedAt   *time.Time `json:"replied_at"`
	RepliedBy   *uint      `json:"replied_by"`
	AdminNotes  string     `json:"admin_notes" gorm:"type:text"`
	NotificationStatus string `json:"notification_status" gorm:"type:varchar(20);default:'queued';index"`
	NotificationError string `json:"notification_error,omitempty" gorm:"type:text"`
	NotificationSentAt *time.Time `json:"notification_sent_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// TableName 指定表名
func (ContactMessage) TableName() string {
	return "contact_messages"
}
