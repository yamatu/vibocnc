package handlers

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"fanuc-backend/models"
	"fanuc-backend/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// 使用 models.ContactMessage 替代本地定义

// ContactHandler 联系处理器
type ContactHandler struct {
	db *gorm.DB
}

// NewContactHandler 创建联系处理器
func NewContactHandler(db *gorm.DB) *ContactHandler {
	return &ContactHandler{db: db}
}

// SubmitContact 提交联系表单
func (h *ContactHandler) SubmitContact(c *gin.Context) {
	var req models.ContactMessage
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":   "Invalid request data",
			"details": err.Error(),
		})
		return
	}

	// 获取客户端信息
	req.IPAddress = c.ClientIP()
	req.UserAgent = c.GetHeader("User-Agent")

	// 保存到数据库
	if err := h.db.Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to save contact message",
		})
		return
	}

	siteURL := contactSiteURL(c)
	go func(messageID uint, baseURL string) {
		if err := services.NotifyAdminContactMessage(h.db, baseURL, messageID); err != nil {
			log.Printf("contact notification: %v", err)
		}
	}(req.ID, siteURL)

	c.JSON(http.StatusCreated, gin.H{
		"message": "Contact message submitted successfully",
		"id":      req.ID,
	})
}

func contactSiteURL(c *gin.Context) string {
	siteURL := os.Getenv("SITE_URL")
	if siteURL != "" {
		return siteURL
	}

	proto := c.GetHeader("X-Forwarded-Proto")
	if proto == "" {
		proto = "https"
	}
	host := c.GetHeader("X-Forwarded-Host")
	if host == "" {
		host = c.Request.Host
	}
	if host == "" {
		return ""
	}
	return fmt.Sprintf("%s://%s", proto, host)
}

// GetContacts 获取联系消息列表（管理员）
func (h *ContactHandler) GetContacts(c *gin.Context) {
	var messages []models.ContactMessage
	var total int64

	// 分页参数
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	status := c.Query("status")
	priority := c.Query("priority")
	inquiryType := c.Query("inquiry_type")

	// 构建查询
	query := h.db.Model(&models.ContactMessage{})

	if status != "" {
		query = query.Where("status = ?", status)
	}
	if priority != "" {
		query = query.Where("priority = ?", priority)
	}
	if inquiryType != "" {
		query = query.Where("inquiry_type = ?", inquiryType)
	}

	// 获取总数
	query.Count(&total)

	// 分页查询
	offset := (page - 1) * pageSize
	if err := query.Order("created_at DESC").
		Offset(offset).
		Limit(pageSize).
		Find(&messages).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch contact messages",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": messages,
		"pagination": gin.H{
			"page":        page,
			"page_size":   pageSize,
			"total":       total,
			"total_pages": (total + int64(pageSize) - 1) / int64(pageSize),
		},
	})
}

// GetContact 获取单个联系消息（管理员）
func (h *ContactHandler) GetContact(c *gin.Context) {
	id := c.Param("id")
	var message models.ContactMessage

	if err := h.db.First(&message, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "Contact message not found",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch contact message",
		})
		return
	}

	// 标记为已读
	if message.Status == "new" {
		h.db.Model(&message).Update("status", "read")
		message.Status = "read"
	}

	c.JSON(http.StatusOK, gin.H{
		"data": message,
	})
}

// UpdateContactStatus 更新联系消息状态（管理员）
func (h *ContactHandler) UpdateContactStatus(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Status     string `json:"status" binding:"required"`
		Priority   string `json:"priority"`
		AdminNotes string `json:"admin_notes"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request data",
		})
		return
	}

	var message models.ContactMessage
	if err := h.db.First(&message, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Contact message not found",
		})
		return
	}

	// 更新字段
	updates := map[string]interface{}{
		"status": req.Status,
	}

	if req.Priority != "" {
		updates["priority"] = req.Priority
	}

	if req.AdminNotes != "" {
		updates["admin_notes"] = req.AdminNotes
	}

	if req.Status == "replied" {
		now := time.Now()
		updates["replied_at"] = &now
		// TODO: 从JWT获取管理员ID
		// updates["replied_by"] = adminID
	}

	if err := h.db.Model(&message).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update contact message",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Contact message updated successfully",
	})
}

// DeleteContact 删除联系消息（管理员）
func (h *ContactHandler) DeleteContact(c *gin.Context) {
	id := c.Param("id")

	if err := h.db.Delete(&models.ContactMessage{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete contact message",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Contact message deleted successfully",
	})
}

// GetContactStats 获取联系消息统计（管理员）
func (h *ContactHandler) GetContactStats(c *gin.Context) {
	var stats struct {
		Total    int64 `json:"total"`
		New      int64 `json:"new"`
		Read     int64 `json:"read"`
		Replied  int64 `json:"replied"`
		Closed   int64 `json:"closed"`
		Today    int64 `json:"today"`
		ThisWeek int64 `json:"this_week"`
	}

	// 总数
	h.db.Model(&models.ContactMessage{}).Count(&stats.Total)

	// 按状态统计
	h.db.Model(&models.ContactMessage{}).Where("status = ?", "new").Count(&stats.New)
	h.db.Model(&models.ContactMessage{}).Where("status = ?", "read").Count(&stats.Read)
	h.db.Model(&models.ContactMessage{}).Where("status = ?", "replied").Count(&stats.Replied)
	h.db.Model(&models.ContactMessage{}).Where("status = ?", "closed").Count(&stats.Closed)

	// 今日
	today := time.Now().Format("2006-01-02")
	h.db.Model(&models.ContactMessage{}).Where("DATE(created_at) = ?", today).Count(&stats.Today)

	// 本周
	weekStart := time.Now().AddDate(0, 0, -int(time.Now().Weekday()))
	h.db.Model(&models.ContactMessage{}).Where("created_at >= ?", weekStart).Count(&stats.ThisWeek)

	c.JSON(http.StatusOK, gin.H{
		"data": stats,
	})
}
