package models

import (
	"time"
)

// Ticket represents a customer support ticket
type Ticket struct {
	ID           uint     `json:"id" gorm:"primaryKey"`
	TicketNumber string   `json:"ticket_number" gorm:"size:50;uniqueIndex;not null"`
	CustomerID   uint     `json:"customer_id" gorm:"not null;index"`
	Customer     Customer `json:"customer" gorm:"foreignKey:CustomerID"`

	Subject  string `json:"subject" gorm:"size:255;not null"`
	Message  string `json:"message" gorm:"type:longtext;not null"`
	Category string `json:"category" gorm:"size:50;index"`                  // technical, billing, general, etc.
	Priority string `json:"priority" gorm:"size:20;default:'normal';index"` // low, normal, high, urgent
	Status   string `json:"status" gorm:"size:20;default:'open';index"`     // open, in-progress, resolved, closed

	// Order reference (optional)
	OrderID     *uint  `json:"order_id" gorm:"index"`
	OrderNumber string `json:"order_number" gorm:"size:50"`

	// Metadata
	AssignedToID *uint      `json:"assigned_to_id"` // Admin user who handles this ticket
	AssignedTo   *AdminUser `json:"assigned_to,omitempty" gorm:"foreignKey:AssignedToID"`

	ResolvedAt *time.Time `json:"resolved_at"`
	ClosedAt   *time.Time `json:"closed_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`

	// Relations
	Replies     []TicketReply      `json:"replies,omitempty" gorm:"foreignKey:TicketID"`
	Attachments []TicketAttachment `json:"attachments,omitempty" gorm:"foreignKey:TicketID"`
}

// TicketReply represents a reply to a ticket
type TicketReply struct {
	ID       uint `json:"id" gorm:"primaryKey"`
	TicketID uint `json:"ticket_id" gorm:"not null;index"`

	// Either customer or admin can reply
	CustomerID  *uint      `json:"customer_id" gorm:"index"`
	Customer    *Customer  `json:"customer,omitempty" gorm:"foreignKey:CustomerID"`
	AdminUserID *uint      `json:"admin_user_id" gorm:"index"`
	AdminUser   *AdminUser `json:"admin_user,omitempty" gorm:"foreignKey:AdminUserID"`

	Message    string `json:"message" gorm:"type:longtext;not null"`
	IsStaff    bool   `json:"is_staff" gorm:"default:false"`    // true if admin replied
	IsInternal bool   `json:"is_internal" gorm:"default:false"` // Internal notes for admins only

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// TicketAttachment represents file attachments for tickets
type TicketAttachment struct {
	ID         uint      `json:"id" gorm:"primaryKey"`
	TicketID   uint      `json:"ticket_id" gorm:"not null;index"`
	FileName   string    `json:"file_name" gorm:"size:255;not null"`
	FileURL    string    `json:"file_url" gorm:"type:text;not null"`
	FileSize   int64     `json:"file_size"`
	FileType   string    `json:"file_type" gorm:"size:100"`
	UploadedBy string    `json:"uploaded_by" gorm:"size:50"` // customer or admin
	CreatedAt  time.Time `json:"created_at"`
}

// TicketCreateRequest represents the ticket creation payload
type TicketCreateRequest struct {
	Subject     string `json:"subject" binding:"required"`
	Message     string `json:"message" binding:"required"`
	Category    string `json:"category"`
	Priority    string `json:"priority"`
	OrderNumber string `json:"order_number"`
}

// TicketReplyRequest represents the reply payload
type TicketReplyRequest struct {
	Message    string `json:"message" binding:"required"`
	IsInternal bool   `json:"is_internal"`
}

// TicketUpdateRequest represents the ticket update payload (admin only)
type TicketUpdateRequest struct {
	Status       string `json:"status"`
	Priority     string `json:"priority"`
	AssignedToID *uint  `json:"assigned_to_id"`
}
